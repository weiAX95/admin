const MAX_QUERY_LENGTH = 120;
const RESULT_LIMIT = 5;
const escapeLike = value => value.replace(/[\\%_]/g, character => `\\${character}`);

// Each branch returns only a few rows, so the command palette never downloads full records.
const SEARCH_SQL = `
WITH task_hits AS (
  SELECT 'task'::text AS kind,t.id,t.title,
    left(CASE WHEN coalesce(t.description,'') ILIKE $1 ESCAPE '\\' THEN t.description ELSE coalesce(t.notes,'') END,160) AS preview,
    NULL::text AS context_id,NULL::text AS case_key,t.updated_at AS sort_at,
    CASE WHEN t.title ILIKE $1 ESCAPE '\\' THEN 0 ELSE 1 END AS rank
  FROM tasks t WHERE t.deleted_at IS NULL AND ($2='admin' OR t.owner_id=$3)
    AND (t.title ILIKE $1 ESCAPE '\\' OR coalesce(t.description,'') ILIKE $1 ESCAPE '\\' OR coalesce(t.notes,'') ILIKE $1 ESCAPE '\\')
  ORDER BY rank,t.updated_at DESC,t.id LIMIT ${RESULT_LIMIT}
), note_hits AS (
  SELECT 'note'::text AS kind,n.id,n.title,
    left(coalesce(n.content,''),160) AS preview,NULL::text AS context_id,NULL::text AS case_key,n.updated_at AS sort_at,
    CASE WHEN n.title ILIKE $1 ESCAPE '\\' THEN 0 ELSE 1 END AS rank
  FROM notes n WHERE n.deleted_at IS NULL AND (n.title ILIKE $1 ESCAPE '\\' OR coalesce(n.content,'') ILIKE $1 ESCAPE '\\')
  ORDER BY rank,n.updated_at DESC,n.id LIMIT ${RESULT_LIMIT}
), session_hits AS (
  SELECT 'session'::text AS kind,s.id,coalesce(heading.title,'（无标题）') AS title,
    left(m.content,160) AS preview,NULL::text AS context_id,NULL::text AS case_key,s.updated_at AS sort_at,
    0 AS rank
  FROM sessions s
  JOIN LATERAL (SELECT content FROM session_messages WHERE session_id=s.id AND content ILIKE $1 ESCAPE '\\' ORDER BY item_order LIMIT 1) m ON true
  LEFT JOIN LATERAL (SELECT left(content,80) AS title FROM session_messages WHERE session_id=s.id AND role='user' ORDER BY item_order LIMIT 1) heading ON true
  WHERE ($2='admin' OR s.ingested_by=$3)
  ORDER BY s.updated_at DESC,s.id LIMIT ${RESULT_LIMIT}
), experiment_hits AS (
  SELECT 'experiment'::text AS kind,e.id,e.title,
    left(CASE WHEN coalesce(e.prompt,'') ILIKE $1 ESCAPE '\\' THEN e.prompt ELSE coalesce(e.result,'') END,160) AS preview,
    NULL::text AS context_id,NULL::text AS case_key,e.updated_at AS sort_at,
    CASE WHEN e.title ILIKE $1 ESCAPE '\\' THEN 0 ELSE 1 END AS rank
  FROM experiments e WHERE e.deleted_at IS NULL
    AND (e.title ILIKE $1 ESCAPE '\\' OR coalesce(e.prompt,'') ILIKE $1 ESCAPE '\\' OR coalesce(e.result,'') ILIKE $1 ESCAPE '\\')
  ORDER BY rank,e.updated_at DESC,e.id LIMIT ${RESULT_LIMIT}
), prompt_hits AS (
  SELECT 'prompt'::text AS kind,p.id,p.name AS title,left(coalesce(v.content,''),160) AS preview,
    NULL::text AS context_id,NULL::text AS case_key,p.updated_at::text AS sort_at,
    CASE WHEN p.name ILIKE $1 ESCAPE '\\' THEN 0 ELSE 1 END AS rank
  FROM prompt_library p
  LEFT JOIN LATERAL (SELECT content FROM prompt_library_versions WHERE prompt_id=p.id ORDER BY version DESC LIMIT 1) v ON true
  WHERE p.deleted_at IS NULL AND (p.name ILIKE $1 ESCAPE '\\' OR coalesce(v.content,'') ILIKE $1 ESCAPE '\\' OR array_to_string(p.tags,' ') ILIKE $1 ESCAPE '\\')
  ORDER BY rank,p.updated_at DESC,p.id LIMIT ${RESULT_LIMIT}
), case_hits AS (
  SELECT 'case'::text AS kind,c.id,(d.name || ' · v' || v.version || ' · ' || c.case_key) AS title,
    left(coalesce(c.input_payload::text,c.variables::text,''),160) AS preview,
    v.id AS context_id,c.case_key,v.created_at::text AS sort_at,
    CASE WHEN c.case_key ILIKE $1 ESCAPE '\\' THEN 0 ELSE 1 END AS rank
  FROM experiment_dataset_cases c
  JOIN experiment_dataset_versions v ON v.id=c.dataset_version_id
  JOIN experiment_datasets d ON d.id=v.dataset_id
  WHERE c.case_key ILIKE $1 ESCAPE '\\' OR coalesce(c.input_payload::text,'') ILIKE $1 ESCAPE '\\' OR coalesce(c.variables::text,'') ILIKE $1 ESCAPE '\\'
  ORDER BY rank,v.created_at DESC,c.id LIMIT ${RESULT_LIMIT}
)
SELECT kind,id,title,preview,context_id,case_key FROM (
  SELECT * FROM task_hits UNION ALL SELECT * FROM note_hits UNION ALL SELECT * FROM session_hits
  UNION ALL SELECT * FROM experiment_hits UNION ALL SELECT * FROM prompt_hits UNION ALL SELECT * FROM case_hits
) hits ORDER BY CASE kind WHEN 'task' THEN 0 WHEN 'note' THEN 1 WHEN 'session' THEN 2 WHEN 'experiment' THEN 3 WHEN 'prompt' THEN 4 ELSE 5 END,rank,sort_at DESC,id`;

function resultUrl(row) {
  const id = encodeURIComponent(row.id);
  if (row.kind === 'task') return `/tasks/${id}`;
  if (row.kind === 'note') return `/notes/${id}`;
  if (row.kind === 'session') return `/sessions?sessionId=${id}`;
  if (row.kind === 'experiment') return `/experiments/${id}`;
  if (row.kind === 'prompt') return `/prompts/${id}`;
  return `/experiments/datasets?versionId=${encodeURIComponent(row.context_id)}&caseKey=${encodeURIComponent(row.case_key)}`;
}

export async function searchGlobally(pool, me, query) {
  const term = typeof query === 'string' ? query.trim() : '';
  if (!term || Array.from(term).length > MAX_QUERY_LENGTH) return { status: 400, data: { error: '搜索词须为 1–120 字' } };
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '280ms'");
    const rows = (await client.query(SEARCH_SQL, [`%${escapeLike(term)}%`, me.role, me.id])).rows;
    await client.query('COMMIT');
    return { status: 200, data: { items: rows.map(row => ({ type: row.kind, id: row.id, title: row.title, preview: row.preview || '', href: resultUrl(row) })) } };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '57014') return { status: 408, data: { error: '搜索超时，请缩短关键词后重试' } };
    throw error;
  } finally {
    client.release();
  }
}
