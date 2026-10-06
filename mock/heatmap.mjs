import { trendDateKey } from './task-trends.mjs';

export function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function activityHeatmap(activity, start, end) {
  if (!validDateKey(start) || !validDateKey(end) || start > end) throw new Error('无效的日期范围');
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  if ((last - first) / 86400000 > 365) throw new Error('日期范围不能超过 366 天');
  const counts = new Map();
  for (const item of activity) {
    const date = trendDateKey(item.at);
    if (date >= start && date <= end) counts.set(date, (counts.get(date) || 0) + 1);
  }
  const items = [];
  for (let t = first; t <= last; t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    items.push({ date, count: counts.get(date) || 0 });
  }
  return items;
}

export function activityDay(activity, date) {
  if (!validDateKey(date)) throw new Error('无效的日期');
  const items = activity.filter(item => trendDateKey(item.at) === date)
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return { date, completed: items.filter(item => item.type === 'complete').length, created: items.filter(item => item.type === 'create').length, items };
}
