const DAY = 86400000;
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

export function trendDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return dateFormatter.format(date);
}

/** Old databases have no historical progress: record a baseline, never backfill invented values. */
export function initializeTaskTrends(db, at = new Date().toISOString()) {
  if (Array.isArray(db.taskTrendEvents) && Array.isArray(db.taskTrendSnapshots)) return false;
  const creations = new Map();
  for (const task of db.tasks) creations.set(task.id, { type: 'create', taskId: task.id, at: task.createdAt });
  for (const activity of db.activity || []) {
    if (activity.type === 'create' && activity.taskId && !creations.has(activity.taskId)) {
      creations.set(activity.taskId, { type: 'create', taskId: activity.taskId, at: activity.at });
    }
  }
  db.taskTrendEvents = [...creations.values(), ...(db.activity || [])
    .filter(a => a.type === 'complete' && a.taskId)
    .map(a => ({ type: 'complete', taskId: a.taskId, at: a.at }))];
  db.taskTrendSnapshots = [];
  recordTaskTrendSnapshot(db, at);
  return true;
}

export function recordTaskTrendSnapshot(db, at = new Date().toISOString()) {
  const snapshot = { at, total: db.tasks.length, progressSum: db.tasks.reduce((sum, t) => sum + (Number(t.progress) || 0), 0) };
  const previous = db.taskTrendSnapshots.at(-1);
  if (!previous || previous.total !== snapshot.total || previous.progressSum !== snapshot.progressSum) {
    db.taskTrendSnapshots.push(snapshot);
  }
}

export function recordTaskTrendEvent(db, type, taskId, at = new Date().toISOString()) {
  db.taskTrendEvents.push({ type, taskId, at });
}

function parseDay(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('趋势日期格式应为 YYYY-MM-DD');
  const timestamp = Date.parse(`${key}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== key) throw new Error('趋势日期无效');
  return timestamp;
}

/** End-of-day mean of all currently existing tasks; it carries into later query windows. */
export function computeTaskTrends(db, { start, end } = {}, now = new Date().toISOString()) {
  const today = trendDateKey(now);
  const last = end || today;
  const first = start || new Date(parseDay(last) - 13 * DAY).toISOString().slice(0, 10);
  const firstTime = parseDay(first);
  const requestedLastTime = parseDay(last);
  const lastTime = Math.min(requestedLastTime, parseDay(today));
  if (requestedLastTime < firstTime || (requestedLastTime - firstTime) / DAY > 3660) throw new Error('请选择有效日期范围，最长支持 10 年');
  const counts = new Map();
  for (const event of db.taskTrendEvents) {
    const date = trendDateKey(event.at);
    const bucket = counts.get(date) || { created: 0, completed: 0 };
    if (event.type === 'create') bucket.created++;
    if (event.type === 'complete') bucket.completed++;
    counts.set(date, bucket);
  }
  const snapshots = [...db.taskTrendSnapshots].sort((a, b) => a.at.localeCompare(b.at));
  let index = 0;
  let current = null;
  const items = [];
  for (let timestamp = firstTime; timestamp <= lastTime; timestamp += DAY) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    while (index < snapshots.length && trendDateKey(snapshots[index].at) <= date) current = snapshots[index++];
    const bucket = counts.get(date) || { created: 0, completed: 0 };
    items.push({ date, ...bucket, avgProgress: date > today || !current || !current.total ? null : Math.round(current.progressSum / current.total * 100) / 100 });
  }
  return { items, progressHistoryStart: snapshots[0] ? trendDateKey(snapshots[0].at) : null };
}
