import crypto from 'node:crypto';
import { REVIEW_DIMENSIONS, reviewSummary } from './evaluation-reviews.mjs';
import { notifyUser } from './app-notifications.mjs';

const ok = (data, status = 200) => ({ status, data });
const fail = (error, status = 400) => ok({ error }, status);
const uuid = () => crypto.randomUUID();

async function taskScores(client, taskId) {
  return (await client.query('SELECT s.*,a.role FROM evaluation_review_scores s JOIN evaluation_review_assignments a ON a.task_id=s.task_id AND a.reviewer_id=s.reviewer_id WHERE s.task_id=$1', [taskId])).rows;
}

export async function handleEvaluationReviews({ pathname, method, client, me, readBody }) {
  if (pathname === '/api/evaluation/reviewable-batches' && method === 'GET') {
    if (me.role !== 'admin') return fail('仅管理员可分配人工评测', 403);
    return ok({ items: (await client.query("SELECT b.id,b.dataset_version_id,b.status,e.title FROM experiment_batches b JOIN experiments e ON e.id=b.experiment_id WHERE b.kind IN ('dataset','regression') AND b.status IN ('completed','partial') ORDER BY b.created_at DESC LIMIT 100")).rows });
  }
  if (pathname === '/api/evaluation/reviews') {
    if (method === 'GET') return ok({ items: (await client.query(`SELECT t.*,b.status AS batch_status,e.title AS experiment_title FROM evaluation_review_tasks t JOIN experiment_batches b ON b.id=t.batch_id JOIN experiments e ON e.id=b.experiment_id WHERE $1='admin' OR EXISTS(SELECT 1 FROM evaluation_review_assignments a WHERE a.task_id=t.id AND a.reviewer_id=$2) ORDER BY t.created_at DESC LIMIT 100`, [me.role, me.id])).rows });
    if (method === 'POST') {
      if (me.role !== 'admin') return fail('仅管理员可分配人工评测', 403);
      const body = await readBody();
      if (!Array.isArray(body.reviewerIds) || body.reviewerIds.length !== 2 || new Set(body.reviewerIds).size !== 2) return fail('请选择两位不同的评测员');
      const active = (await client.query("SELECT id FROM users WHERE id=ANY($1::text[]) AND status='active'", [body.reviewerIds])).rows;
      if (active.length !== 2) return fail('评测员不存在或已禁用');
      const batch = (await client.query("SELECT id,dataset_version_id,status FROM experiment_batches WHERE id=$1 AND kind IN ('dataset','regression')", [body.batchId])).rows[0];
      if (!batch || !batch.dataset_version_id || !['completed','partial'].includes(batch.status)) return fail('请选择已完成的数据集评测批次', 409);
      const rubric = { dimensions: [...REVIEW_DIMENSIONS], tags: Array.isArray(body.tags) ? [...new Set(body.tags.filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.trim().slice(0, 32)))].slice(0, 20) : [] };
      const id = uuid();
      await client.query('INSERT INTO evaluation_review_tasks(id,batch_id,dataset_version_id,created_by,rubric) VALUES($1,$2,$3,$4,$5)', [id,batch.id,batch.dataset_version_id,me.id,JSON.stringify(rubric)]);
      for (const reviewerId of body.reviewerIds) await client.query("INSERT INTO evaluation_review_assignments(task_id,reviewer_id,role) VALUES($1,$2,'primary')", [id,reviewerId]);
      return ok({ id, rubric }, 201);
    }
  }
  const match = pathname.match(/^\/api\/evaluation\/reviews\/([^/]+)(?:\/(inbox|report|adjudicator|scores\/([^/]+)))?$/);
  if (!match) return null;
  const task = (await client.query('SELECT * FROM evaluation_review_tasks WHERE id=$1', [match[1]])).rows[0];
  if (!task) return fail('人工评测任务不存在', 404);
  const assigned = (await client.query('SELECT role FROM evaluation_review_assignments WHERE task_id=$1 AND reviewer_id=$2', [task.id,me.id])).rows[0];
  if (!assigned && me.role !== 'admin') return fail('未分配此评测任务', 403);
  if (match[2] === 'report' && method === 'GET') {
    if (me.role !== 'admin') return fail('双盲阶段评测员不能查看他人评分', 403);
    return ok({ taskId: task.id, ...reviewSummary(await taskScores(client, task.id)) });
  }
  if (match[2] === 'adjudicator' && method === 'POST') {
    if (me.role !== 'admin') return fail('仅管理员可指派仲裁员', 403);
    const body = await readBody();
    const disputes = reviewSummary(await taskScores(client, task.id)).disputes;
    if (!disputes.some(item => !item.adjudicated)) return fail('当前没有待仲裁条目', 409);
    if ((await client.query("SELECT 1 FROM evaluation_review_assignments WHERE task_id=$1 AND role='adjudicator'", [task.id])).rowCount) return fail('仲裁员已指派', 409);
    if (!(await client.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [body.userId])).rowCount || (await client.query('SELECT 1 FROM evaluation_review_assignments WHERE task_id=$1 AND reviewer_id=$2', [task.id,body.userId])).rowCount) return fail('仲裁员无效或与原评测员重复');
    await client.query("INSERT INTO evaluation_review_assignments(task_id,reviewer_id,role) VALUES($1,$2,'adjudicator')", [task.id,body.userId]);
    return ok({ taskId: task.id, reviewerId: body.userId });
  }
  if (match[2] === 'inbox' && method === 'GET') {
    if (!assigned) return fail('管理员未被分配评测', 403);
    const disputes = new Set(reviewSummary(await taskScores(client, task.id)).disputes.filter(item => !item.adjudicated).map(item => item.runId));
    const rows = (await client.query("SELECT r.id AS run_id,r.output,r.output_parts,r.tool_calls,c.case_key,c.input_payload,c.context_payload,c.reference_answer,c.expected_payload,c.tags,c.difficulty_score FROM experiment_runs r JOIN experiment_dataset_cases c ON c.id=r.case_id WHERE r.batch_id=$1 AND r.status='completed' AND NOT EXISTS(SELECT 1 FROM evaluation_review_scores s WHERE s.task_id=$2 AND s.run_id=r.id AND s.reviewer_id=$3) ORDER BY c.case_key LIMIT 10000", [task.batch_id,task.id,me.id])).rows;
    return ok({ taskId: task.id, role: assigned.role, rubric: task.rubric, items: assigned.role === 'adjudicator' ? rows.filter(row => disputes.has(row.run_id)) : rows });
  }
  if (match[3] && method === 'POST') {
    if (!assigned) return fail('未分配此评测任务', 403);
    const body = await readBody();
    if (REVIEW_DIMENSIONS.some(dimension => !Number.isInteger(body[dimension]) || body[dimension] < 0 || body[dimension] > 10)) return fail('四个维度均须为 0–10 整数');
    if (!Array.isArray(body.tags) || body.tags.some(tag => !task.rubric.tags.includes(tag))) return fail('标签不在评测标准内');
    const run = (await client.query("SELECT 1 FROM experiment_runs WHERE id=$1 AND batch_id=$2 AND status='completed'", [match[3],task.batch_id])).rows[0];
    if (!run) return fail('用例运行不存在或未完成', 404);
    if (assigned.role === 'adjudicator' && !reviewSummary(await taskScores(client, task.id)).disputes.some(item => item.runId === match[3] && !item.adjudicated)) return fail('该用例不需要仲裁', 409);
    const result = await client.query('INSERT INTO evaluation_review_scores(task_id,run_id,reviewer_id,accuracy,completeness,brevity,safety,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING run_id', [task.id,match[3],me.id,body.accuracy,body.completeness,body.brevity,body.safety,[...new Set(body.tags)]]);
    if (!result.rowCount) return fail('此条目已经评分', 409);
    const summary = reviewSummary(await taskScores(client, task.id));
    if (summary.disputes.some(item => item.runId === match[3] && !item.adjudicated)) await notifyUser(client,task.created_by,'evaluation_dispute',`${task.id}:${match[3]}`,'评测出现待仲裁条目','两位评测员在至少一个维度相差 3 分或以上。','/evaluation/reviews');
    return ok({ saved: true, remainingDisputes: summary.disputes.filter(item => !item.adjudicated).length });
  }
  return fail('不支持的人工评测操作', 405);
}
