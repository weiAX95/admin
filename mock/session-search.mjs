import { isAdministrator } from './roles.mjs';

const PAGE_SIZE = 20;
const MAX_QUERY_LENGTH = 200;
const SEARCH_TIMEOUT_MS = 750;

const escapeLike = value => value.replace(/[\\%_]/g, character => `\\${character}`);

function excerpt(content, start, end) {
  const characters = Array.from(content);
  const first = Math.max(0, start - 1);
  const last = Math.max(first, end - 1);
  const left = Math.max(0, first - 30);
  const right = Math.min(characters.length, last + 30);
  return {
    before: `${left ? '…' : ''}${characters.slice(left, first).join('')}`,
    match: characters.slice(first, last).join(''),
    after: `${characters.slice(last, right).join('')}${right < characters.length ? '…' : ''}`,
  };
}

export async function searchSessions(pool, { query, regex = false, page = 1, me }) {
  const term = typeof query === 'string' ? query.trim() : '';
  if (!term || term.length > MAX_QUERY_LENGTH) return { status: 400, data: { error: '搜索词须为 1–200 字' } };
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return { status: 400, data: { error: '页码无效' } };
  const matchPredicate = regex ? 'm.content ~* $1' : "m.content ILIKE $1 ESCAPE '\\'";
  const firstPosition = regex ? "regexp_instr(m.content,$1,1,1,0,'i')" : 'strpos(lower(m.content),lower($2))';
  const lastPosition = regex ? "regexp_instr(m.content,$1,1,1,1,'i')" : 'strpos(lower(m.content),lower($2)) + char_length($2)';
  const parameters = regex ? [term, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE] : [`%${escapeLike(term)}%`, term, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE];
  const limitPosition = regex ? '$2' : '$3';
  const offsetPosition = regex ? '$3' : '$4';
  const rolePosition = `$${parameters.length + 1}`;
  const ownerPosition = `$${parameters.length + 2}`;
  parameters.push(isAdministrator(me), me.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${SEARCH_TIMEOUT_MS}ms'`);
    const result = await client.query(`SELECT m.session_id,m.id AS message_id,m.role,m.content,m.at,
      s.external_user_id AS user_id,coalesce(heading.title,'（无标题）') AS session_title,
      ${firstPosition} AS match_start,${lastPosition} AS match_end
      FROM session_messages m JOIN sessions s ON s.id=m.session_id
      LEFT JOIN LATERAL (SELECT left(content,40) AS title FROM session_messages first_message
        WHERE first_message.session_id=s.id AND first_message.role='user' ORDER BY item_order LIMIT 1) heading ON true
      WHERE ${matchPredicate} AND (${rolePosition} OR s.ingested_by=${ownerPosition})
      ORDER BY s.updated_at DESC,m.session_id,m.item_order,m.id LIMIT ${limitPosition} OFFSET ${offsetPosition}`, parameters);
    await client.query('COMMIT');
    const rows = result.rows;
    return { status: 200, data: {
      items: rows.slice(0, PAGE_SIZE).map(row => ({
        sessionId: row.session_id, messageId: row.message_id, role: row.role,
        userId: row.user_id, sessionTitle: row.session_title, at: row.at,
        snippet: excerpt(row.content, Number(row.match_start), Number(row.match_end)),
      })),
      page, hasMore: rows.length > PAGE_SIZE,
    } };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '2201B') return { status: 400, data: { error: '正则表达式无效' } };
    if (error.code === '57014') return { status: 408, data: { error: '搜索超时，请缩小范围或简化正则' } };
    throw error;
  } finally {
    client.release();
  }
}
