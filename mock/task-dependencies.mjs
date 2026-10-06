export const dateKey = value => typeof value === "string" ? value.slice(0, 10) : "";
export const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function validatePlan(start, due) {
  const first = dateKey(start);
  const last = dateKey(due);
  if (first && !validDate(first)) return "计划开始日期无效";
  if (last && !validDate(last)) return "截止日期无效";
  if (first && last && last < first) return "截止日期不能早于计划开始日期";
  return null;
}

export function canUseDependency(task, user) {
  return user.role === "admin" || !task.ownerId || task.ownerId === user.id;
}

export function validateDependencies(tasks, taskId, ids, user) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) return "前置任务格式无效或重复";
  const byId = new Map(tasks.map(task => [task.id, task]));
  for (const id of ids) {
    if (id === taskId) return "任务不能依赖自身";
    const target = byId.get(id);
    if (!target) return `前置任务不存在：${id}`;
    if (!canUseDependency(target, user)) return "不能关联无权限访问的前置任务";
  }
  const reaches = (current, seen = new Set()) => {
    if (current === taskId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    return (byId.get(current)?.dependencyIds || []).some(next => reaches(next, seen));
  };
  if (ids.some(id => reaches(id))) return "前置任务会形成循环依赖";
  return null;
}

export function projectTasks(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const cache = new Map();
  const effective = (task, seen = new Set()) => {
    if (cache.has(task.id)) return cache.get(task.id);
    if (seen.has(task.id)) return task.status;
    seen.add(task.id);
    const blockedBy = (task.dependencyIds || []).filter(id => {
      const parent = byId.get(id);
      return parent && effective(parent, seen) !== "done";
    });
    seen.delete(task.id);
    const result = blockedBy.length ? "blocked" : task.status;
    cache.set(task.id, result);
    return result;
  };
  return tasks.map(task => ({
    ...task,
    completedAt: task.completionCycles?.at(-1)?.completedAt || null,
    effectiveStatus: effective(task),
    blockedBy: (task.dependencyIds || []).filter(id => {
      const parent = byId.get(id);
      return parent && effective(parent) !== "done";
    }).map(id => ({ id, title: byId.get(id).title })),
  }));
}
