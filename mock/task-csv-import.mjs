import { randomUUID } from "node:crypto";
import { applyTaskProgress, normalizeChecklist } from "./task-checklist.mjs";
import { applyCompletionTransition } from "./task-worklog.mjs";
import { canUseDependency, validateDependencies, validatePlan } from "./task-dependencies.mjs";
import { parseDueAt, snapshotTask } from "./recurring.mjs";

const STATUSES = ["todo", "in_progress", "done", "blocked"];
const PRIORITIES = ["low", "medium", "high"];
const text = (value, fallback = "") => value === undefined || value === null ? fallback : typeof value === "string" ? value : (() => { throw new Error("文本字段类型无效"); })();

function buildTask(raw, actor, at, id) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("任务数据无效");
  const title = text(raw.title).trim();
  if (!title) throw new Error("缺少 title");
  if (title.length > 80) throw new Error("title 不能超过 80 字符");
  const status = text(raw.status, "todo") || "todo";
  const priority = text(raw.priority, "medium") || "medium";
  if (!STATUSES.includes(status)) throw new Error("status 无效");
  if (!PRIORITIES.includes(priority)) throw new Error("priority 无效");
  const progress = raw.manualProgress ?? raw.progress ?? 0;
  if (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error("progress 必须为 0–100 的数字");
  const estimatedHours = raw.estimatedHours === undefined || raw.estimatedHours === null || raw.estimatedHours === "" ? null : raw.estimatedHours;
  if (estimatedHours !== null && (typeof estimatedHours !== "number" || !Number.isFinite(estimatedHours) || estimatedHours <= 0)) throw new Error("estimatedHours 必须为正数");
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 32))) throw new Error("tags 格式无效");
  if (raw.resources !== undefined && (!Array.isArray(raw.resources) || raw.resources.some(item => !item || typeof item.label !== "string" || typeof item.url !== "string"))) throw new Error("resources 格式无效");
  if (raw.checklist !== undefined && !Array.isArray(raw.checklist)) throw new Error("checklist 格式无效");
  if (raw.dependencyIds !== undefined && (!Array.isArray(raw.dependencyIds) || raw.dependencyIds.some(id => typeof id !== "string"))) throw new Error("dependencyIds 格式无效");
  const dueDate = text(raw.dueDate);
  const plannedStartDate = text(raw.plannedStartDate);
  const planError = validatePlan(plannedStartDate, dueDate);
  if (planError) throw new Error(planError);
  if (dueDate && !parseDueAt(dueDate)) throw new Error("dueDate 无效");
  if (raw.recurrenceIndex !== undefined && (!Number.isInteger(raw.recurrenceIndex) || raw.recurrenceIndex < 1)) throw new Error("recurrenceIndex 无效");
  if (raw.recurringSeriesId) {
    const series = raw.recurrenceSeries;
    if (typeof raw.recurringSeriesId !== "string" || !series || typeof series !== "object" || !["daily", "weekly", "monthly"].includes(series.frequency) || !Number.isInteger(series.interval) || series.interval < 1 || !["never", "count", "date"].includes(series.endType) || !parseDueAt(series.anchorDueAt)) throw new Error("重复序列元数据无效");
  }
  const checklist = normalizeChecklist((raw.checklist || []).map(item => ({ text: item?.text, done: item?.done })));
  const task = {
    id, title, description: text(raw.description), category: text(raw.category, "未分类") || "未分类",
    phase: text(raw.phase, "基础") || "基础", status, priority, dueDate, plannedStartDate,
    notes: text(raw.notes), tags: [...new Set(raw.tags || [])], resources: structuredClone(raw.resources || []), checklist,
    dependencyIds: [], manualProgress: progress, progress, estimatedHours, ownerId: actor.id,
    version: 1, completionCycles: [], activeCycleStartedAt: at, legacyCompletionUnknown: false,
    createdAt: at, updatedAt: at,
  };
  applyCompletionTransition({ ...task, status: "todo" }, task, at);
  applyTaskProgress(task);
  return task;
}

export function prepareCsvImport(db, rows, actor, skipInvalid = false, at = new Date().toISOString()) {
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error("CSV 行数无效或超过 10000 行");
  const issues = new Map();
  const candidates = [];
  const sourceIds = new Map();
  const recurrenceIndexes = new Set();
  const seenRows = new Set();
  for (const row of rows) {
    if (!Number.isInteger(row?.rowNumber) || row.rowNumber < 2 || seenRows.has(row.rowNumber)) throw new Error("CSV 行号无效或重复");
    seenRows.add(row.rowNumber);
    const sourceId = typeof row.data?.id === "string" ? row.data.id.trim() : "";
    if (!sourceId) continue;
    if (sourceIds.has(sourceId)) issues.set(row.rowNumber, `原任务 ID 重复：${sourceId}`);
    else sourceIds.set(sourceId, randomUUID());
  }
  for (const row of rows) if (Array.isArray(row.errors) && row.errors.length) issues.set(row.rowNumber, row.errors.join("；"));
  for (const row of rows) {
    const number = row?.rowNumber;
    if (issues.has(number)) continue;
    try {
      const raw = row.data;
      const sourceId = typeof raw?.id === "string" ? raw.id.trim() : "";
      const task = buildTask(raw, actor, at, sourceIds.get(sourceId) || randomUUID());
      if (raw.recurringSeriesId) {
        const marker = `${raw.recurringSeriesId}:${raw.recurrenceIndex || 1}`;
        if (recurrenceIndexes.has(marker)) throw new Error("同一重复序列的次数重复");
        recurrenceIndexes.add(marker);
      }
      candidates.push({ rowNumber: number, raw, task });
    } catch (error) { issues.set(number, error instanceof Error ? error.message : "任务无效"); }
  }

  // Re-evaluate dependencies until skipped rows can no longer invalidate other rows.
  let changed = true;
  while (changed) {
    changed = false;
    const active = candidates.filter(item => !issues.has(item.rowNumber));
    const available = [...db.tasks, ...active.map(item => item.task)];
    const activeIds = new Set(active.map(item => item.task.id));
    for (const item of active) {
      const refs = item.raw.dependencyIds || [];
      const missing = refs.find(id => sourceIds.has(id) && !activeIds.has(sourceIds.get(id)));
      if (missing) { issues.set(item.rowNumber, `依赖的导入行已跳过：${missing}`); changed = true; continue; }
      item.task.dependencyIds = refs.map(id => sourceIds.get(id) || id);
      const error = validateDependencies(available, item.task.id, item.task.dependencyIds, actor);
      if (error) { issues.set(item.rowNumber, error); changed = true; }
    }
  }
  const errors = [...issues].map(([rowNumber, reason]) => ({ rowNumber, reason })).sort((a, b) => a.rowNumber - b.rowNumber);
  if (errors.length && !skipInvalid) return { tasks: [], series: [], imported: 0, skipped: errors.length, errors, blocked: true };
  const valid = candidates.filter(item => !issues.has(item.rowNumber));
  const seriesBySource = new Map();
  for (const item of valid) {
    const sourceId = item.raw.recurringSeriesId;
    if (!sourceId) continue;
    let series = seriesBySource.get(sourceId);
    if (!series) {
      const source = item.raw.recurrenceSeries;
      series = {
        id: randomUUID(), ownerId: actor.id, firstTaskId: item.task.id,
        frequency: source.frequency, interval: Number.isInteger(source.interval) && source.interval > 0 ? source.interval : 1,
        endType: ["never", "count", "date"].includes(source.endType) ? source.endType : "never",
        endCount: Number.isInteger(source.endCount) ? source.endCount : null,
        endDate: typeof source.endDate === "string" ? source.endDate : null,
        anchorDueAt: parseDueAt(source.anchorDueAt), snapshot: source.snapshot && typeof source.snapshot === "object" ? structuredClone(source.snapshot) : snapshotTask(item.task),
        nextSequence: 2, active: false, version: 1, createdAt: at, updatedAt: at,
      };
      seriesBySource.set(sourceId, series);
    }
    item.task.recurringSeriesId = series.id;
    item.task.recurrenceIndex = item.raw.recurrenceIndex || 1;
    series.nextSequence = Math.max(series.nextSequence, item.task.recurrenceIndex + 1);
    if (item.task.recurrenceIndex === 1) series.firstTaskId = item.task.id;
  }
  return { tasks: valid.map(item => item.task), series: [...seriesBySource.values()], imported: valid.length, skipped: errors.length, errors, blocked: false };
}
