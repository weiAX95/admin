import { randomUUID } from "node:crypto";

export const clampProgress = value => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
};

export function normalizeChecklist(items) {
  if (!Array.isArray(items)) return [];
  const ids = new Set();
  return items.slice(0, 100).map((item, index) => {
    const text = typeof item?.text === "string" ? item.text.trim().slice(0, 200) : "";
    if (!text) throw new Error("检查项内容不能为空");
    let id = typeof item.id === "string" && item.id ? item.id : randomUUID();
    if (ids.has(id)) id = randomUUID();
    ids.add(id);
    return { id, text, done: item.done === true, order: index };
  });
}

export function applyTaskProgress(task) {
  if (!Array.isArray(task.checklist)) task.checklist = [];
  if (task.manualProgress === undefined) task.manualProgress = clampProgress(task.progress);
  task.manualProgress = clampProgress(task.manualProgress);
  task.progress = task.checklist.length
    ? Math.round(task.checklist.filter(item => item.done).length / task.checklist.length * 100)
    : task.manualProgress;
  if (!Number.isInteger(task.version) || task.version < 1) task.version = 1;
  return task;
}
