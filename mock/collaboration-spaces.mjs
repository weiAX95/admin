import crypto from 'node:crypto';

const fail = (status, error) => ({ status, data: { error } });
const ok = (data, status = 200) => ({ status, data });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const role = value => ['editor', 'viewer'].includes(value);

async function transact(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    if (result.status >= 400) await client.query('ROLLBACK');
    else await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function visibleSpace(client, id, userId, lock = false) {
  const result = await client.query(`SELECT s.*, CASE WHEN s.owner_id=$2 THEN 'owner' ELSE m.role END AS my_role
    FROM collaboration_spaces s LEFT JOIN collaboration_space_members m ON m.space_id=s.id AND m.user_id=$2
    WHERE s.id=$1 AND s.deleted_at IS NULL AND (s.owner_id=$2 OR m.user_id IS NOT NULL) ${lock ? 'FOR UPDATE OF s' : ''}`, [id,userId]);
  return result.rows[0];
}

function view(row) {
  return { id: row.id, name: row.name, description: row.description, icon: row.icon, ownerId: row.owner_id,
    status: row.status, role: row.my_role, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function handleCollaborationSpaces({ pathname, method, client: pool, me, readBody, url }) {
  if (pathname === '/api/spaces') {
    if (method === 'GET') {
      const rows = (await pool.query(`SELECT s.*, CASE WHEN s.owner_id=$1 THEN 'owner' ELSE m.role END AS my_role
        FROM collaboration_spaces s LEFT JOIN collaboration_space_members m ON m.space_id=s.id AND m.user_id=$1
        WHERE s.deleted_at IS NULL AND (s.owner_id=$1 OR m.user_id IS NOT NULL) ORDER BY s.created_at DESC,s.id`,[me.id])).rows;
      return ok({ items: rows.map(view) });
    }
    if (method !== 'POST') return fail(405,'请求方式不支持');
    const body = await readBody();
    const name = String(body?.name || '').trim(), description = String(body?.description || '').trim(), icon = String(body?.icon || 'team').trim();
    if (!name || name.length > 80 || description.length > 2000 || !/^[a-z0-9_-]{1,40}$/i.test(icon)) return fail(400,'空间名称、说明或图标无效');
    const row = (await pool.query(`INSERT INTO collaboration_spaces(id,name,description,icon,owner_id)
      VALUES($1,$2,$3,$4,$5) RETURNING *, 'owner'::text AS my_role`,[crypto.randomUUID(),name,description,icon,me.id])).rows[0];
    return ok(view(row),201);
  }
  const match = /^\/api\/spaces\/([^/]+)(?:\/(members|transfer|candidates))?(?:\/([^/]+))?$/.exec(pathname);
  if (!match) return null;
  const [,id,section,memberId] = match;
  if (!uuid.test(id)) return fail(404,'空间不存在');
  if (method === 'GET') {
    const space = await visibleSpace(pool,id,me.id);
    if (!space) return fail(404,'空间不存在或无权访问');
    if (section === 'members' && !memberId) {
      const rows = (await pool.query(`SELECT u.id,u.username,u.name,m.role,m.added_at FROM collaboration_space_members m
        JOIN users u ON u.id=m.user_id WHERE m.space_id=$1 ORDER BY m.added_at,u.id`,[id])).rows;
      return ok({ ownerId: space.owner_id, items: rows.map(row => ({ id:row.id,username:row.username,name:row.name,role:row.role,addedAt:row.added_at })) });
    }
    if (section === 'candidates' && !memberId) {
      if (space.my_role !== 'owner') return fail(403,'仅空间 Owner 可查找成员');
      const query = String(url?.searchParams.get('query') || '').trim().slice(0,80);
      const rows = (await pool.query(`SELECT u.id,u.username,u.name FROM users u WHERE u.status='active' AND u.deleted_at IS NULL
        AND u.id <> $2 AND (u.username ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%')
        AND NOT EXISTS(SELECT 1 FROM collaboration_space_members m WHERE m.space_id=$3 AND m.user_id=u.id)
        ORDER BY u.username LIMIT 20`,[query,space.owner_id,id])).rows;
      return ok({ items:rows });
    }
    return !section ? ok(view(space)) : fail(404,'接口不存在');
  }
  return transact(pool, async client => {
    const space = await visibleSpace(client,id,me.id,true);
    if (!space) return fail(404,'空间不存在或无权访问');
    if (space.my_role !== 'owner') return fail(403,'仅空间 Owner 可管理空间和成员');
    if (space.status === 'archived' && !(method === 'PATCH' && !section)) return fail(409,'空间已归档，请先恢复');
    if (!section && method === 'PATCH') {
      const body = await readBody();
      if (!Number.isInteger(body?.version) || body.version !== space.version) return fail(409,'空间版本已变化，请刷新');
      const name = body.name === undefined ? space.name : String(body.name).trim();
      const description = body.description === undefined ? space.description : String(body.description).trim();
      const icon = body.icon === undefined ? space.icon : String(body.icon).trim();
      const status = body.status === undefined ? space.status : body.status;
      if (!name || name.length > 80 || description.length > 2000 || !/^[a-z0-9_-]{1,40}$/i.test(icon) || !['active','archived'].includes(status)) return fail(400,'空间设置无效');
      const row = (await client.query(`UPDATE collaboration_spaces SET name=$2,description=$3,icon=$4,status=$5,version=version+1,updated_at=now()
        WHERE id=$1 RETURNING *, 'owner'::text AS my_role`,[id,name,description,icon,status])).rows[0];
      return ok(view(row));
    }
    if (!section && method === 'DELETE') {
      const body = await readBody();
      if (body?.version !== space.version) return fail(409,'空间版本已变化，请刷新');
      await client.query('UPDATE collaboration_spaces SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1',[id]);
      return ok({ deleted:true, recoverUntil: new Date(Date.now()+30*86400000).toISOString() });
    }
    if (section === 'members' && !memberId && method === 'POST') {
      const body = await readBody();
      if (!Array.isArray(body?.members) || !body.members.length || body.members.length > 100 || body.members.some(item => typeof item.userId !== 'string' || !role(item.role) || item.userId === me.id)) return fail(400,'成员列表无效');
      const ids = body.members.map(item => item.userId);
      if (new Set(ids).size !== ids.length) return fail(400,'成员不能重复');
      const valid = (await client.query("SELECT id FROM users WHERE id=ANY($1::text[]) AND status='active' AND deleted_at IS NULL",[ids])).rows;
      if (valid.length !== ids.length) return fail(400,'成员账号不存在或已停用');
      for (const item of body.members) await client.query(`INSERT INTO collaboration_space_members(space_id,user_id,role) VALUES($1,$2,$3)
        ON CONFLICT (space_id,user_id) DO UPDATE SET role=EXCLUDED.role`,[id,item.userId,item.role]);
      return ok({ saved:ids.length });
    }
    if (section === 'members' && memberId && method === 'PATCH') {
      const body = await readBody();
      if (!role(body?.role)) return fail(400,'空间角色无效');
      const result = await client.query('UPDATE collaboration_space_members SET role=$3 WHERE space_id=$1 AND user_id=$2',[id,memberId,body.role]);
      return result.rowCount ? ok({ saved:true }) : fail(404,'成员不存在');
    }
    if (section === 'members' && memberId && method === 'DELETE') {
      const result = await client.query('DELETE FROM collaboration_space_members WHERE space_id=$1 AND user_id=$2',[id,memberId]);
      return result.rowCount ? ok({ deleted:true }) : fail(404,'成员不存在');
    }
    if (section === 'transfer' && !memberId && method === 'POST') {
      const body = await readBody();
      if (body?.version !== space.version || typeof body?.userId !== 'string') return fail(409,'空间版本已变化或目标无效');
      const member = (await client.query('SELECT role FROM collaboration_space_members WHERE space_id=$1 AND user_id=$2',[id,body.userId])).rows[0];
      if (!member) return fail(400,'新 Owner 必须是现有空间成员');
      await client.query('DELETE FROM collaboration_space_members WHERE space_id=$1 AND user_id=$2',[id,body.userId]);
      await client.query('INSERT INTO collaboration_space_members(space_id,user_id,role) VALUES($1,$2,$3)',[id,me.id,'editor']);
      await client.query('UPDATE collaboration_spaces SET owner_id=$2,version=version+1,updated_at=now() WHERE id=$1',[id,body.userId]);
      return ok({ ownerId:body.userId });
    }
    return fail(405,'请求方式不支持');
  });
}
