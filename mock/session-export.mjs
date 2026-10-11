const MAX_SESSIONS = 50;

function fenced(value) {
  let longest = 0;
  for (const match of String(value).matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${value}\n${fence}`;
}

function markdown(sessions, exportedAt) {
  const lines = ['# 会话导出', '', `导出时间：${exportedAt}`, `会话数量：${sessions.length}`, ''];
  for (const session of sessions) {
    lines.push(`## 会话 ${session.id}`, '', `- 聊天端用户 ID：${session.userId}`, `- 创建时间：${session.createdAt}`, `- 更新时间：${session.updatedAt}`, `- 消息数：${session.messages.length}`, '');
    for (const entry of session.messages) {
      lines.push(`### ${entry.role === 'assistant' ? 'Assistant' : 'User'} · ${entry.at}`, '', fenced(entry.content), '');
      for (const annotation of entry.annotations) lines.push(`- 标注：${annotation.rating}/5；标签：${annotation.tags.join('、') || '无'}；时间：${annotation.updatedAt}`);
      if (entry.annotations.length) lines.push('');
    }
  }
  return lines.join('\n');
}

export async function exportSessions(pool, body, role, now = new Date()) {
  const { ids, format } = body || {};
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_SESSIONS || ids.some(id => typeof id !== 'string' || !id || id.length > 200) || new Set(ids).size !== ids.length) {
    return { status: 422, error: '请选择 1–50 条不重复的会话' };
  }
  if (!['json', 'markdown'].includes(format)) return { status: 422, error: '导出格式无效' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const sessionsResult = await client.query('SELECT id,external_user_id,created_at,updated_at FROM sessions WHERE id=ANY($1::text[])', [ids]);
    if (sessionsResult.rows.length !== ids.length) {
      await client.query('ROLLBACK');
      return { status: 404, error: '所选会话不存在，请刷新列表后重试' };
    }
    const messagesResult = await client.query('SELECT session_id,id,role,content,at,item_order FROM session_messages WHERE session_id=ANY($1::text[]) ORDER BY session_id,item_order,id', [ids]);
    const annotationsResult = await client.query(`SELECT a.id,a.session_id,a.message_id,a.reviewer_id,a.rating,a.created_at,a.updated_at,
      coalesce(array_agg(t.tag ORDER BY t.tag) FILTER (WHERE t.tag IS NOT NULL),ARRAY[]::text[]) AS tags
      FROM message_annotations a LEFT JOIN annotation_tags t ON t.annotation_id=a.id
      WHERE a.session_id=ANY($1::text[]) GROUP BY a.id ORDER BY a.session_id,a.message_id,a.created_at,a.id`, [ids]);
    await client.query('COMMIT');
    const annotations = new Map();
    for (const row of annotationsResult.rows) {
      const key = `${row.session_id}\0${row.message_id}`;
      if (!annotations.has(key)) annotations.set(key, []);
      annotations.get(key).push({ id: row.id, ...(role === 'admin' ? { reviewerId: row.reviewer_id } : {}), rating: row.rating, tags: row.tags, createdAt: row.created_at, updatedAt: row.updated_at });
    }
    const messages = new Map(ids.map(id => [id, []]));
    for (const row of messagesResult.rows) messages.get(row.session_id).push({ id: row.id, role: row.role, content: row.content, at: row.at, annotations: annotations.get(`${row.session_id}\0${row.id}`) || [] });
    const byId = new Map(sessionsResult.rows.map(row => [row.id, row]));
    const sessions = ids.map(id => {
      const row = byId.get(id);
      const entries = messages.get(id);
      return { id, userId: row.external_user_id, createdAt: row.created_at, updatedAt: row.updated_at,
        title: entries.find(entry => entry.role === 'user')?.content.slice(0, 40) || '（无标题）', messageCount: entries.length, messages: entries };
    });
    const exportedAt = now.toISOString();
    const content = format === 'json' ? JSON.stringify({ exportedAt, sessions }, null, 2) : markdown(sessions, exportedAt);
    const extension = format === 'json' ? 'json' : 'md';
    return { status: 200, content, contentType: format === 'json' ? 'application/json' : 'text/markdown', filename: `sessions-${exportedAt.slice(0, 10)}.${extension}` };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
