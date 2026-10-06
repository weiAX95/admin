import { trendDateKey } from './task-trends.mjs';
const DAY = 86400000;

function dueDateKey(value) {
  if (typeof value !== 'string' || !value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? value : '';
  }
  return trendDateKey(value);
}

export function computeOverdueTasks(tasks, now = new Date().toISOString()) {
  const today = trendDateKey(now);
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  return tasks.flatMap(task => {
    const dueDate = dueDateKey(task.dueDate);
    if (task.status === 'done' || !dueDate || dueDate >= today) return [];
    const overdueDays = Math.round((todayTime - Date.parse(`${dueDate}T00:00:00Z`)) / DAY);
    return [{ id: task.id, title: task.title, dueDate, status: task.status, overdueDays,
      severity: overdueDays > 7 ? 'severe' : overdueDays > 3 ? 'moderate' : 'warning' }];
  }).sort((a, b) => b.overdueDays - a.overdueDays || a.title.localeCompare(b.title, 'zh-CN'));
}
