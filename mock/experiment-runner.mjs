import { performance } from 'node:perf_hooks';

const endpoint = () => process.env.MODEL_API_BASE_URL?.replace(/\/$/, '') + '/chat/completions';
export function executionConfigured() { return Boolean(process.env.MODEL_API_BASE_URL && process.env.MODEL_API_KEY); }

export async function runExperimentJobs(pool, onChanged = () => {}) {
  if (!executionConfigured()) return 0;
  const settings = (await pool.query('SELECT concurrency_limit FROM experiment_settings WHERE id=1')).rows[0];
  if (!settings?.concurrency_limit) return 0;
  const running = Number((await pool.query("SELECT count(*) AS n FROM experiment_runs WHERE status='running'")).rows[0].n);
  const slots = Math.max(0, settings.concurrency_limit - running);
  const claimed = [];
  for (let index = 0; index < slots; index++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query("SELECT id FROM experiment_runs WHERE status='queued' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1");
      if (!result.rowCount) { await client.query('COMMIT'); break; }
      const id = result.rows[0].id;
      await client.query("UPDATE experiment_runs SET status='running',started_at=now(),attempts=attempts+1 WHERE id=$1", [id]);
      await client.query("UPDATE experiment_batches SET status='running' WHERE id=(SELECT batch_id FROM experiment_runs WHERE id=$1) AND status='queued'", [id]);
      await client.query('COMMIT');
      claimed.push(id);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  await Promise.all(claimed.map(async id => {
    const row = (await pool.query('SELECT * FROM experiment_runs WHERE id=$1', [id])).rows[0];
    const started = performance.now();
    try {
      const parameters = { ...row.parameters };
      if (parameters.stop_sequences) { parameters.stop = parameters.stop_sequences; delete parameters.stop_sequences; }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      let response;
      try {
        response = await fetch(endpoint(), { method: 'POST', headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: row.api_model, messages: [{ role: 'system', content: row.system_prompt }, { role: 'user', content: row.user_prompt }], ...parameters }), signal: controller.signal });
      } finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error(`模型 API HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const result = await response.json();
      const output = result.choices?.[0]?.message?.content;
      const promptTokens = result.usage?.prompt_tokens;
      const completionTokens = result.usage?.completion_tokens;
      if (typeof output !== 'string' || !Number.isInteger(promptTokens) || !Number.isInteger(completionTokens)) throw new Error('模型响应缺少输出或 token 用量');
      const cost = (promptTokens * Number(row.input_price) + completionTokens * Number(row.output_price)) / 1_000_000;
      await pool.query("UPDATE experiment_runs SET status='completed',output=$2,prompt_tokens=$3,completion_tokens=$4,latency_ms=$5,cost_usd=$6,completed_at=now(),error=NULL WHERE id=$1", [id, output, promptTokens, completionTokens, Math.round(performance.now() - started), cost]);
    } catch (error) {
      await pool.query("UPDATE experiment_runs SET status='failed',error=$2,latency_ms=$3,completed_at=now() WHERE id=$1", [id, String(error.message || error).slice(0, 500), Math.round(performance.now() - started)]);
    }
    await pool.query(`UPDATE experiment_batches b SET status=CASE WHEN EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status IN ('queued','running')) THEN 'running' WHEN EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status='completed') AND EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status='failed') THEN 'partial' WHEN EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status='failed') THEN 'failed' ELSE 'completed' END,completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status IN ('queued','running')) THEN now() ELSE NULL END WHERE b.id=$1`, [row.batch_id]);
    onChanged();
  }));
  return claimed.length;
}

export async function recoverExperimentJobs(pool) {
  await pool.query("UPDATE experiment_runs SET status='queued',started_at=NULL WHERE status='running'");
  await pool.query("UPDATE experiment_batches SET status='queued' WHERE status='running'");
}
