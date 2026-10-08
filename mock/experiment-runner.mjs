import { performance } from 'node:perf_hooks';
import { parseJudge, ruleScore, saveRunMetric } from './experiment-scoring.mjs';
import { notifyUser } from './app-notifications.mjs';
import {completeWithProvider} from './provider-adapters.mjs';
import {mediaCost,providerConfigured} from './model-capabilities.mjs';
import {saveGeneratedPromptMedia} from './prompt-media.mjs';
import fs from 'node:fs/promises';

export function executionConfigured() { return ['legacy','openai','qwen','gemini'].some(providerConfigured); }

export async function finalizeExperimentBatch(pool, batchId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = (await client.query('SELECT * FROM experiment_batches WHERE id=$1 FOR UPDATE', [batchId])).rows[0];
    if (!current) { await client.query('COMMIT'); return null; }
    const batch = (await client.query(`UPDATE experiment_batches b SET status=CASE WHEN EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status IN ('queued','running')) THEN 'running' WHEN EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status='completed') AND EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status='failed') THEN 'partial' WHEN EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status='failed') THEN 'failed' ELSE 'completed' END,completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status IN ('queued','running')) THEN COALESCE(completed_at,now()) ELSE NULL END WHERE b.id=$1 RETURNING id,experiment_id,owner_id,kind,status`, [batchId])).rows[0];
    if (['completed','partial','failed'].includes(batch.status)) {
      const title = (await client.query('SELECT title FROM experiments WHERE id=$1', [batch.experiment_id])).rows[0]?.title || '实验';
      await notifyUser(client, batch.owner_id, `experiment_${batch.status}`, batch.id, `${title}：${batch.status === 'completed' ? '执行完成' : batch.status === 'partial' ? '部分失败' : '执行失败'}`, `批次 ${batch.id} 已结束，状态：${batch.status}。`, `/experiments/${batch.experiment_id}`);
      const occurrence = (await client.query("UPDATE experiment_schedule_occurrences SET status=$2 WHERE batch_id=$1 AND status='queued' RETURNING schedule_id,id", [batch.id,batch.status])).rows[0];
      if (occurrence) {
        const schedule = (await client.query('UPDATE experiment_schedules SET failure_streak=CASE WHEN $2=$3 THEN 0 ELSE failure_streak+1 END,active=CASE WHEN $2<>$3 AND failure_streak+1>=3 THEN false ELSE active END,updated_at=now() WHERE id=$1 RETURNING owner_id,failure_streak,active', [occurrence.schedule_id,batch.status,'completed'])).rows[0];
        if (schedule && !schedule.active && schedule.failure_streak >= 3) await notifyUser(client,schedule.owner_id,'schedule_paused',occurrence.schedule_id,`${title}：调度已暂停`,'连续三个调度周期失败，请检查模型配置和运行错误。','/experiments/schedules');
      }
    }
    await client.query('COMMIT');
    return batch;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function runExperimentJobs(pool, onChanged = () => {}) {
  if (!executionConfigured()) return 0;
  await recoverExperimentJobs(pool);
  const stranded = (await pool.query("SELECT b.id FROM experiment_batches b WHERE b.status IN ('queued','running') AND EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id) AND NOT EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status IN ('queued','running')) LIMIT 100")).rows;
  for (const row of stranded) await finalizeExperimentBatch(pool,row.id);
  const settings = (await pool.query('SELECT concurrency_limit FROM experiment_settings WHERE id=1')).rows[0];
  if (!settings?.concurrency_limit) return 0;
  const running = Number((await pool.query("SELECT count(*) AS n FROM experiment_runs WHERE status='running'")).rows[0].n);
  const slots = Math.max(0, settings.concurrency_limit - running);
  const claimed = [];
  const enabledProviders=['legacy','openai','qwen','gemini'].filter(providerConfigured);
  for (let index = 0; index < slots; index++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query("SELECT id FROM experiment_runs WHERE status='queued' AND provider=ANY($1) AND (judge_api_model IS NULL OR judge_provider=ANY($1)) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",[enabledProviders]);
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
    const row = (await pool.query('SELECT r.*,b.metric_version_id,c.reference_answer,m.rule_type,m.judge_prompt FROM experiment_runs r JOIN experiment_batches b ON b.id=r.batch_id JOIN experiment_metric_versions m ON m.id=b.metric_version_id LEFT JOIN experiment_dataset_cases c ON c.id=r.case_id WHERE r.id=$1', [id])).rows[0];
    const started = performance.now();
    try {
      const parameters = { ...row.parameters };
      const outputKind=parameters.output_kind || 'text';
      delete parameters.output_kind;
      if (parameters.stop_sequences) { parameters.stop = parameters.stop_sequences; delete parameters.stop_sequences; }
      let output=row.output, promptTokens=row.prompt_tokens, completionTokens=row.completion_tokens,outputParts=row.output_parts || [];
      if (output === null) {
        const response=await completeWithProvider(pool,{provider:row.provider,model:row.api_model,messages:row.request_messages?.length?row.request_messages:[{role:'system',content:row.system_prompt},{role:'user',content:row.user_prompt}],parameters,toolSchema:row.tools_schema,outputKind});
        ({output,promptTokens,completionTokens}=response);
        const client=await pool.connect(),created=[];
        try {
          await client.query('BEGIN');
          outputParts=[];
          for(const part of response.outputParts) {
            if(part.type==='image'||part.type==='audio') {const stored=await saveGeneratedPromptMedia(client,part.type,part.mimeType,part.data);created.push(stored.file);outputParts.push(stored.part);}
            else outputParts.push(part);
          }
          const imageCount=outputParts.filter(part=>part.type==='image').length;
          const audioSeconds=outputParts.filter(part=>part.type==='audio').reduce((sum,part)=>sum+Number(part.durationSeconds || 0),0);
          const cost=(promptTokens*Number(row.input_price)+completionTokens*Number(row.output_price))/1_000_000+Number(row.reserved_media_cost || 0)+imageCount*Number(row.media_price_snapshot?.imageOutputUsdEach || 0)+audioSeconds*Number(row.media_price_snapshot?.audioOutputUsdPerSecond || 0);
          await client.query('UPDATE experiment_runs SET output=$2,prompt_tokens=$3,completion_tokens=$4,latency_ms=$5,cost_usd=$6,tool_calls=$7,output_parts=$8,media_usage=$9,error=NULL WHERE id=$1',[id,output,promptTokens,completionTokens,Math.round(performance.now()-started),cost,JSON.stringify(response.toolCalls),JSON.stringify(outputParts),JSON.stringify({...row.media_usage,imageOutputCount:imageCount,audioOutputSeconds:audioSeconds})]);
          await client.query('COMMIT');
        } catch(error) {await client.query('ROLLBACK').catch(()=>{});for(const file of created)await fs.unlink(file).catch(()=>{});throw error;}
        finally {client.release();}
      }
      if (row.judge_api_model) {
        try {
          const media=outputParts.filter(part=>['image','audio','video'].includes(part.type)&&part.assetId);
          if(outputKind!=='text'&&!media.length) throw new Error('媒体输出缺少可评分附件');
          const judgeMessages=[{role:'system',content:row.judge_prompt},{role:'user',parts:[{type:'text',text:JSON.stringify({question:row.user_prompt,referenceAnswer:row.reference_answer,answer:output || `请评价所附${outputKind}结果`})},...media.map(part=>({type:part.type,assetId:part.assetId}))]}];
          const judge = await completeWithProvider(pool,{provider:row.judge_provider,model:row.judge_api_model,messages:judgeMessages,parameters:{temperature:0,max_tokens:300}});
          const parsed = parseJudge(judge.output);
          const judgeMedia={imageCount:media.filter(part=>part.type==='image').length,audioSeconds:media.filter(part=>part.type==='audio').reduce((sum,part)=>sum+Number(part.durationSeconds || 0),0),videoSeconds:0};
          const judgeCost = (judge.promptTokens * Number(row.judge_input_price) + judge.completionTokens * Number(row.judge_output_price)) / 1_000_000 + mediaCost(judgeMedia,row.judge_media_price_snapshot || {});
          const client=await pool.connect();
          try { await client.query('BEGIN'); await client.query('UPDATE experiment_runs SET judge_prompt_tokens=$2,judge_completion_tokens=$3,judge_cost_usd=$4,cost_usd=cost_usd+$4 WHERE id=$1', [id, judge.promptTokens, judge.completionTokens, judgeCost]); await saveRunMetric(client, id, row.metric_version_id, outputKind==='text'?ruleScore(output, row.reference_answer, row.rule_type):null, parsed.score, parsed.reason); await client.query("UPDATE experiment_runs SET status='completed',completed_at=now() WHERE id=$1",[id]); await client.query('COMMIT'); }
          catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
        } catch (judgeError) { await pool.query("UPDATE experiment_runs SET status='completed',score_reason=$2,completed_at=now() WHERE id=$1", [id, `Judge 评分失败：${String(judgeError.message || judgeError).slice(0, 200)}`]); }
      } else await pool.query("UPDATE experiment_runs SET status='completed',score_reason=$2,completed_at=now() WHERE id=$1", [id,outputKind==='text'?'未配置 LLM Judge':'媒体输出暂无兼容 Judge，保留人工评分']);
    } catch (error) {
      await pool.query("UPDATE experiment_runs SET status='failed',error=$2,latency_ms=$3,completed_at=now() WHERE id=$1", [id, String(error.message || error).slice(0, 500), Math.round(performance.now() - started)]);
      await pool.query("UPDATE experiment_runs SET status='queued',started_at=NULL,completed_at=NULL WHERE id=$1 AND attempts <= COALESCE((SELECT s.retry_limit FROM experiment_schedule_occurrences o JOIN experiment_schedules s ON s.id=o.schedule_id WHERE o.batch_id=experiment_runs.batch_id),-1)", [id]);
    }
    await finalizeExperimentBatch(pool,row.batch_id);
    onChanged();
  }));
  return claimed.length;
}

export async function recoverExperimentJobs(pool) {
  await pool.query("UPDATE experiment_runs SET status='queued',started_at=NULL WHERE status='running' AND started_at < now()-interval '6 minutes'");
}
