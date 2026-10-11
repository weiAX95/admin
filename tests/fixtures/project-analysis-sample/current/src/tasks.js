let nextId = 1;

export function createTask(title) {
  if (!title.trim()) throw new Error('标题不能为空');
  return { id: `task-${nextId++}`, title };
}

export function renameTask(task, title) {
  return { ...task, title };
}

export function importTask(task, existing) {
  if (existing.some(item => item.id === task.id)) return existing;
  return [...existing, task];
}
