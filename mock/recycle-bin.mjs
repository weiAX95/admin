const sources = {
  task: { table: 'tasks', title: 'title' },
  note: { table: 'notes', title: 'title' },
  experiment: { table: 'experiments', title: 'title' },
  prompt: { table: 'prompt_library', title: 'name' },
};
export async function handleRecycleBin({ pathname, method, client, me, readBody }) {
  if (!pathname.startsWith('/api/settings/recycle-bin')) return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可管理回收站' } };
  if (pathname === '/api/settings/recycle-bin' && method === 'GET') {
    const items = [];
    for (const [type, source] of Object.entries(sources)) {
      const rows = (await client.query(`SELECT id,${source.title} AS title,deleted_at FROM ${source.table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)).rows;
      for (const row of rows) items.push({ type, id: row.id, title: row.title, deletedAt: row.deleted_at });
    }
    items.sort((left,right) => new Date(right.deletedAt).getTime() - new Date(left.deletedAt).getTime());
    return { status: 200, data: { items } };
  }
  const match = pathname.match(/^\/api\/settings\/recycle-bin\/(task|note|experiment|prompt)\/([^/]+)\/(restore|purge)$/);
  if (!match || method !== 'POST') return null;
  const [, type, id, action] = match;
  const source = sources[type];
  const row = (await client.query(`SELECT id,${source.title} AS title FROM ${source.table} WHERE id=$1 AND deleted_at IS NOT NULL FOR UPDATE`, [id])).rows[0];
  if (!row) return { status: 404, data: { error: '回收站记录不存在' } };
  if (action === 'restore') {
    if (type === 'task') {
      const invalid = (await client.query('SELECT dependency_id FROM task_dependencies WHERE task_id=$1 AND dependency_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL)', [id])).rows;
      if (invalid.length) return { status: 409, data: { error: `前置任务仍在回收站：${invalid.map(item => item.dependency_id).join('、')}` } };
    }
    await client.query(`UPDATE ${source.table} SET deleted_at=NULL WHERE id=$1`, [id]);
    if (type !== 'task') return { status: 200, data: { restored: true, id, type } };
    const pending = (await client.query(`SELECT e.deleted_task_id,e.dependent_task_id,e.original_position,e.expected_dependency_ids,
      parent.deleted_at AS parent_deleted_at,dependent.deleted_at AS dependent_deleted_at
      FROM task_dependency_restore_edges e JOIN tasks parent ON parent.id=e.deleted_task_id
      JOIN tasks dependent ON dependent.id=e.dependent_task_id
      WHERE e.deleted_task_id=$1 OR e.dependent_task_id=$1 ORDER BY e.dependent_task_id,e.original_position FOR UPDATE OF e`, [id])).rows;
    const edges = pending.filter(edge => !edge.parent_deleted_at && !edge.dependent_deleted_at);
    const deferredDependencies = pending.length - edges.length;
    const data = await loadData(client);
    const before = structuredClone(data);
    const skippedDependencies = [];
    let restoredDependencies = 0;
    for (const edge of edges) {
      const dependent = data.tasks.find(task => task.id === edge.dependent_task_id);
      if (!dependent) { skippedDependencies.push({ taskId: edge.dependent_task_id, reason: '关联任务已删除或仍在回收站' }); continue; }
      const oldIds = dependent.dependencyIds || [];
      if (JSON.stringify(oldIds) !== JSON.stringify(edge.expected_dependency_ids)) { skippedDependencies.push({ taskId: dependent.id, reason: '关联任务的依赖已被修改' }); continue; }
      const nextIds = [...oldIds];
      nextIds.splice(Math.min(edge.original_position,nextIds.length),0,edge.deleted_task_id);
      const error = validateDependencies(data.tasks,dependent.id,nextIds,{ id: me.id, role: 'admin' });
      if (error) { skippedDependencies.push({ taskId: dependent.id, reason: error }); continue; }
      const original = structuredClone(dependent);
      dependent.dependencyIds = nextIds;
      dependent.version = (dependent.version || 1) + 1;
      dependent.updatedAt = new Date().toISOString();
      recordTaskChanges(data,original,dependent,me);
      const predecessor = data.tasks.find(task => task.id === edge.deleted_task_id);
      data.activity.unshift({ id: crypto.randomUUID(), type: 'update', taskId: dependent.id, title: dependent.title, detail: `恢复前置任务「${predecessor?.title || edge.deleted_task_id}」的依赖`, at: dependent.updatedAt, userId: me.id, username: me.username || me.id, userName: me.name || me.username || me.id });
      await client.query('UPDATE task_dependency_restore_edges SET expected_dependency_ids=$3::jsonb WHERE dependent_task_id=$1 AND deleted_task_id<>$2 AND expected_dependency_ids=$4::jsonb', [dependent.id,edge.deleted_task_id,JSON.stringify(nextIds),JSON.stringify(oldIds)]);
      restoredDependencies++;
    }
    if (restoredDependencies) {
      data.activity.length = Math.min(data.activity.length,500);
      await saveData(client,before,data);
    }
    for (const edge of edges) await client.query('DELETE FROM task_dependency_restore_edges WHERE deleted_task_id=$1 AND dependent_task_id=$2', [edge.deleted_task_id,edge.dependent_task_id]);
    return { status: 200, data: { restored: true, id, type, restoredDependencies, deferredDependencies, skippedDependencies } };
  }
  const body = await readBody();
  if (body?.confirmTitle !== row.title) return { status: 400, data: { error: '请确认资源名称后永久删除' } };
  if (type === 'prompt') {
    const referenced = await client.query('SELECT 1 FROM prompt_run_uses u JOIN prompt_library_versions v ON v.id=u.version_id WHERE v.prompt_id=$1 LIMIT 1', [id]);
    if (referenced.rowCount) return { status: 409, data: { error: '提示词版本仍被运行记录引用，不能永久删除' } };
    const included = await client.query('SELECT 1 FROM prompt_version_includes r JOIN prompt_library_versions v ON v.id=r.target_version_id WHERE v.prompt_id=$1 LIMIT 1', [id]);
    if (included.rowCount) return { status: 409, data: { error: '提示词版本仍被其他提示词引用，不能永久删除' } };
  }
  await client.query('SAVEPOINT recycle_purge');
  try { await client.query(`DELETE FROM ${source.table} WHERE id=$1`, [id]); await client.query('RELEASE SAVEPOINT recycle_purge'); }
  catch { await client.query('ROLLBACK TO SAVEPOINT recycle_purge'); await client.query('RELEASE SAVEPOINT recycle_purge'); return { status: 409, data: { error: '关联记录阻止永久删除，请先处理引用关系' } }; }
  return { status: 200, data: { purged: true, id, type } };
}
import crypto from 'node:crypto';
import { loadData, saveData } from './postgres-store.mjs';
import { validateDependencies } from './task-dependencies.mjs';
import { recordTaskChanges } from './task-change-log.mjs';
