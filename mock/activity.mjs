import { trendDateKey } from './task-trends.mjs';

export const ACTIVITY_TYPES = ['create', 'update', 'complete', 'delete', 'note', 'experiment'];
export function listActivity(activity, users, { type = '', userId = '', start = '', end = '', cursor = '', limit = 8 } = {}) {
  if (type && !ACTIVITY_TYPES.includes(type)) throw new Error('无效的活动类型');
  let boundary;
  if (cursor) {
    try {
      boundary = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (!Array.isArray(boundary) || boundary.length !== 2 || !boundary.every(v => typeof v === 'string')) throw new Error();
    } catch { throw new Error('无效的分页游标'); }
  }
  const size = Math.min(50, Math.max(1, Math.floor(Number(limit)) || 8));
  const inWindow = activity.filter(a => {
    const day = trendDateKey(a.at);
    return (!start || day >= start) && (!end || day <= end);
  });
  const actors = new Map(users.map(u => [u.id, { id: u.id, name: u.name || u.username, username: u.username }]));
  for (const a of inWindow) if (a.userId && !actors.has(a.userId)) actors.set(a.userId, { id: a.userId, name: a.userName || a.username || '已删除用户', username: a.username || '' });
  if (inWindow.some(a => !a.userId)) actors.set('__unknown__', { id: '__unknown__', name: '用户未知（历史记录）', username: '' });
  const filtered = inWindow.filter(a => (!type || a.type === type) && (!userId || (a.userId || '__unknown__') === userId))
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const remaining = boundary ? filtered.filter(a => a.at < boundary[0] || (a.at === boundary[0] && a.id < boundary[1])) : filtered;
  const items = remaining.slice(0, size);
  const last = items.at(-1);
  return { items, total: filtered.length, users: [...actors.values()], nextCursor: remaining.length > items.length && last ? Buffer.from(JSON.stringify([last.at, last.id])).toString('base64url') : null };
}
