import { randomUUID } from "node:crypto";

export const AUDITED_TASK_FIELDS = [
  "title", "description", "category", "phase", "status", "priority",
  "dueDate", "plannedStartDate", "dependencyIds", "manualProgress",
  "checklist", "tags", "notes", "resources", "estimatedHours",
];

export function changedTaskFields(before, after) {
  return AUDITED_TASK_FIELDS.filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

export function recordTaskChanges(db, before, after, actor, options = {}) {
  const fields = changedTaskFields(before, after);
  if (!fields.length) return [];
  const operationId = options.operationId || randomUUID();
  const changedAt = options.changedAt || new Date().toISOString();
  const entries = fields.map(fieldName => ({
    id: randomUUID(), operationId, taskId: after.id, changedBy: actor.id,
    changedByName: actor.name || actor.username,
    changedAt, fieldName,
    oldValue: structuredClone(before[fieldName] ?? null),
    newValue: structuredClone(after[fieldName] ?? null),
    action: options.action || "update",
    ...(options.sourceEntryId ? { sourceEntryId: options.sourceEntryId } : {}),
  }));
  db.changeLogs.unshift(...entries);
  return entries;
}
