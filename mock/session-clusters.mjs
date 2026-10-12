import { randomUUID } from 'node:crypto';

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const stop = new Set(['什么', '怎么', '如何', '这个', '那个', '可以', '一下', '请问', '问题', '介绍', '使用', 'the', 'and', 'for', 'with', 'from', 'what', 'how', 'why', 'is', 'are']);

export function tokenize(text) {
  return [...segmenter.segment(String(text).toLowerCase())]
    .filter(part => part.isWordLike)
    .map(part => part.segment.trim())
    .filter(term => term.length >= 2 && !stop.has(term));
}

function unit(values) {
  const magnitude = Math.hypot(...Object.values(values));
  return magnitude ? Object.fromEntries(Object.entries(values).map(([term, value]) => [term, value / magnitude])) : {};
}

function vector(tokens, idf) {
  const counts = {};
  for (const term of tokens) counts[term] = (counts[term] || 0) + 1;
  return unit(Object.fromEntries(Object.entries(counts).map(([term, count]) => [term, (count / tokens.length) * (idf[term] || 1)])));
}

export function similarity(left, right) {
  let score = 0;
  for (const [term, value] of Object.entries(left)) score += value * (right[term] || 0);
  return score;
}

export function autoClusterCount(n) { return n ? Math.min(12, n, Math.max(1, Math.ceil(Math.sqrt(n / 2)))) : 0; }

export function clusterSessions(rows, requestedK = null) {
  const docs = rows.map(row => ({ id: row.id, tokens: tokenize(row.text) })).filter(row => row.tokens.length).sort((a, b) => a.id.localeCompare(b.id));
  if (!docs.length) return { idf: {}, clusters: [], assignments: {} };
  const df = {};
  for (const row of docs) for (const term of new Set(row.tokens)) df[term] = (df[term] || 0) + 1;
  const idf = Object.fromEntries(Object.entries(df).map(([term, count]) => [term, 1 + Math.log((docs.length + 1) / (count + 1))]));
  const vectors = docs.map(row => vector(row.tokens, idf));
  const k = Math.min(docs.length, requestedK || autoClusterCount(docs.length));
  const seeds = [0];
  while (seeds.length < k) {
    let choice = -1; let distance = -1;
    for (let index = 0; index < docs.length; index++) {
      if (seeds.includes(index)) continue;
      const gap = 1 - Math.max(...seeds.map(seed => similarity(vectors[index], vectors[seed])));
      if (gap > distance) { distance = gap; choice = index; }
    }
    seeds.push(choice);
  }
  let centroids = seeds.map(index => vectors[index]);
  let assigned = Array(docs.length).fill(-1);
  for (let turn = 0; turn < 25; turn++) {
    const next = vectors.map(values => {
      let choice = 0; let best = -Infinity;
      for (let index = 0; index < centroids.length; index++) {
        const score = similarity(values, centroids[index]);
        if (score > best) { best = score; choice = index; }
      }
      return choice;
    });
    if (next.every((value, index) => value === assigned[index])) break;
    assigned = next;
    centroids = centroids.map((_, index) => {
      const sums = {};
      let count = 0;
      for (let row = 0; row < docs.length; row++) if (assigned[row] === index) {
        count++;
        for (const [term, value] of Object.entries(vectors[row])) sums[term] = (sums[term] || 0) + value;
      }
      return count ? unit(Object.fromEntries(Object.entries(sums).map(([term, value]) => [term, value / count]))) : centroids[index];
    });
  }
  const used = [...new Set(assigned)].sort((a, b) => a - b);
  const remap = new Map(used.map((old, index) => [old, index]));
  const clusters = used.map(old => ({ centroid: centroids[old], label: Object.entries(centroids[old]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([term]) => term).join(' · '), count: assigned.filter(value => value === old).length }));
  return { idf, clusters, assignments: Object.fromEntries(docs.map((row, index) => [row.id, remap.get(assigned[index])])) };
}

async function questions(client) {
  const rows = (await client.query(`SELECT s.id,m.content AS text FROM sessions s JOIN LATERAL
    (SELECT content FROM session_messages WHERE session_id=s.id AND role='user' ORDER BY item_order LIMIT 1) m ON true`)).rows;
  return rows;
}

export async function rebuildSessionClusters(client) {
  const settings = (await client.query('SELECT requested_k FROM session_cluster_settings WHERE id=1')).rows[0];
  const result = clusterSessions(await questions(client), settings.requested_k);
  const previous = (await client.query('SELECT * FROM session_clusters ORDER BY id')).rows;
  const retained = new Set();
  const rows = result.clusters.map(item => {
    let match = null; let best = 0.2;
    for (const old of previous) {
      if (retained.has(old.id)) continue;
      const score = similarity(item.centroid, old.centroid);
      if (score > best) { best = score; match = old; }
    }
    if (match) retained.add(match.id);
    return { id: match?.id || randomUUID(), label: match?.manually_labeled ? match.label : item.label, autoLabel: item.label, manuallyLabeled: Boolean(match?.manually_labeled), centroid: item.centroid, count: item.count };
  });
  await client.query('UPDATE sessions SET cluster_id=NULL WHERE cluster_id IS NOT NULL');
  await client.query('DELETE FROM session_clusters');
  for (const row of rows) await client.query('INSERT INTO session_clusters(id,label,auto_label,manually_labeled,centroid,member_count) VALUES($1,$2,$3,$4,$5,$6)', [row.id, row.label, row.autoLabel, row.manuallyLabeled, JSON.stringify(row.centroid), row.count]);
  const assignments = Object.entries(result.assignments).map(([id, index]) => [id, rows[index].id]);
  for (let offset = 0; offset < assignments.length; offset += 500) {
    const batch = assignments.slice(offset, offset + 500);
    const params = batch.flat();
    const values = batch.map((_, index) => `($${index * 2 + 1}::text,$${index * 2 + 2}::text)`).join(',');
    await client.query(`UPDATE sessions s SET cluster_id=v.cluster_id FROM (VALUES ${values}) AS v(id,cluster_id) WHERE s.id=v.id`, params);
  }
  const documentCount = Object.keys(result.assignments).length;
  await client.query('UPDATE session_cluster_settings SET idf=$1,document_count=$2,target_k=$3,last_built_at=now() WHERE id=1', [JSON.stringify(result.idf), documentCount, Math.min(documentCount, settings.requested_k || autoClusterCount(documentCount))]);
  return rows;
}

export async function assignSessionCluster(client, session) {
  const question = session.messages.find(message => message.role === 'user')?.content || '';
  const tokens = tokenize(question);
  if (!tokens.length) return;
  const settings = (await client.query('SELECT requested_k,idf,document_count,target_k FROM session_cluster_settings WHERE id=1')).rows[0];
  const rows = (await client.query('SELECT id,centroid FROM session_clusters ORDER BY id')).rows;
  const current = (await client.query('SELECT cluster_id FROM sessions WHERE id=$1', [session.id])).rows[0]?.cluster_id;
  if (current) return;
  const count = settings.document_count + 1;
  if (!rows.length || Math.min(count, settings.requested_k || autoClusterCount(count)) > settings.target_k) return rebuildSessionClusters(client);
  const values = vector(tokens, settings.idf);
  let target = rows[0]; let best = -Infinity;
  for (const row of rows) {
    const score = similarity(values, row.centroid);
    if (score > best) { best = score; target = row; }
  }
  if (!target) return rebuildSessionClusters(client);
  await client.query('UPDATE sessions SET cluster_id=$1 WHERE id=$2', [target.id, session.id]);
  await client.query('UPDATE session_clusters SET member_count=member_count+1 WHERE id=$1', [target.id]);
  await client.query('UPDATE session_cluster_settings SET document_count=document_count+1 WHERE id=1');
}

export async function ensureSessionClusters(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(748201)');
    const missing = (await client.query("SELECT 1 FROM sessions s WHERE s.cluster_id IS NULL AND EXISTS(SELECT 1 FROM session_messages m WHERE m.session_id=s.id AND m.role='user') LIMIT 1")).rowCount;
    const uninitialized = (await client.query('SELECT target_k=0 AS needed FROM session_cluster_settings WHERE id=1')).rows[0].needed;
    if (missing || uninitialized) await rebuildSessionClusters(client);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
