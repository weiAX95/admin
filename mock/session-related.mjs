import { isAdministrator } from './roles.mjs';

const STOP_WORDS = new Set(['what', 'how', 'why', 'is', 'are', 'the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'about', '是什么', '什么是', '怎么', '如何', '问题', '学习', '一下', '请问', '介绍', '使用']);

function terms(content) {
  const result = new Set();
  for (const match of content.toLowerCase().matchAll(/[\p{Script=Han}]{2,}|[a-z][a-z0-9+#.-]{1,}/gu)) {
    const word = match[0];
    if (STOP_WORDS.has(word)) continue;
    if (/^[\p{Script=Han}]+$/u.test(word) && word.length > 2) {
      for (let index = 0; index < word.length - 1; index++) {
        const pair = word.slice(index, index + 2);
        if (!STOP_WORDS.has(pair)) result.add(pair);
      }
    } else result.add(word);
  }
  return result;
}

export function rankRelatedSessions(base, candidates) {
  const baseTerms = terms(base.questions.join('\n'));
  if (!baseTerms.size) return [];
  return candidates.filter(item => item.id !== base.id).map(item => {
    const candidateTerms = terms(item.questions.join('\n'));
    let shared = 0;
    for (const term of candidateTerms) if (baseTerms.has(term)) shared++;
    const score = shared / (baseTerms.size + candidateTerms.size - shared || 1);
    return { id: item.id, title: item.title, createdAt: item.createdAt, score };
  }).filter(item => item.score >= 0.15).sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).slice(0, 5);
}

export async function getRelatedSessions(pool, sessionId, me) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) return { status: 400, data: { error: '会话 ID 无效' } };
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const baseResult = await client.query("SELECT id,external_user_id FROM sessions WHERE id=$1 AND ($2 OR ingested_by=$3)", [sessionId, isAdministrator(me), me.id]);
    if (!baseResult.rows.length) {
      await client.query('ROLLBACK');
      return { status: 404, data: { error: '会话不存在' } };
    }
    const result = await client.query(`SELECT s.id,s.created_at,m.content,m.item_order
      FROM sessions s LEFT JOIN session_messages m ON m.session_id=s.id AND m.role='user'
      WHERE s.external_user_id=$1 AND ($2 OR s.ingested_by=$3) ORDER BY s.id,m.item_order`, [baseResult.rows[0].external_user_id, isAdministrator(me), me.id]);
    await client.query('COMMIT');
    const grouped = new Map();
    for (const row of result.rows) {
      if (!grouped.has(row.id)) grouped.set(row.id, { id: row.id, createdAt: row.created_at, title: '（无标题）', questions: [] });
      if (row.content !== null) {
        const item = grouped.get(row.id);
        if (!item.questions.length) item.title = row.content.slice(0, 40) || '（无标题）';
        item.questions.push(row.content);
      }
    }
    const base = grouped.get(sessionId);
    return { status: 200, data: { items: rankRelatedSessions(base, [...grouped.values()]) } };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
