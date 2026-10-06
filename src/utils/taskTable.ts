import type { LearningTask, TaskQuery } from "../types";

export type TaskSortKey = "createdAt" | "dueDate" | "progress" | "priority";
export type TaskSort = { key: TaskSortKey; direction: "asc" | "desc" };
export type TaskColumnKey = "title" | "category" | "phase" | "status" | "priority" | "progress" | "dueDate" | "createdAt" | "actions";
export const TASK_COLUMNS: TaskColumnKey[] = ["title", "category", "phase", "status", "priority", "progress", "dueDate", "createdAt", "actions"];
export const MOVABLE_COLUMNS: TaskColumnKey[] = TASK_COLUMNS.filter(key => key !== "title" && key !== "actions");
export const COLUMN_LABELS: Record<TaskColumnKey, string> = { title: "任务", category: "分类", phase: "阶段", status: "状态", priority: "优先级", progress: "进度", dueDate: "到期", createdAt: "创建时间", actions: "操作" };
export interface TaskColumnConfig { version: 1; order: TaskColumnKey[]; hidden: TaskColumnKey[]; }

export function normalizeColumnConfig(input: unknown): TaskColumnConfig {
  const value = input && typeof input === "object" ? input as Partial<TaskColumnConfig> : {};
  const order = Array.isArray(value.order) ? value.order.filter((key): key is TaskColumnKey => MOVABLE_COLUMNS.includes(key as TaskColumnKey)) : [];
  return { version: 1, order: [...new Set(order), ...MOVABLE_COLUMNS.filter(key => !order.includes(key))], hidden: Array.isArray(value.hidden) ? value.hidden.filter((key): key is TaskColumnKey => MOVABLE_COLUMNS.includes(key as TaskColumnKey)) : [] };
}

export function readTaskQuery(params: URLSearchParams): TaskQuery {
  return { keyword: params.get("keyword") || "", status: (params.get("status") || "") as TaskQuery["status"], category: params.get("category") || "", phase: params.get("phase") || "", tags: params.getAll("tag") };
}

export function readTaskSort(params: URLSearchParams): TaskSort[] {
  const allowed: TaskSortKey[] = ["createdAt", "dueDate", "progress", "priority"];
  const entries = (params.get("sort") || "").split(",").map(part => {
    const [key, direction] = part.split(":");
    return allowed.includes(key as TaskSortKey) && (direction === "asc" || direction === "desc") ? { key: key as TaskSortKey, direction } : null;
  }).filter((item): item is TaskSort => !!item);
  const unique = entries.filter((item, index) => entries.findIndex(other => other.key === item.key) === index).slice(0, 2);
  return unique.length === 2 && unique.some(item => item.key === "priority") && unique.some(item => item.key === "dueDate") ? unique.sort((a, b) => a.key === "priority" ? -1 : b.key === "priority" ? 1 : 0) : unique.slice(0, 1);
}

export function writeTaskParams(previous: URLSearchParams, query: TaskQuery, sort: TaskSort[]): URLSearchParams {
  const next = new URLSearchParams(previous);
  for (const key of ["keyword", "status", "category", "phase", "tag", "sort"]) next.delete(key);
  if (query.keyword?.trim()) next.set("keyword", query.keyword.trim());
  if (query.status) next.set("status", query.status);
  if (query.category) next.set("category", query.category);
  if (query.phase) next.set("phase", query.phase);
  query.tags?.forEach(tag => next.append("tag", tag));
  if (sort.length) next.set("sort", sort.map(item => `${item.key}:${item.direction}`).join(","));
  return next;
}

export function nextTaskSort(current: TaskSort[], key: TaskSortKey, shift: boolean): TaskSort[] {
  const existing = current.find(item => item.key === key);
  const initial = key === "dueDate" ? "asc" : "desc";
  const next = existing ? existing.direction === initial ? (initial === "asc" ? "desc" : "asc") : null : initial;
  const pair = shift && (key === "priority" || key === "dueDate") && current.length && current.every(item => item.key === "priority" || item.key === "dueDate");
  const kept = pair ? current.filter(item => item.key !== key) : [];
  if (next) kept.push({ key, direction: next });
  return kept.length === 2 ? kept.sort((a, b) => a.key === "priority" ? -1 : b.key === "priority" ? 1 : 0) : kept;
}

const priorityRank = { high: 3, medium: 2, low: 1 };
const dueTime = (value: string) => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value);
export function sortTasks(items: LearningTask[], rules: TaskSort[]): LearningTask[] {
  if (!rules.length) return items;
  return items.map((task, index) => ({ task, index })).sort((a, b) => {
    for (const rule of rules) {
      let comparison = 0;
      if (rule.key === "dueDate") {
        if (!a.task.dueDate || !b.task.dueDate) comparison = !a.task.dueDate && !b.task.dueDate ? 0 : !a.task.dueDate ? 1 : -1;
        else comparison = dueTime(a.task.dueDate) - dueTime(b.task.dueDate);
        if (!a.task.dueDate || !b.task.dueDate) { if (comparison) return comparison; continue; }
      } else if (rule.key === "priority") comparison = priorityRank[a.task.priority] - priorityRank[b.task.priority];
      else if (rule.key === "progress") comparison = a.task.progress - b.task.progress;
      else comparison = Date.parse(a.task.createdAt) - Date.parse(b.task.createdAt);
      if (comparison) return rule.direction === "asc" ? comparison : -comparison;
    }
    return a.index - b.index;
  }).map(entry => entry.task);
}
