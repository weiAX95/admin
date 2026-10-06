import { validDate } from "./task-dependencies.mjs";

export function initializeTaskWork(task) {
  if (task.estimatedHours === undefined) task.estimatedHours = null;
  if (!Array.isArray(task.completionCycles)) {
    task.completionCycles = [];
    if (task.status === "done") task.legacyCompletionUnknown = true;
  }
  if (task.activeCycleStartedAt === undefined) task.activeCycleStartedAt = task.status === "done" ? null : task.createdAt;
  return task;
}

export function applyCompletionTransition(before, after, at) {
  initializeTaskWork(after);
  if (before.status !== "done" && after.status === "done") {
    after.completionCycles = [...after.completionCycles, {
      startedAt: before.activeCycleStartedAt || before.createdAt,
      completedAt: at,
    }];
    after.activeCycleStartedAt = null;
  } else if (before.status === "done" && after.status !== "done") {
    after.activeCycleStartedAt = at;
  }
  return after;
}

export function normalizeTimeEntry(body) {
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (body.mode === "duration") {
    if (!validDate(body.workDate)) throw new Error("工作日期无效");
    const hours = Number(body.hours);
    const durationMinutes = Math.round(hours * 60);
    if (!Number.isFinite(hours) || hours <= 0 || !Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) throw new Error("实际时长必须为正数，最小为 1 分钟");
    return { mode: "duration", workDate: body.workDate, startedAt: null, endedAt: null, durationMinutes, note };
  }
  if (body.mode === "interval") {
    if (typeof body.startedAt !== "string" || typeof body.endedAt !== "string") throw new Error("请填写有效的开始和结束时间");
    const first = Date.parse(body.startedAt);
    const last = Date.parse(body.endedAt);
    const durationMinutes = Math.round((last - first) / 60000);
    if (!Number.isFinite(first) || !Number.isFinite(last) || !Number.isSafeInteger(durationMinutes) || durationMinutes <= 0 || last <= first) throw new Error("结束时间必须晚于开始时间，最小为 1 分钟");
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(first));
    const part = type => parts.find(item => item.type === type).value;
    const workDate = `${part("year")}-${part("month")}-${part("day")}`;
    return { mode: "interval", workDate, startedAt: new Date(first).toISOString(), endedAt: new Date(last).toISOString(), durationMinutes, note };
  }
  throw new Error("工时记录方式无效");
}

export function actualMinutes(entries, taskId) {
  return entries.filter(entry => entry.taskId === taskId).reduce((sum, entry) => sum + entry.durationMinutes, 0);
}

export function workVariance(tasks, entries) {
  const minutesByTask = new Map();
  for (const entry of entries) minutesByTask.set(entry.taskId, (minutesByTask.get(entry.taskId) || 0) + entry.durationMinutes);
  let numerator = 0;
  let denominator = 0;
  let taskCount = 0;
  for (const task of tasks) {
    const estimate = Number(task.estimatedHours);
    const actual = (minutesByTask.get(task.id) || 0) / 60;
    if (!Number.isFinite(estimate) || estimate <= 0 || actual <= 0) continue;
    numerator += Math.abs(estimate - actual);
    denominator += estimate;
    taskCount++;
  }
  const raw = denominator ? numerator / denominator * 100 : null;
  return { percent: raw === null ? null : Math.round(raw * 100) / 100, taskCount, highlight: raw !== null && raw > 50 };
}
