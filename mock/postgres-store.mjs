import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyTaskProgress } from "./task-checklist.mjs";
import { initializeTaskWork } from "./task-worklog.mjs";
import { initializeTaskTrends } from "./task-trends.mjs";
import { canonicalNoteTags } from "./note-tags.mjs";

pg.types.setTypeParser(1700, value => Number(value));
const root = path.dirname(fileURLToPath(import.meta.url));
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://admin:admin_local_only@127.0.0.1:55432/agent_admin" });

const snake = name => name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const spec = (name, table, fields, children = []) => ({ name, table, fields, children });
const child = (name, table, fields, parentColumn, orderField = "item_order") => ({ name, table, fields, parentColumn, orderField });
const specs = [
  spec("users", "users", ["id", "username", ["passwordHash", "password_hash"], "name", "role", "status", "reviewEmail", "reviewEmailEnabled", "timeZone", "createdAt", "updatedAt"]),
  spec("tasks", "tasks", ["id", "title", "description", "category", "phase", "status", "priority", "dueDate", "plannedStartDate", "notes", "progress", "manualProgress", "estimatedHours", "ownerId", "version", "activeCycleStartedAt", "legacyCompletionUnknown", "createdAt", "updatedAt", "recurringSeriesId", "recurrenceIndex"], [
    child("checklist", "task_checklist_items", ["id", "text", "done"], "task_id"),
    child("dependencyIds", "task_dependencies", [["value", "dependency_id"]], "task_id"),
    child("tags", "task_tags", [["value", "tag"]], "task_id"),
    child("resources", "task_resources", ["label", "url"], "task_id"),
    child("completionCycles", "task_completion_cycles", ["startedAt", "completedAt"], "task_id"),
  ]),
  spec("recurringSeries", "recurring_series", ["id", "ownerId", "firstTaskId", "frequency", "interval", "endType", "endCount", "endDate", "anchorDueAt", "nextSequence", "active", "version", "createdAt", "updatedAt", ["snapshotTitle", "snapshot_title"], ["snapshotDescription", "snapshot_description"], ["snapshotCategory", "snapshot_category"], ["snapshotPhase", "snapshot_phase"], ["snapshotPriority", "snapshot_priority"], ["snapshotEstimatedHours", "snapshot_estimated_hours"]], [
    child("snapshotChecklist", "recurring_snapshot_checklist", ["text"], "series_id"),
    child("snapshotTags", "recurring_snapshot_tags", [["value", "tag"]], "series_id"),
    child("snapshotResources", "recurring_snapshot_resources", ["label", "url"], "series_id"),
  ]),
  spec("taskTemplates", "task_templates", ["id", "ownerId", "name", "description", "defaultPhase", "defaultPriority"], [
    child("checklist", "template_checklist_items", [["value", "text"]], "template_id"),
    child("suggestedResources", "template_resources", ["label", "url"], "template_id"),
  ]),
  spec("timeEntries", "time_entries", ["id", "taskId", "recordedBy", "recordedByName", "mode", "workDate", "startedAt", "endedAt", "durationMinutes", "note", "createdAt", "updatedAt"]),
  spec("changeLogs", "change_logs", ["id", "operationId", "taskId", "changedBy", "changedByName", "changedAt", "fieldName", "oldValue", "newValue", "action", "sourceEntryId"]),
  spec("sessions", "sessions", ["id", ["userId", "external_user_id"], "createdAt", "updatedAt"], [
    child("messages", "session_messages", ["id", "role", "content", "at"], "session_id"),
  ]),
  spec("noteCategories", "note_categories", ["id", "name", "parentId", "createdAt", "updatedAt"]),
  spec("noteTagDefinitions", "note_tag_definitions", ["id", "name", "normalizedKey", "createdAt", "updatedAt"]),
  spec("notes", "notes", ["id", "title", "content", "taskId", "sourceSessionId", "categoryId", "createdAt", "updatedAt"], [
    child("links", "note_links", [["targetId", "target_note_id"], ["targetRef", "target_ref"], "label", "reason"], "source_note_id"),
    child("tags", "note_tags", [["value", "tag"]], "note_id"),
  ]),
  spec("noteVersions", "note_versions", ["id", "noteId", "versionNumber", "title", "content", "reason", "createdAt"]),
  spec("experiments", "experiments", ["id", "title", "taskId", "prompt", "model", "params", "result", "score", "ownerId", "recordKind", "systemPrompt", "userPrompt", "promptVersionId", "variables", "chainId", "createdAt", "updatedAt"]),
  spec("activity", "activity", ["id", "type", "taskId", "title", "detail", "at", "userId", "username", "userName"]),
];

const pair = field => Array.isArray(field) ? field : [field, snake(field)];
const columns = fields => fields.map(field => pair(field)[1]);
const mapped = (row, fields) => Object.fromEntries(fields.map(field => { const [key, column] = pair(field); return [key, row[column]]; }).filter(([, value]) => value !== null && value !== undefined));
const values = (item, fields) => fields.map(field => {
  const key = pair(field)[0];
  const value = item?.[key];
  return ["oldValue", "newValue", "variables"].includes(key) ? value === undefined ? null : JSON.stringify(value) : value ?? null;
});
async function upsert(client, table, fields, item, conflict = "id") {
  const cols = columns(fields);
  const update = cols.filter(col => col !== conflict).map(col => `${col}=EXCLUDED.${col}`).join(",");
  const query = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT (${conflict}) DO ${update ? `UPDATE SET ${update}` : "NOTHING"}`;
  await client.query(query, values(item, fields));
}

function prepareParent(entity, name) {
  if (name === "users") return { ...entity, reviewEmailEnabled: entity.reviewEmailEnabled ?? false, timeZone: entity.timeZone || "Asia/Shanghai" };
  if (name === "experiments") return { ...entity, recordKind: entity.recordKind || "manual", systemPrompt: entity.systemPrompt || "", userPrompt: entity.userPrompt || "", variables: entity.variables || {} };
  if (name !== "recurringSeries") return entity;
  const snapshot = entity.snapshot || {};
  return { ...entity, snapshotTitle: snapshot.title, snapshotDescription: snapshot.description, snapshotCategory: snapshot.category, snapshotPhase: snapshot.phase, snapshotPriority: snapshot.priority, snapshotEstimatedHours: snapshot.estimatedHours };
}
function childItems(entity, descriptor, name) {
  if (name === "recurringSeries") {
    if (descriptor.name === "snapshotChecklist") return entity.snapshot?.checklist || [];
    if (descriptor.name === "snapshotTags") return entity.snapshot?.tags || [];
    if (descriptor.name === "snapshotResources") return entity.snapshot?.resources || [];
  }
  return entity[descriptor.name] || [];
}
function assignChildren(entity, descriptor, rows, name) {
  const result = rows.map(row => {
    const item = mapped(row, descriptor.fields);
    if (descriptor.fields.length === 1 && pair(descriptor.fields[0])[0] === "value") return item.value;
    if (descriptor.name === "checklist" && name === "tasks") return { ...item, order: row.item_order };
    if (descriptor.name === "snapshotChecklist") return { ...item, order: row.item_order };
    if (descriptor.name === "links") return { ...item, targetId: row.target_note_id, reason: row.reason, order: row.item_order };
    return item;
  });
  if (name === "recurringSeries") {
    const field = descriptor.name.replace(/^snapshot/, "");
    entity.snapshot[field.charAt(0).toLowerCase() + field.slice(1)] = result;
  } else entity[descriptor.name] = result;
}

export async function migrate(client = pool) {
  const directory = path.resolve(root, "../db/migrations");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const filename of fs.readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) {
    const version = filename.replace(/\.sql$/, "");
    const done = await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [version]);
    if (done.rowCount) continue;
    const connection = client === pool ? await pool.connect() : client;
    try {
      await connection.query("BEGIN");
      await connection.query(fs.readFileSync(path.join(directory, filename), "utf8"));
      await connection.query("INSERT INTO schema_migrations(version) VALUES($1)", [version]);
      await connection.query("COMMIT");
    } catch (error) { await connection.query("ROLLBACK"); throw error; }
    finally { if (client === pool) connection.release(); }
  }
}

export async function assertSchemaCurrent(client = pool) {
  const directory = path.resolve(root, "../db/migrations");
  const expected = fs.readdirSync(directory).filter(name => name.endsWith(".sql")).map(name => name.replace(/\.sql$/, ""));
  const applied = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map(row => row.version));
  const missing = expected.filter(version => !applied.has(version));
  if (missing.length) throw new Error(`数据库迁移未完成：${missing.join(", ")}；请运行 npm run db:migrate`);
}

export async function loadData(client) {
  const data = {};
  for (const descriptor of specs) {
    const rows = (await client.query(`SELECT * FROM ${descriptor.table}`)).rows;
    data[descriptor.name] = rows.map(row => {
      const entity = mapped(row, descriptor.fields);
      if (descriptor.name === "tasks") entity.estimatedHours = row.estimated_hours ?? null;
      if (descriptor.name === "changeLogs") { entity.oldValue = row.old_value; entity.newValue = row.new_value; }
      if (descriptor.name === "notes") { entity.taskId = row.task_id; entity.sourceSessionId = row.source_session_id; }
      if (descriptor.name === "experiments") entity.taskId = row.task_id;
      if (descriptor.name === "recurringSeries") {
        entity.snapshot = { title: row.snapshot_title, description: row.snapshot_description, category: row.snapshot_category, phase: row.snapshot_phase, priority: row.snapshot_priority, estimatedHours: row.snapshot_estimated_hours };
        for (const key of ["snapshotTitle", "snapshotDescription", "snapshotCategory", "snapshotPhase", "snapshotPriority", "snapshotEstimatedHours"]) delete entity[key];
      }
      return entity;
    });
    for (const childSpec of descriptor.children) {
      const childRows = (await client.query(`SELECT * FROM ${childSpec.table} ORDER BY ${childSpec.orderField}`)).rows;
      const grouped = Map.groupBy(childRows, row => row[childSpec.parentColumn]);
      for (const entity of data[descriptor.name]) assignChildren(entity, childSpec, grouped.get(entity.id) || [], descriptor.name);
    }
  }
  data.legacyActivityIds = (await client.query("SELECT activity_id FROM legacy_activity_ids")).rows.map(row => row.activity_id);
  data.taskTrendEvents = (await client.query("SELECT type,task_id,at FROM task_trend_events ORDER BY id")).rows.map(row => ({ type: row.type, taskId: row.task_id, at: row.at }));
  data.taskTrendSnapshots = (await client.query("SELECT at,total,progress_sum FROM task_trend_snapshots ORDER BY id")).rows.map(row => ({ at: row.at, total: row.total, progressSum: row.progress_sum }));
  return data;
}

async function saveChildren(client, descriptor, entity, name, oldEntity) {
  const items = childItems(entity, descriptor, name);
  if (descriptor.name === "messages") {
    const oldIds = new Set((oldEntity?.messages || []).map(message => message.id));
    const newIds = new Set(items.map(message => message.id));
    for (const id of oldIds) if (!newIds.has(id)) await client.query("DELETE FROM session_messages WHERE session_id=$1 AND id=$2", [entity.id, id]);
  } else await client.query(`DELETE FROM ${descriptor.table} WHERE ${descriptor.parentColumn}=$1`, [entity.id]);
  for (let index = 0; index < items.length; index++) {
    const item = typeof items[index] === "object" ? items[index] : { value: items[index] };
    const fields = [["parent", descriptor.parentColumn], ["index", descriptor.orderField], ...descriptor.fields];
    const cols = columns(fields);
    const parameters = values({ parent: entity.id, index, ...item }, fields);
    const base = `INSERT INTO ${descriptor.table} (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`;
    const update = cols.filter(col => col !== descriptor.parentColumn && col !== "id").map(col => `${col}=EXCLUDED.${col}`).join(",");
    const query = descriptor.name === "messages" ? `${base} ON CONFLICT (session_id,id) DO UPDATE SET ${update}` : base;
    await client.query(query, parameters);
  }
}

export async function saveData(client, before, after) {
  for (const descriptor of specs) {
    const previous = new Map((before[descriptor.name] || []).map(item => [item.id, item]));
    const next = new Map((after[descriptor.name] || []).map(item => [item.id, item]));
    const changed = [...next.values()].filter(item => JSON.stringify(item) !== JSON.stringify(previous.get(item.id)));
    for (const item of changed) {
      if (JSON.stringify(item) === JSON.stringify(previous.get(item.id))) continue;
      await upsert(client, descriptor.table, descriptor.fields, prepareParent(item, descriptor.name));
    }
    for (const item of changed) for (const relation of descriptor.children) await saveChildren(client, relation, item, descriptor.name, previous.get(item.id));
    for (const id of previous.keys()) if (!next.has(id)) await client.query(`DELETE FROM ${descriptor.table} WHERE id=$1`, [id]);
  }
  if (JSON.stringify(before.legacyActivityIds) !== JSON.stringify(after.legacyActivityIds)) {
    await client.query("DELETE FROM legacy_activity_ids");
    for (const id of after.legacyActivityIds || []) await client.query("INSERT INTO legacy_activity_ids(activity_id) VALUES($1) ON CONFLICT DO NOTHING", [id]);
  }
  if (JSON.stringify(before.taskTrendEvents) !== JSON.stringify(after.taskTrendEvents)) {
    await client.query("DELETE FROM task_trend_events");
    for (const item of after.taskTrendEvents || []) await client.query("INSERT INTO task_trend_events(type,task_id,at) VALUES($1,$2,$3)", [item.type, item.taskId, item.at]);
  }
  if (JSON.stringify(before.taskTrendSnapshots) !== JSON.stringify(after.taskTrendSnapshots)) {
    await client.query("DELETE FROM task_trend_snapshots");
    for (const item of after.taskTrendSnapshots || []) await client.query("INSERT INTO task_trend_snapshots(at,total,progress_sum) VALUES($1,$2,$3)", [item.at, item.total, item.progressSum]);
  }
}

export async function assertEmpty(client) {
  for (const descriptor of specs) {
    const result = await client.query(`SELECT 1 FROM ${descriptor.table} LIMIT 1`);
    if (result.rowCount) throw new Error(`目标数据库不为空：${descriptor.table}`);
  }
  if ((await client.query("SELECT 1 FROM data_imports LIMIT 1")).rowCount) throw new Error("目标数据库已有导入记录");
}

export async function importJson(client, data, sourceHash) {
  await assertEmpty(client);
  if (!Array.isArray(data.noteTagDefinitions)) data.noteTagDefinitions = [];
  for (const note of data.notes || []) note.tags = canonicalNoteTags(data.noteTagDefinitions, note.tags || [], note.createdAt);
  if (!Array.isArray(data.noteVersions)) data.noteVersions = (data.notes || []).map(note => ({ id: crypto.randomUUID(), noteId: note.id, versionNumber: 1, title: note.title || "", content: note.content || "", reason: "baseline", createdAt: note.updatedAt || note.createdAt || new Date().toISOString() }));
  for (const task of data.tasks || []) {
    applyTaskProgress(task);
    initializeTaskWork(task);
    if (!Array.isArray(task.tags)) task.tags = [];
  }
  if (!Array.isArray(data.legacyActivityIds)) data.legacyActivityIds = (data.activity || []).map(item => item.id);
  if (!Array.isArray(data.taskTrendEvents)) data.taskTrendEvents = [];
  if (!Array.isArray(data.taskTrendSnapshots)) data.taskTrendSnapshots = [];
  initializeTaskTrends(data);
  const empty = Object.fromEntries([...specs.map(item => [item.name, []]), ["legacyActivityIds", []], ["taskTrendEvents", []], ["taskTrendSnapshots", []]]);
  await saveData(client, empty, data);
  // The schema migration runs before a JSON import, so seed review plans for
  // the imported accounts and notes inside this same import transaction.
  await client.query("INSERT INTO note_review_progress(user_id,note_id,started_on,due_on) SELECT u.id,n.id,(now() AT TIME ZONE 'Asia/Shanghai')::date,(now() AT TIME ZONE 'Asia/Shanghai')::date+1 FROM users u CROSS JOIN notes n ON CONFLICT DO NOTHING");
  await client.query("INSERT INTO data_imports(source_hash) VALUES($1)", [sourceHash]);
  const imported = await loadData(client);
  for (const key of Object.keys(empty)) if ((data[key] || []).length !== (imported[key] || []).length) throw new Error(`${key} 导入数量不一致`);
  for (const [collection, relation] of [["tasks", "checklist"], ["tasks", "dependencyIds"], ["tasks", "tags"], ["tasks", "resources"], ["tasks", "completionCycles"], ["sessions", "messages"], ["taskTemplates", "checklist"], ["taskTemplates", "suggestedResources"]]) {
    const expected = (data[collection] || []).reduce((sum, item) => sum + (item[relation] || []).length, 0);
    const actual = (imported[collection] || []).reduce((sum, item) => sum + (item[relation] || []).length, 0);
    if (expected !== actual) throw new Error(`${collection}.${relation} 关联数量不一致`);
  }
  for (const relation of ["checklist", "tags", "resources"]) {
    const expected = (data.recurringSeries || []).reduce((sum, item) => sum + (item.snapshot?.[relation] || []).length, 0);
    const actual = (imported.recurringSeries || []).reduce((sum, item) => sum + (item.snapshot?.[relation] || []).length, 0);
    if (expected !== actual) throw new Error(`recurringSeries.snapshot.${relation} 关联数量不一致`);
  }
  return Object.fromEntries(Object.keys(empty).map(key => [key, (imported[key] || []).length]));
}

export const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
