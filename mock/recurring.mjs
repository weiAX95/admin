import { randomUUID } from "node:crypto";

const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDueAt(value) {
  if (typeof value !== "string") return null;
  const date = DATE_ONLY.test(value) ? new Date(`${value}T00:00:00+08:00`) : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (DATE_ONLY.test(value) && shanghaiDate(date.toISOString()) !== value) return null;
  return date.toISOString();
}

export function shanghaiDate(value) {
  return new Date(new Date(value).getTime() + SHANGHAI_OFFSET).toISOString().slice(0, 10);
}

export function validateRecurrence(input, dueDate, now = Date.now(), existing = null) {
  if (!input || typeof input !== "object") throw new Error("重复配置无效");
  if (!["daily", "weekly", "monthly"].includes(input.frequency)) throw new Error("重复频率无效");
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > 365) throw new Error("重复间隔必须为 1 至 365 的整数");
  if (!["never", "count", "date"].includes(input.endType)) throw new Error("重复截止条件无效");
  const anchorDueAt = existing?.anchorDueAt || parseDueAt(dueDate);
  if (!anchorDueAt) throw new Error("重复任务必须设置有效的到期时间");
  if (!existing && Date.parse(anchorDueAt) <= now) throw new Error("首次到期时间必须在未来");
  let endCount = null;
  let endDate = null;
  if (input.endType === "count") {
    if (!Number.isInteger(input.endCount) || input.endCount < 1) throw new Error("重复次数上限必须为正整数");
    endCount = input.endCount;
  }
  if (input.endType === "date") {
    if (!DATE_ONLY.test(input.endDate || "") || !parseDueAt(input.endDate) || shanghaiDate(anchorDueAt) > input.endDate) throw new Error("重复截止日期无效或早于首次到期日期");
    endDate = input.endDate;
  }
  return { frequency: input.frequency, interval: input.interval, endType: input.endType, endCount, endDate, anchorDueAt };
}

export function occurrenceDueAt(series, sequence) {
  const first = new Date(series.anchorDueAt).getTime();
  const step = (sequence - 1) * series.interval;
  if (series.frequency === "daily") return new Date(first + step * DAY).toISOString();
  if (series.frequency === "weekly") return new Date(first + step * 7 * DAY).toISOString();
  const local = new Date(first + SHANGHAI_OFFSET);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const targetMonth = new Date(Date.UTC(year, month + step, 1));
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  const targetLocal = Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(day, lastDay), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds());
  return new Date(targetLocal - SHANGHAI_OFFSET).toISOString();
}

export function canGenerate(series, sequence) {
  if (!series.active) return false;
  if (series.endType === "count" && sequence > series.endCount) return false;
  if (series.endType === "date" && shanghaiDate(occurrenceDueAt(series, sequence)) > series.endDate) return false;
  return true;
}

export function snapshotTask(task) {
  return structuredClone({
    title: task.title, description: task.description || "", category: task.category || "未分类",
    phase: task.phase || "基础", priority: task.priority || "medium",
    checklist: (task.checklist || []).map(item => ({ text: item.text, order: item.order })),
    tags: task.tags || [], resources: task.resources || [], estimatedHours: task.estimatedHours ?? null,
  });
}

export function createSeries(task, input, now = Date.now()) {
  const rule = validateRecurrence(input, task.dueDate, now);
  return {
    id: randomUUID(), ownerId: task.ownerId, firstTaskId: task.id, ...rule,
    snapshot: snapshotTask(task), nextSequence: 2, active: true,
    version: 1, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
  };
}

export function updateSeries(series, input, task, { updateSnapshot = false } = {}) {
  const rule = validateRecurrence(input, task.dueDate, Date.now(), series);
  return {
    ...series, ...rule, ...(updateSnapshot ? { snapshot: snapshotTask(task) } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function generateDueInstances(db, now = Date.now(), limit = 100) {
  let generated = 0;
  for (const series of db.recurringSeries || []) {
    while (generated < limit && canGenerate(series, series.nextSequence) && Date.parse(occurrenceDueAt(series, series.nextSequence - 1)) <= now) {
      const sequence = series.nextSequence;
      // The sequence is durable even if its individual task was later deleted.
      if (!db.tasks.some(task => task.recurringSeriesId === series.id && task.recurrenceIndex === sequence)) {
        const at = new Date(now).toISOString();
        const snapshot = structuredClone(series.snapshot);
        db.tasks.push({
          id: randomUUID(), ...snapshot, status: "todo", progress: 0, manualProgress: 0,
          checklist: snapshot.checklist.map((item, order) => ({ id: randomUUID(), text: item.text, done: false, order })),
          dueDate: occurrenceDueAt(series, sequence), plannedStartDate: "", dependencyIds: [],
          notes: "", ownerId: series.ownerId, recurringSeriesId: series.id, recurrenceIndex: sequence,
          version: 1, completionCycles: [], activeCycleStartedAt: at, legacyCompletionUnknown: false,
          createdAt: at, updatedAt: at,
        });
        generated++;
      }
      series.nextSequence++;
      series.updatedAt = new Date(now).toISOString();
    }
  }
  return generated;
}
