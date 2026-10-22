import crypto from 'node:crypto';
import pg from 'pg';
import { appendSecurityAudit } from './account-audit.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, error) => ({ status, data: { error } });
const key = item => `${item.topic.trim().replace(/\s+/g,' ').toLocaleLowerCase()}\n${item.practice.trim().replace(/\s+/g,' ').toLocaleLowerCase()}`;
const topicKey = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();

function orderByDependencies(tasks, edges) {
  const byId = new Map(tasks.map(task => [task.id,task]));
  const dependencies = new Map(tasks.map(task => [task.id,[]]));
  for (const edge of edges) if (byId.has(edge.task_id) && byId.has(edge.dependency_id)) dependencies.get(edge.task_id).push(edge.dependency_id);
  const ranks = new Map();
  const rank = (id, path = new Set()) => {
    if (ranks.has(id)) return ranks.get(id);
    if (path.has(id)) return 0;
    const next = new Set(path); next.add(id);
    const value = Math.max(0,...dependencies.get(id).map(dependency => rank(dependency,next) + 1));
    ranks.set(id,value); return value;
  };
  const priority = { high: 0, medium: 1, low: 2 };
  return tasks.map(task => ({ ...task, dependencyIds: dependencies.get(task.id), dependencyLevel: rank(task.id) }))
    .sort((a,b) => a.dependencyLevel-b.dependencyLevel || (priority[a.priority] ?? 3)-(priority[b.priority] ?? 3) || a.title.localeCompare(b.title,'zh-CN') || a.id.localeCompare(b.id));
}

async function setPrerequisiteTaskMapping({ repositoryId, analysisId, suggestionId, indexText, client, me, readBody, req }) {
  if (!UUID.test(suggestionId) || !/^(0|[1-4])$/.test(indexText)) return fail(400,'前置知识位置无效');
  const body = await readBody();
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 2 || !Object.hasOwn(body,'taskId') || !Object.hasOwn(body,'expectedVersion')
    || body.taskId !== null && (typeof body.taskId !== 'string' || !body.taskId || body.taskId.length > 200 || body.taskId.trim() !== body.taskId)
    || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0) return fail(400,'前置任务映射或版本无效');
  const prerequisiteIndex = Number(indexText);
  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  try {
    await connection.query('BEGIN');
    const row = (await connection.query(`SELECT s.prerequisites,a.status AS analysis_status,a.goal AS report_goal,
        a.requirement_baseline AS report_baseline,a.baseline_version_id AS report_baseline_version_id,
        a.commit_sha AS report_commit,a.branch AS report_branch,r.goal AS current_goal,
        r.requirement_baseline AS current_baseline,r.baseline_version_id AS current_baseline_version_id,
        r.commit_sha AS current_commit,r.branch AS current_branch
      FROM project_analysis_suggestions s JOIN project_analyses a ON a.id=s.analysis_id
      JOIN project_repositories r ON r.id=a.repository_id
      WHERE s.id=$1 AND a.id=$2 AND r.id=$3 AND r.owner_id=$4
      FOR UPDATE OF s FOR SHARE OF r`,[suggestionId,analysisId,repositoryId,me.id])).rows[0];
    if (!row) { await connection.query('ROLLBACK'); return fail(404,'学习建议不存在'); }
    if (row.analysis_status !== 'completed') { await connection.query('ROLLBACK'); return fail(409,'报告尚未完成'); }
    if (prerequisiteIndex >= (row.prerequisites || []).length) { await connection.query('ROLLBACK'); return fail(404,'前置知识不存在'); }
    if (row.report_goal !== row.current_goal || row.report_baseline !== row.current_baseline
      || row.report_baseline_version_id !== row.current_baseline_version_id
      || row.report_commit.trim() !== row.current_commit.trim() || row.report_branch !== row.current_branch) {
      await connection.query('ROLLBACK'); return fail(409,'项目目标、需求基线或 commit 已变化，请重新分析后调整路线');
    }
    if (body.taskId !== null) {
      const task = (await connection.query(`SELECT t.id FROM project_repository_tasks l JOIN tasks t ON t.id=l.task_id
        WHERE l.repository_id=$1 AND l.task_id=$2 AND t.owner_id=$3 AND t.deleted_at IS NULL
        FOR SHARE OF l,t`,[repositoryId,body.taskId,me.id])).rows[0];
      if (!task) { await connection.query('ROLLBACK'); return fail(404,'仅能映射本人已关联且未删除的任务'); }
    }
    const previous = (await connection.query(`SELECT task_id,version,updated_at FROM project_prerequisite_task_links
      WHERE suggestion_id=$1 AND prerequisite_index=$2 FOR UPDATE`,[suggestionId,prerequisiteIndex])).rows[0];
    if (!previous && body.expectedVersion !== 0) {
      await connection.query('ROLLBACK'); return fail(409,'前置任务映射已变化，请刷新学习路线');
    }
    if ((previous?.version || 0) !== body.expectedVersion) {
      await connection.query('ROLLBACK'); return fail(409,'前置任务映射已变化，请刷新学习路线');
    }
    if ((!previous && body.taskId === null) || (previous?.task_id === body.taskId && body.taskId !== null)) {
      await connection.query('COMMIT');
      return { status: 200, data: { suggestionId, prerequisiteIndex, mappedTaskId: body.taskId,
        source: body.taskId ? 'manual' : 'auto', version: previous?.version || 0, updatedAt: previous?.updated_at || null } };
    }
    const saved = body.taskId === null ? (await connection.query(`DELETE FROM project_prerequisite_task_links
      WHERE suggestion_id=$1 AND prerequisite_index=$2 AND version=$3 RETURNING version,updated_at`,
    [suggestionId,prerequisiteIndex,body.expectedVersion])).rows[0]
      : previous ? (await connection.query(`UPDATE project_prerequisite_task_links
        SET task_id=$3,version=version+1 WHERE suggestion_id=$1 AND prerequisite_index=$2 AND version=$4
        RETURNING version,updated_at`,[suggestionId,prerequisiteIndex,body.taskId,body.expectedVersion])).rows[0]
        : (await connection.query(`INSERT INTO project_prerequisite_task_links
        (suggestion_id,prerequisite_index,analysis_id,repository_id,owner_id,task_id)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING version,updated_at`,
      [suggestionId,prerequisiteIndex,analysisId,repositoryId,me.id,body.taskId])).rows[0];
    if (!saved) { await connection.query('ROLLBACK'); return fail(409,'前置任务映射已变化，请刷新学习路线'); }
    if (req) await appendSecurityAudit(connection,req,me,body.taskId ? 'link' : 'unlink',
      'project_prerequisite_task_links',`${suggestionId}:${prerequisiteIndex}`,
      { repositoryId, analysisId, taskId: body.taskId, version: saved.version });
    await connection.query('COMMIT');
    return { status: 200, data: { suggestionId, prerequisiteIndex, mappedTaskId: body.taskId,
      source: body.taskId ? 'manual' : 'auto', version: body.taskId ? saved.version : 0,
      updatedAt: body.taskId ? saved.updated_at : null } };
  } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { if (pooled) connection.release(); }
}

async function requestLearningReview({ repositoryId, analysisId, evidenceId, client, me, req }) {
  if (!UUID.test(repositoryId) || !UUID.test(analysisId) || !UUID.test(evidenceId)) return fail(404,'学习记录不存在');
  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  try {
    await connection.query('BEGIN');
    const evidence = (await connection.query(`SELECT e.id FROM project_learning_evidence e
      JOIN project_repositories r ON r.id=e.repository_id AND r.owner_id=e.owner_id
      WHERE e.id=$1 AND e.analysis_id=$2 AND e.repository_id=$3 AND e.owner_id=$4
      FOR SHARE OF e,r`,[evidenceId,analysisId,repositoryId,me.id])).rows[0];
    if (!evidence) { await connection.query('ROLLBACK'); return fail(404,'学习记录不存在'); }
    const inserted = (await connection.query(`INSERT INTO project_learning_evidence_reviews(evidence_id,owner_id)
      VALUES($1,$2) ON CONFLICT(evidence_id) DO NOTHING RETURNING requested_at`,[evidenceId,me.id])).rows[0];
    const review = inserted || (await connection.query(`SELECT state,requested_at,reviewed_at
      FROM project_learning_evidence_reviews WHERE evidence_id=$1`,[evidenceId])).rows[0];
    if (inserted && req) await appendSecurityAudit(connection,req,me,'create',
      'project_learning_evidence_reviews',evidenceId,{ repositoryId,analysisId });
    await connection.query('COMMIT');
    return { status: inserted ? 201 : 200, data: {
      evidenceId, state: review.state || 'pending', requestedAt: review.requested_at, reviewedAt: review.reviewed_at || null,
    } };
  } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { if (pooled) connection.release(); }
}

export async function handleProjectLearningRoadmap({ pathname, method, client, me, url, readBody, req }) {
  const mappingMatch = pathname.match(/^\/api\/project-repositories\/([^/]+)\/roadmap\/([^/]+)\/prerequisites\/([^/]+)\/([^/]+)$/);
  const reviewRequestMatch = pathname.match(/^\/api\/project-repositories\/([^/]+)\/roadmap\/([^/]+)\/evidence\/([^/]+)\/review-request$/);
  const match = pathname.match(/^\/api\/project-repositories\/([^/]+)\/roadmap\/([^/]+)(?:\/(evidence))?$/);
  if (!match && !mappingMatch && !reviewRequestMatch) return null;
  if (mappingMatch) {
    if (method !== 'PUT') return fail(405,'不支持该操作');
    const [,repositoryId,analysisId,suggestionId,indexText] = mappingMatch;
    if (!UUID.test(repositoryId) || !UUID.test(analysisId)) return fail(404,'学习路线不存在');
    return setPrerequisiteTaskMapping({ repositoryId,analysisId,suggestionId,indexText,client,me,readBody,req });
  }
  if (reviewRequestMatch) {
    if (method !== 'POST') return fail(405,'不支持该操作');
    const [,repositoryId,analysisId,evidenceId] = reviewRequestMatch;
    return requestLearningReview({ repositoryId,analysisId,evidenceId,client,me,req });
  }
  const [,repositoryId,analysisId,action] = match;
  if (action ? !['POST','GET'].includes(method) : method !== 'GET') return fail(405,'不支持该操作');
  if (!UUID.test(repositoryId) || !UUID.test(analysisId)) return fail(404,'学习路线不存在');
  const repository = (await client.query('SELECT id,owner_id,goal,requirement_baseline,baseline_version_id,commit_sha,branch FROM project_repositories WHERE id=$1 AND owner_id=$2',[repositoryId,me.id])).rows[0];
  if (!repository) return fail(404,'项目不存在');
  const analysis = (await client.query("SELECT id,repository_id,commit_sha,branch,goal,requirement_baseline,baseline_version_id,finished_at,analysis_coverage_complete,selected_file_count,available_file_count FROM project_analyses WHERE id=$1 AND repository_id=$2 AND owner_id=$3 AND status='completed'",[analysisId,repositoryId,me.id])).rows[0];
  if (!analysis) return fail(404,'已完成报告不存在');
  if (action === 'evidence' && method === 'GET') {
    const suggestionId = url.searchParams.get('suggestionId');
    const before = url.searchParams.get('before');
    if (!UUID.test(suggestionId || '') || before && !UUID.test(before)) return fail(400,'学习记录查询条件无效');
    const suggestion = (await client.query('SELECT id FROM project_analysis_suggestions WHERE id=$1 AND analysis_id=$2',[suggestionId,analysisId])).rows[0];
    if (!suggestion) return fail(404,'学习建议不存在');
    let cursor = null;
    if (before) {
      cursor = (await client.query(`SELECT created_at,id FROM project_learning_evidence
        WHERE id=$1 AND analysis_id=$2 AND suggestion_id=$3 AND owner_id=$4`,[before,analysisId,suggestionId,me.id])).rows[0];
      if (!cursor) return fail(400,'学习记录游标无效');
    }
    const rows = (await client.query(`SELECT e.id,e.kind,e.response,e.artifact_url,e.created_at,
      review.state AS review_state,review.core_correct,review.boundary_verified,
      review.rationale AS review_rationale,review.requested_at,review.reviewed_at,
      coalesce(reviewer.name,reviewer.username) AS reviewer_name
      FROM project_learning_evidence e
      LEFT JOIN project_learning_evidence_reviews review ON review.evidence_id=e.id
      LEFT JOIN users reviewer ON reviewer.id=review.reviewer_id
      WHERE e.analysis_id=$1 AND e.suggestion_id=$2 AND e.owner_id=$3
        AND ($4::timestamptz IS NULL OR (e.created_at,e.id)<($4::timestamptz,$5::uuid))
      ORDER BY e.created_at DESC,e.id DESC LIMIT 21`,
    [analysisId,suggestionId,me.id,cursor?.created_at || null,cursor?.id || null])).rows;
    return { status: 200, data: { items: rows.slice(0,20).map(row => ({
      id: row.id, kind: row.kind, response: row.response, artifactUrl: row.artifact_url,
      createdAt: row.created_at, review: row.review_state ? {
        state: row.review_state, coreCorrect: row.core_correct, boundaryVerified: row.boundary_verified,
        rationale: row.review_rationale, requestedAt: row.requested_at,
        reviewedAt: row.reviewed_at, reviewerName: row.reviewer_name || null,
      } : null,
    })), nextCursor: rows.length > 20 ? rows[19].id : null } };
  }
  if (action === 'evidence') {
    const body = await readBody();
    const response = typeof body?.response === 'string' ? body.response.trim() : '';
    const artifactUrl = typeof body?.artifactUrl === 'string' ? body.artifactUrl.trim() : '';
    const responseLength = Array.from(response).length;
    if (!UUID.test(body?.suggestionId || '') || !['understanding','practice'].includes(body?.kind) || responseLength < 20 || responseLength > 4000 || artifactUrl.length > 2048) return fail(400,'理解检查或实践记录内容无效');
    if (artifactUrl) {
      try { const url = new URL(artifactUrl); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
      catch { return fail(400,'实践证据链接须为无账号密码的 HTTPS 地址'); }
    }
    const pooled = client instanceof pg.Pool;
    const connection = pooled ? await client.connect() : client;
    try {
      await connection.query('BEGIN');
      const suggestion = (await connection.query('SELECT id FROM project_analysis_suggestions WHERE id=$1 AND analysis_id=$2',[body.suggestionId,analysisId])).rows[0];
      if (!suggestion) { await connection.query('ROLLBACK'); return fail(404,'学习建议不属于此报告'); }
      const id = crypto.randomUUID();
      const saved = (await connection.query(`INSERT INTO project_learning_evidence
        (id,repository_id,analysis_id,suggestion_id,owner_id,kind,response,artifact_url)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING created_at`,
      [id,repositoryId,analysisId,suggestion.id,me.id,body.kind,response,artifactUrl || null])).rows[0];
      if (req) await appendSecurityAudit(connection,req,me,'create','project_learning_evidence',id,{repositoryId,analysisId,suggestionId:suggestion.id,kind:body.kind});
      await connection.query('COMMIT');
      return { status: 201, data: { id, suggestionId: suggestion.id, kind: body.kind, response, artifactUrl: artifactUrl || null, createdAt: saved.created_at } };
    } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { if (pooled) connection.release(); }
  }
  const [taskRows,suggestionRows,previousRows] = await Promise.all([
    client.query(`SELECT t.id,t.title,t.status,t.progress,t.priority,t.phase,l.requirement_id
      FROM project_repository_tasks l JOIN tasks t ON t.id=l.task_id
      WHERE l.repository_id=$1 AND t.owner_id=$2 AND t.deleted_at IS NULL`,[repositoryId,me.id]),
    client.query(`SELECT s.id,s.topic,s.reason,s.practice,s.acceptance,s.impact,s.prerequisites,
      adj.practice AS adjusted_practice,adj.acceptance AS adjusted_acceptance,adj.rationale AS adjustment_rationale,
      f.requirement_id,d.state AS decision_state,d.task_id AS decision_task_id
      FROM project_analysis_suggestions s LEFT JOIN project_analysis_findings f ON f.id=s.finding_id
      LEFT JOIN project_suggestion_decisions d ON d.suggestion_id=s.id
      LEFT JOIN project_suggestion_adjustments adj ON adj.suggestion_id=s.id
      WHERE s.analysis_id=$1 ORDER BY s.position`,[analysisId]),
    analysis.baseline_version_id && analysis.analysis_coverage_complete ? client.query(`SELECT id FROM project_analyses
      WHERE repository_id=$1 AND owner_id=$2 AND status='completed' AND id<>$3 AND finished_at<$4
        AND branch=$5 AND goal=$6 AND baseline_version_id=$7 AND analysis_coverage_complete=true
        AND selected_file_count=$8 AND available_file_count=$9
      ORDER BY finished_at DESC,id DESC LIMIT 1`,[repositoryId,me.id,analysis.id,analysis.finished_at,analysis.branch,analysis.goal,analysis.baseline_version_id,analysis.selected_file_count,analysis.available_file_count]) : Promise.resolve({ rows: [] }),
  ]);
  const taskIds = taskRows.rows.map(row => row.id);
  const previousId = previousRows.rows[0]?.id || null;
  const [edgeRows,noteRows,experimentRows,oldSuggestionRows,evidenceRows,mappingRows] = await Promise.all([
    taskIds.length ? client.query('SELECT d.task_id,d.dependency_id,dependency.status AS dependency_status,dependency.deleted_at AS dependency_deleted_at FROM task_dependencies d JOIN tasks dependency ON dependency.id=d.dependency_id WHERE d.task_id=ANY($1::text[])',[taskIds]) : Promise.resolve({ rows: [] }),
    taskIds.length ? client.query(`SELECT n.id,n.title,n.task_id,s.id AS session_id
      FROM notes n LEFT JOIN sessions s ON s.id=n.source_session_id AND s.ingested_by=$2
      WHERE n.task_id=ANY($1::text[]) AND n.owner_id=$2 AND n.deleted_at IS NULL
      ORDER BY n.updated_at DESC LIMIT 501`,[taskIds,me.id]) : Promise.resolve({ rows: [] }),
    taskIds.length ? client.query(`SELECT id,title,task_id,record_kind FROM experiments
      WHERE task_id=ANY($1::text[]) AND owner_id=$2 AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 501`,[taskIds,me.id]) : Promise.resolve({ rows: [] }),
    previousId ? client.query('SELECT topic,practice FROM project_analysis_suggestions WHERE analysis_id=$1',[previousId]) : Promise.resolve({ rows: [] }),
    client.query(`SELECT id,suggestion_id,kind,response,artifact_url,created_at,
      review_state,core_correct,boundary_verified,review_rationale,requested_at,reviewed_at,reviewer_name,total_count FROM (
      SELECT e.id,e.suggestion_id,e.kind,e.response,e.artifact_url,e.created_at,
        review.state AS review_state,review.core_correct,review.boundary_verified,
        review.rationale AS review_rationale,review.requested_at,review.reviewed_at,
        coalesce(reviewer.name,reviewer.username) AS reviewer_name,
        row_number() OVER (PARTITION BY e.suggestion_id ORDER BY e.created_at DESC,e.id DESC) AS position,
        count(*) OVER (PARTITION BY e.suggestion_id) AS total_count
      FROM project_learning_evidence e
      LEFT JOIN project_learning_evidence_reviews review ON review.evidence_id=e.id
      LEFT JOIN users reviewer ON reviewer.id=review.reviewer_id
      WHERE e.analysis_id=$1 AND e.owner_id=$2
    ) recent WHERE position<=3 ORDER BY suggestion_id,created_at DESC,id DESC`,[analysisId,me.id]),
    client.query(`SELECT suggestion_id,prerequisite_index,task_id,version
      FROM project_prerequisite_task_links WHERE analysis_id=$1 AND owner_id=$2`,[analysisId,me.id]),
  ]);
  const oldKeys = new Set(oldSuggestionRows.rows.map(key));
  const linkedIds = new Set(taskIds);
  const tasks = orderByDependencies(taskRows.rows,edgeRows.rows).map(task => ({
    id: task.id, title: task.title, status: task.status, progress: task.progress === null ? null : Number(task.progress),
    priority: task.priority, phase: task.phase, requirementId: task.requirement_id,
    dependencyIds: task.dependencyIds, dependencyLevel: task.dependencyLevel,
    externalBlockingCount: edgeRows.rows.filter(edge => edge.task_id === task.id && !linkedIds.has(edge.dependency_id) && !edge.dependency_deleted_at && edge.dependency_status !== 'done').length,
    notes: noteRows.rows.slice(0,500).filter(note => note.task_id === task.id).map(note => ({ id: note.id, title: note.title || '未命名笔记', sourceSessionId: note.session_id || null })),
    experiments: experimentRows.rows.slice(0,500).filter(experiment => experiment.task_id === task.id).map(experiment => ({ id: experiment.id, title: experiment.title || '未命名实验', recordKind: experiment.record_kind })),
  }));
  const suggestions = suggestionRows.rows.map(item => ({
    id: item.id, topic: item.topic, reason: item.reason, practice: item.practice, acceptance: item.acceptance,
    adjustment: item.adjusted_practice ? { practice: item.adjusted_practice, acceptance: item.adjusted_acceptance, rationale: item.adjustment_rationale } : null,
    impact: item.impact, prerequisites: item.prerequisites || [], status: item.decision_state || 'pending',
    requirementId: item.requirement_id, newSincePrevious: previousId ? !oldKeys.has(key(item)) : null,
    linkedTaskIds: tasks.filter(task => task.id === item.decision_task_id || item.requirement_id && task.requirementId === item.requirement_id).map(task => task.id),
    evidence: evidenceRows.rows.filter(row => row.suggestion_id === item.id).map(row => ({
      id: row.id, kind: row.kind, response: row.response, artifactUrl: row.artifact_url, createdAt: row.created_at,
      review: row.review_state ? { state: row.review_state, coreCorrect: row.core_correct,
        boundaryVerified: row.boundary_verified, rationale: row.review_rationale,
        requestedAt: row.requested_at, reviewedAt: row.reviewed_at, reviewerName: row.reviewer_name || null } : null,
    })),
    evidenceCount: Number(evidenceRows.rows.find(row => row.suggestion_id === item.id)?.total_count || 0),
  }));
  const topicMatches = new Map();
  for (const item of suggestions) {
    const normalized = topicKey(item.topic);
    if (normalized) topicMatches.set(normalized,[...(topicMatches.get(normalized) || []),item]);
  }
  const taskById = new Map(tasks.map(task => [task.id,task]));
  const manualMappings = new Map(mappingRows.rows.map(row => [`${row.suggestion_id}:${row.prerequisite_index}`,row]));
  for (const item of suggestions) {
    item.prerequisiteMappings = item.prerequisites.map((name,index) => {
      const manual = manualMappings.get(`${item.id}:${index}`);
      const mappedTask = manual?.task_id ? taskById.get(manual.task_id) : null;
      if (manual) return { name, suggestionId: null, taskIds: mappedTask ? [mappedTask.id] : [],
        state: mappedTask ? mappedTask.status === 'done' ? 'done' : 'pending' : 'unmapped',
        source: mappedTask ? 'manual' : 'manual_stale',
        version: manual.version, mappedTaskId: mappedTask?.id || null };
      const matches = (topicMatches.get(topicKey(name)) || []).filter(match => match.id !== item.id);
      if (matches.length !== 1) return { name, suggestionId: null, taskIds: [], state: matches.length ? 'ambiguous' : 'unmapped',
        source: 'auto', version: 0, mappedTaskId: null };
      const matched = matches[0];
      const taskIds = matched.status === 'ignored' ? [] : matched.linkedTaskIds;
      return { name, suggestionId: matched.id, taskIds,
        state: taskIds.length ? taskIds.every(id => taskById.get(id)?.status === 'done') ? 'done' : 'pending' : 'unmapped',
        source: 'auto', version: 0, mappedTaskId: null };
    });
  }
  const impactRank = { high: 0, medium: 1, low: 2 };
  const suggestionOrder = new Map(suggestionRows.rows.map((row,index) => [row.id,index]));
  const stale = analysis.goal !== repository.goal || analysis.requirement_baseline !== repository.requirement_baseline
    || analysis.baseline_version_id !== repository.baseline_version_id
    || analysis.commit_sha.trim() !== repository.commit_sha.trim() || analysis.branch !== repository.branch;
  const nextSuggestion = stale ? null : suggestions
    .filter(item => item.status === 'pending' && item.prerequisiteMappings.every(mapping => mapping.state === 'done'))
    .sort((a,b) => (impactRank[a.impact] ?? 3)-(impactRank[b.impact] ?? 3) || suggestionOrder.get(a.id)-suggestionOrder.get(b.id))[0];
  const nextTask = tasks.find(task => ['todo','in_progress'].includes(task.status) && task.externalBlockingCount === 0 && task.dependencyIds.every(id => tasks.find(item => item.id === id)?.status === 'done'));
  return { status: 200, data: {
    repositoryId, analysisId, commitSha: analysis.commit_sha.trim(), previousAnalysisId: previousId,
    stale,
    nextTaskId: nextTask?.id || null, nextSuggestionId: nextSuggestion?.id || null,
    nextSuggestionReason: nextSuggestion ? nextSuggestion.prerequisites.length ? '已明确关联的前置任务均标为完成；仍需自行核验掌握程度' : '报告未列前置知识，按建议影响程度优先；仍需自行核验掌握程度' : null,
    tasks, suggestions,
    evidenceTruncated: noteRows.rows.length > 500 || experimentRows.rows.length > 500,
    evidenceScope: '仅关联当前账号可见的任务、本人笔记、本人会话来源和本人实验；学习记录不等于能力证明',
  } };
}
