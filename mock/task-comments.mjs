import crypto from 'node:crypto';
import { isAdministrator } from './roles.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, error) => ({ status, data: { error } });
const mentions = content => [...new Set([...content.matchAll(/(?<![\p{L}\p{N}_])@([\p{L}\p{N}_.-]{1,30})/gu)].map(match => match[1]))];
const view = row => ({ id:row.id, taskId:row.task_id, parentId:row.parent_id, authorId:row.author_id,
  authorName:row.author_name || '已删除账号', content:row.deleted_at ? null : row.content,
  version:row.version, createdAt:row.created_at, updatedAt:row.updated_at, deletedAt:row.deleted_at });

async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query(result.status >= 400 ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function notifyMentions(client, task, commentId, author, content, priorContent = '') {
  const prior = new Set(mentions(priorContent));
  const usernames = mentions(content).filter(name => !prior.has(name));
  if (!usernames.length) return;
  const recipients = (await client.query(`SELECT id FROM users WHERE username=ANY($1::text[]) AND status='active' AND deleted_at IS NULL
    AND (id=$2 OR role IN ('admin','super_admin'))`,[usernames,task.owner_id])).rows;
  for (const recipient of recipients) {
    if (recipient.id === author.id) continue;
    await client.query(`INSERT INTO app_notifications(id,user_id,kind,entity_id,title,body,target_url)
      VALUES($1,$2,'task_comment_mention',$3,$4,$5,$6)
      ON CONFLICT(user_id,kind,entity_id) DO NOTHING`,[crypto.randomUUID(),recipient.id,commentId,
      '任务评论提及了你',`${author.name || author.username} 在「${task.title.slice(0,80)}」的评论中提及了你`,
      `/tasks/${encodeURIComponent(task.id)}`]);
  }
}

export async function handleTaskComments({ pathname, method, pool, me, url, readBody }) {
  const match = /^\/api\/tasks\/([^/]+)\/comments(?:\/([^/]+))?$/.exec(pathname);
  if (!match) return null;
  const [,taskId,commentId] = match;
  if (!taskId || commentId && !uuid.test(commentId)) return fail(404,'评论不存在');
  const task = (await pool.query('SELECT id,title,owner_id FROM tasks WHERE id=$1 AND deleted_at IS NULL',[taskId])).rows[0];
  if (!task || !isAdministrator(me) && task.owner_id !== me.id) return fail(404,'任务不存在或无权访问');
  const select = `SELECT c.*,COALESCE(u.name,u.username) AS author_name FROM task_comments c
    LEFT JOIN users u ON u.id=c.author_id`;
  if (!commentId && method === 'GET') {
    const order = url.searchParams.get('order') === 'oldest' ? 'ASC' : 'DESC';
    const offset = Math.max(0,Math.min(100000,Number.parseInt(url.searchParams.get('offset') || '0',10) || 0));
    const limit = Math.max(1,Math.min(50,Number.parseInt(url.searchParams.get('limit') || '20',10) || 20));
    const roots = (await pool.query(`${select} WHERE c.task_id=$1 AND c.parent_id IS NULL
      ORDER BY c.created_at ${order},c.id ${order} LIMIT $2 OFFSET $3`,[taskId,limit,offset])).rows;
    const total = Number((await pool.query('SELECT count(*) AS count FROM task_comments WHERE task_id=$1 AND parent_id IS NULL',[taskId])).rows[0].count);
    if (!roots.length) return { status:200, data:{ items:[],total } };
    const replies = (await pool.query(`${select} WHERE c.parent_id=ANY($1::uuid[]) ORDER BY c.created_at,c.id`,[roots.map(row=>row.id)])).rows;
    const byRoot = new Map(roots.map(row=>[row.id,[]]));
    for (const row of replies) byRoot.get(row.parent_id)?.push(view(row));
    return { status:200, data:{ items:roots.map(row=>({ ...view(row), replies:byRoot.get(row.id) })),total } };
  }
  if (!commentId && method === 'POST') {
    const body = await readBody();
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content || content.length > 10000) return fail(400,'评论内容须为 1–10000 字');
    const parentId = body?.parentId ?? null;
    if (parentId !== null && !uuid.test(parentId)) return fail(400,'回复目标无效');
    return withTransaction(pool,async client=>{
      if (parentId) {
        const parent = (await client.query('SELECT task_id,parent_id,deleted_at FROM task_comments WHERE id=$1 FOR SHARE',[parentId])).rows[0];
        if (!parent || parent.task_id !== taskId || parent.parent_id || parent.deleted_at) return fail(400,'只能回复当前任务的顶层评论');
      }
      const created = (await client.query(`INSERT INTO task_comments(id,task_id,parent_id,author_id,content)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,[crypto.randomUUID(),taskId,parentId,me.id,content])).rows[0];
      await notifyMentions(client,task,created.id,me,content);
      return { status:201, data:view({ ...created,author_name:me.name || me.username }) };
    });
  }
  if (commentId && ['PATCH','DELETE'].includes(method)) {
    const body = await readBody();
    if (!Number.isSafeInteger(body?.version) || body.version < 1) return fail(400,'评论版本无效');
    const content = method === 'PATCH' && typeof body?.content === 'string' ? body.content.trim() : '';
    if (method === 'PATCH' && (!content || content.length > 10000)) return fail(400,'评论内容须为 1–10000 字');
    return withTransaction(pool,async client=>{
      const current = (await client.query('SELECT * FROM task_comments WHERE id=$1 AND task_id=$2 FOR UPDATE',[commentId,taskId])).rows[0];
      if (!current || current.deleted_at) return fail(404,'评论不存在');
      if (current.author_id !== me.id && !isAdministrator(me)) return fail(403,'只能修改自己的评论');
      if (current.version !== body.version) return fail(409,'评论已更新，请刷新后重试');
      const changed = (await client.query(method === 'PATCH'
        ? `UPDATE task_comments SET content=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`
        : `UPDATE task_comments SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
      method === 'PATCH' ? [commentId,content] : [commentId])).rows[0];
      if (method === 'PATCH') await notifyMentions(client,task,commentId,me,content,current.content);
      return { status:200, data:view({ ...changed,author_name:me.name || me.username }) };
    });
  }
  return fail(405,'请求方式不支持');
}
