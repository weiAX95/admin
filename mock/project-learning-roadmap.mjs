const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, error) => ({ status, data: { error } });
const key = item => `${item.topic.trim().replace(/\s+/g,' ').toLocaleLowerCase()}\n${item.practice.trim().replace(/\s+/g,' ').toLocaleLowerCase()}`;

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

export async function handleProjectLearningRoadmap({ pathname, method, client, me }) {
  const match = pathname.match(/^\/api\/project-repositories\/([^/]+)\/roadmap\/([^/]+)$/);
  if (!match) return null;
  if (method !== 'GET') return fail(405,'不支持该操作');
  const [,repositoryId,analysisId] = match;
  if (!UUID.test(repositoryId) || !UUID.test(analysisId)) return fail(404,'学习路线不存在');
  const repository = (await client.query('SELECT id,owner_id,goal,baseline_version_id,commit_sha FROM project_repositories WHERE id=$1 AND owner_id=$2',[repositoryId,me.id])).rows[0];
  if (!repository) return fail(404,'项目不存在');
  const analysis = (await client.query("SELECT id,repository_id,commit_sha,branch,goal,baseline_version_id,finished_at,analysis_coverage_complete,selected_file_count,available_file_count FROM project_analyses WHERE id=$1 AND repository_id=$2 AND owner_id=$3 AND status='completed'",[analysisId,repositoryId,me.id])).rows[0];
  if (!analysis) return fail(404,'已完成报告不存在');
  const [taskRows,suggestionRows,previousRows] = await Promise.all([
    client.query(`SELECT t.id,t.title,t.status,t.progress,t.priority,t.phase,l.requirement_id
      FROM project_repository_tasks l JOIN tasks t ON t.id=l.task_id
      WHERE l.repository_id=$1 AND t.owner_id=$2 AND t.deleted_at IS NULL`,[repositoryId,me.id]),
    client.query(`SELECT s.id,s.topic,s.reason,s.practice,s.acceptance,s.impact,s.prerequisites,
      f.requirement_id,d.state AS decision_state,d.task_id AS decision_task_id
      FROM project_analysis_suggestions s LEFT JOIN project_analysis_findings f ON f.id=s.finding_id
      LEFT JOIN project_suggestion_decisions d ON d.suggestion_id=s.id
      WHERE s.analysis_id=$1 ORDER BY s.position`,[analysisId]),
    analysis.baseline_version_id && analysis.analysis_coverage_complete ? client.query(`SELECT id FROM project_analyses
      WHERE repository_id=$1 AND owner_id=$2 AND status='completed' AND id<>$3 AND finished_at<$4
        AND branch=$5 AND goal=$6 AND baseline_version_id=$7 AND analysis_coverage_complete=true
        AND selected_file_count=$8 AND available_file_count=$9
      ORDER BY finished_at DESC,id DESC LIMIT 1`,[repositoryId,me.id,analysis.id,analysis.finished_at,analysis.branch,analysis.goal,analysis.baseline_version_id,analysis.selected_file_count,analysis.available_file_count]) : Promise.resolve({ rows: [] }),
  ]);
  const taskIds = taskRows.rows.map(row => row.id);
  const previousId = previousRows.rows[0]?.id || null;
  const [edgeRows,noteRows,experimentRows,oldSuggestionRows] = await Promise.all([
    taskIds.length ? client.query('SELECT d.task_id,d.dependency_id,dependency.status AS dependency_status,dependency.deleted_at AS dependency_deleted_at FROM task_dependencies d JOIN tasks dependency ON dependency.id=d.dependency_id WHERE d.task_id=ANY($1::text[])',[taskIds]) : Promise.resolve({ rows: [] }),
    taskIds.length ? client.query(`SELECT n.id,n.title,n.task_id,s.id AS session_id
      FROM notes n LEFT JOIN sessions s ON s.id=n.source_session_id AND s.ingested_by=$2
      WHERE n.task_id=ANY($1::text[]) AND n.owner_id=$2 AND n.deleted_at IS NULL
      ORDER BY n.updated_at DESC LIMIT 501`,[taskIds,me.id]) : Promise.resolve({ rows: [] }),
    taskIds.length ? client.query(`SELECT id,title,task_id,record_kind FROM experiments
      WHERE task_id=ANY($1::text[]) AND owner_id=$2 AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 501`,[taskIds,me.id]) : Promise.resolve({ rows: [] }),
    previousId ? client.query('SELECT topic,practice FROM project_analysis_suggestions WHERE analysis_id=$1',[previousId]) : Promise.resolve({ rows: [] }),
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
    impact: item.impact, prerequisites: item.prerequisites || [], status: item.decision_state || 'pending',
    requirementId: item.requirement_id, newSincePrevious: previousId ? !oldKeys.has(key(item)) : null,
    linkedTaskIds: tasks.filter(task => task.id === item.decision_task_id || item.requirement_id && task.requirementId === item.requirement_id).map(task => task.id),
  }));
  const nextTask = tasks.find(task => ['todo','in_progress'].includes(task.status) && task.externalBlockingCount === 0 && task.dependencyIds.every(id => tasks.find(item => item.id === id)?.status === 'done'));
  return { status: 200, data: {
    repositoryId, analysisId, commitSha: analysis.commit_sha.trim(), previousAnalysisId: previousId,
    stale: analysis.goal !== repository.goal || analysis.baseline_version_id !== repository.baseline_version_id || analysis.commit_sha.trim() !== repository.commit_sha.trim(),
    nextTaskId: nextTask?.id || null, tasks, suggestions,
    evidenceTruncated: noteRows.rows.length > 500 || experimentRows.rows.length > 500,
    evidenceScope: '仅关联当前账号可见的任务、本人笔记、本人会话来源和本人实验；学习记录不等于能力证明',
  } };
}
