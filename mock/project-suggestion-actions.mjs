import crypto from 'node:crypto';
import pg from 'pg';
import { loadData, saveData } from './postgres-store.mjs';
import { recordTaskTrendEvent, recordTaskTrendSnapshot } from './task-trends.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status,error,extra={}) => ({ status, data: { error,...extra } });
const fingerprint = suggestion => crypto.createHash('sha256').update([suggestion.topic,suggestion.practice].map(value => value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu,'')).join('\n')).digest('hex');

function sourceDescription(row) {
  const source = row.evidence_path && row.evidence_line ? `\n- 代码证据：[${row.evidence_path}:${row.evidence_line}](https://github.com/${row.full_name}/blob/${row.commit_sha.trim()}/${row.evidence_path.split('/').map(encodeURIComponent).join('/')}#L${row.evidence_line})` : '';
  const prerequisites = row.prerequisites?.length ? row.prerequisites.map(item => `- ${item}`).join('\n') : '暂无明确前置知识';
  return `## 学习理由\n${row.reason}\n\n## 对开发的影响（模型建议）\n${row.impact_reason || '旧报告未记录'}\n\n## 前置知识\n${prerequisites}\n\n## 实践任务\n${row.practice}\n\n## 验收标准\n${row.acceptance}\n\n## 来源\n- 项目报告：${row.analysis_id}\n- 关联结论：${row.finding_title || '未关联'}${source}`;
}

export async function handleProjectSuggestionAction({ pathname, method, client, me, readBody = async () => ({}) }) {
  const match = pathname.match(/^\/api\/project-repositories\/([^/]+)\/analyses\/([^/]+)\/suggestions\/([^/]+)\/(accept|ignore)$/);
  if (!match) return null;
  if (method !== 'POST') return fail(405,'不支持该操作');
  const [,repositoryId,analysisId,suggestionId,action] = match;
  if (![repositoryId,analysisId,suggestionId].every(value => UUID.test(value))) return fail(404,'建议不存在');
  await readBody();
  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  try {
    await connection.query('BEGIN');
    await connection.query('SELECT pg_advisory_xact_lock(748201)');
    const row = (await connection.query(`SELECT s.*,a.id AS analysis_id,a.status AS analysis_status,a.goal AS report_goal,a.requirement_baseline AS report_baseline,a.commit_sha,a.full_name,
      r.goal AS current_goal,r.requirement_baseline AS current_baseline,r.commit_sha AS current_commit,r.branch AS current_branch,
      f.title AS finding_title,f.evidence_path,f.evidence_line
      FROM project_analysis_suggestions s JOIN project_analyses a ON a.id=s.analysis_id
      JOIN project_repositories r ON r.id=a.repository_id
      LEFT JOIN project_analysis_findings f ON f.id=s.finding_id
      WHERE s.id=$1 AND a.id=$2 AND a.repository_id=$3 AND r.owner_id=$4 FOR UPDATE OF s FOR SHARE OF r`, [suggestionId,analysisId,repositoryId,me.id])).rows[0];
    if (!row) { await connection.query('ROLLBACK'); return fail(404,'建议不存在'); }
    if (row.analysis_status !== 'completed') { await connection.query('ROLLBACK'); return fail(409,'报告尚未完成'); }
    const existing = (await connection.query('SELECT * FROM project_suggestion_decisions WHERE suggestion_id=$1', [suggestionId])).rows[0];
    if (existing) {
      await connection.query('COMMIT');
      return existing.state === (action === 'accept' ? 'accepted' : 'ignored') ? { status: 200, data: { suggestionId, status: existing.state, taskId: existing.task_id, decidedAt: existing.decided_at } } : fail(409,'该建议已有不同处理结果');
    }
    const key = fingerprint(row);
    let taskId = null;
    if (action === 'accept') {
      if (row.report_goal !== row.current_goal || row.report_baseline !== row.current_baseline || row.commit_sha.trim() !== row.current_commit?.trim()) { await connection.query('ROLLBACK'); return fail(409,'项目目标、需求基线或 commit 已变化，请重新分析后确认'); }
      const duplicate = (await connection.query("SELECT task_id FROM project_suggestion_decisions WHERE owner_id=$1 AND repository_id=$2 AND fingerprint=$3 AND state='accepted' LIMIT 1", [me.id,repositoryId,key])).rows[0];
      if (duplicate) { await connection.query('ROLLBACK'); return fail(409,'相同实践建议已转为任务', { taskId: duplicate.task_id }); }
      const data = await loadData(connection);
      const before = structuredClone(data);
      const at = new Date().toISOString();
      taskId = crypto.randomUUID();
      data.tasks.push({ id: taskId, title: row.topic, description: sourceDescription(row), category: '项目学习', phase: '基础', status: 'todo', progress: 0, manualProgress: 0, checklist: [], version: 1, priority: 'medium', dueDate: '', plannedStartDate: '', dependencyIds: [], ownerId: me.id, notes: '', resources: [], tags: [], estimatedHours: null, completionCycles: [], activeCycleStartedAt: at, legacyCompletionUnknown: false, createdAt: at, updatedAt: at });
      recordTaskTrendEvent(data,'create',taskId,at);
      recordTaskTrendSnapshot(data,at);
      data.activity.unshift({ id: crypto.randomUUID(), type: 'create', taskId, title: row.topic, detail: '由项目分析建议创建任务', at, userId: me.id, username: me.username || me.id, userName: me.username || me.id });
      if (data.activity.length > 500) data.activity.length = 500;
      await saveData(connection,before,data);
    }
    const decision = (await connection.query('INSERT INTO project_suggestion_decisions(suggestion_id,analysis_id,repository_id,owner_id,state,task_id,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING decided_at', [suggestionId,analysisId,repositoryId,me.id,action === 'accept' ? 'accepted' : 'ignored',taskId,key])).rows[0];
    await connection.query('COMMIT');
    return { status: action === 'accept' ? 201 : 200, data: { suggestionId, status: action === 'accept' ? 'accepted' : 'ignored', taskId, decidedAt: decision.decided_at } };
  } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { if (pooled) connection.release(); }
}
