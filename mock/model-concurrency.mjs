import pg from 'pg';

const LOCK_NAMESPACE = 748207;

export async function tryModelSlot(client, limit) {
  for (let slot = 0; slot < Math.min(20, Math.max(0, Number(limit) || 0)); slot++) {
    if ((await client.query('SELECT pg_try_advisory_lock($1,$2) AS locked', [LOCK_NAMESPACE,slot])).rows[0].locked) return slot;
  }
  return -1;
}

export async function releaseModelSlot(client, slot) {
  if (slot >= 0) await client.query('SELECT pg_advisory_unlock($1,$2)', [LOCK_NAMESPACE,slot]);
}

export async function acquireModelSlot(pool, limit) {
  const client = new pg.Client(pool.options);
  try {
    await client.connect();
    const slot = await tryModelSlot(client,limit);
    if (slot < 0) { await client.end(); return null; }
    return { slot, release: async () => { try { await releaseModelSlot(client,slot); } finally { await client.end(); } } };
  } catch (error) { await client.end().catch(() => undefined); throw error; }
}
