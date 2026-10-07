import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import ts from "typescript";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { prepareCsvImport } from "../mock/task-csv-import.mjs";
import { createPgTestServer } from "./pg-helper.mjs";

async function importTs(relative) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}
const csv = await importTs("../src/utils/taskCsv.ts");
const table = await importTs("../src/utils/taskTable.ts");

test("CSV parses quoted commas/newlines, detects GBK, maps columns and escapes formulas", () => {
  const parsed = csv.parseCsv('title,description\r\n"任务,一","第一行\n第二行"\r\n');
  assert.equal(parsed.rows[0].rowNumber, 2);
  assert.deepEqual(parsed.rows[0].cells, ["任务,一", "第一行\n第二行"]);
  assert.deepEqual(csv.autoMapHeaders(["标题", "description", "检查清单"]), ["title", "description", "checklist"]);
  const mapped = csv.mapCsvRows(parsed, ["title", "description"]);
  assert.equal(mapped[0].data.title, "任务,一");
  const gbk = new Uint8Array([0xb1, 0xea, 0xcc, 0xe2, 0x2c, 0xc3, 0xe8, 0xca, 0xf6]);
  assert.equal(csv.decodeCsv(gbk.buffer).text, "标题,描述");
  const exported = csv.exportTaskCsv([{ title: "=SUM(1,2)", description: "中文\n第二行", tags: ["复习"] }], ["title", "description", "tags"]);
  assert.ok(exported.includes('"\'=SUM(1,2)"'));
  assert.equal(csv.mapCsvRows(csv.parseCsv(exported), ["title", "description", "tags"])[0].data.title, "=SUM(1,2)");
  assert.deepEqual(csv.exportFields(true, ["title", "status", "actions"]), ["title", "description", "tags", "status", "effectiveStatus", "blockedBy"]);
});

test("URL sort, priority/date ordering and versioned column preferences", () => {
  const params = new URLSearchParams("keyword=学习&status=todo&tag=复习&sort=priority:desc,dueDate:asc");
  assert.deepEqual(table.readTaskSort(params).map(item => item.key), ["priority", "dueDate"]);
  const query = table.readTaskQuery(params);
  assert.equal(table.writeTaskParams(new URLSearchParams("create=1"), query, table.readTaskSort(params)).get("keyword"), "学习");
  assert.equal(table.writeTaskParams(params, query, []).get("sort"), null);
  const first = table.nextTaskSort([], "priority", false);
  assert.deepEqual(table.nextTaskSort(first, "dueDate", true).map(item => item.key), ["priority", "dueDate"]);
  const tasks = [
    { id: "a", priority: "low", dueDate: "2026-01-01", progress: 30, createdAt: "2026-01-01T00:00:00Z" },
    { id: "b", priority: "high", dueDate: "", progress: 40, createdAt: "2026-01-02T00:00:00Z" },
    { id: "c", priority: "high", dueDate: "2026-01-03", progress: 50, createdAt: "2026-01-03T00:00:00Z" },
  ];
  assert.deepEqual(table.sortTasks(tasks, [{ key: "priority", direction: "desc" }, { key: "dueDate", direction: "asc" }]).map(item => item.id), ["c", "b", "a"]);
  assert.deepEqual(table.normalizeColumnConfig({ version: 0, order: ["dueDate", "priority", "title"], hidden: ["progress", "actions"] }).order.slice(0, 2), ["dueDate", "priority"]);
  assert.deepEqual(table.normalizeColumnConfig({ hidden: ["progress", "actions"] }).hidden, ["progress"]);
});

test("CSV import remaps internal dependencies and leaves copied recurrence inactive", () => {
  const actor = { id: "user", role: "admin" };
  const sourceSeries = { frequency: "daily", interval: 1, endType: "never", anchorDueAt: "2025-01-01T00:00:00Z" };
  const rows = [
    { rowNumber: 2, data: { id: "old-a", title: "前置", status: "done", checklist: [{ id: "old-item", text: "复习", done: true }], recurringSeriesId: "old-series", recurrenceIndex: 1, recurrenceSeries: sourceSeries } },
    { rowNumber: 3, data: { id: "old-b", title: "后续", dependencyIds: ["old-a"], recurringSeriesId: "old-series", recurrenceIndex: 2, recurrenceSeries: sourceSeries } },
  ];
  const prepared = prepareCsvImport({ tasks: [] }, rows, actor, false, "2026-01-01T00:00:00Z");
  assert.equal(prepared.imported, 2);
  assert.equal(prepared.tasks[1].dependencyIds[0], prepared.tasks[0].id);
  assert.notEqual(prepared.tasks[0].checklist[0].id, "old-item");
  assert.equal(prepared.tasks[0].completionCycles.length, 1);
  assert.equal(prepared.tasks[0].createdAt, "2026-01-01T00:00:00Z");
  assert.equal(prepared.series.length, 1);
  assert.equal(prepared.series[0].active, false);
  assert.equal(prepared.tasks[0].recurringSeriesId, prepared.tasks[1].recurringSeriesId);
  const invalid = prepareCsvImport({ tasks: [] }, [{ ...rows[0], errors: ["缺少 title"] }, rows[1]], actor, false);
  assert.equal(invalid.blocked, true);
  assert.deepEqual(invalid.errors.map(item => item.rowNumber), [2, 3]);
  const skipped = prepareCsvImport({ tasks: [] }, [{ ...rows[0], errors: ["缺少 title"] }, rows[1]], actor, true);
  assert.equal(skipped.imported, 0);
  assert.equal(skipped.skipped, 2);
});

test("full task snapshot CSV round-trips as new copies without restoring system identity", () => {
  const sourceSeries = { id: "old-series", frequency: "monthly", interval: 1, endType: "count", endCount: 3, anchorDueAt: "2025-01-31T00:00:00Z", active: true, snapshot: { title: "旧任务" } };
  const source = [
    { id: "old-a", title: "中文任务,一", description: "含\n换行", category: "基础", phase: "基础", status: "done", effectiveStatus: "done", blockedBy: [], dependencyIds: [], ownerId: "old-user", plannedStartDate: "", progress: 100, manualProgress: 55, estimatedHours: 1.5, completionCycles: [{ completedAt: "2025-01-31T00:00:00Z" }], activeCycleStartedAt: "", completedAt: "2025-01-31T00:00:00Z", legacyCompletionUnknown: false, checklist: [{ id: "old-check", text: "检查", done: true, order: 0 }], version: 5, priority: "high", dueDate: "2025-01-31T00:00:00Z", notes: "笔记", resources: [], tags: ["复习"], createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-31T00:00:00Z", recurringSeriesId: "old-series", recurrenceIndex: 1 },
    { id: "old-b", title: "后续任务", description: "", category: "基础", phase: "基础", status: "todo", effectiveStatus: "blocked", blockedBy: [{ id: "old-a", title: "中文任务,一" }], dependencyIds: ["old-a"], ownerId: "old-user", plannedStartDate: "", progress: 0, manualProgress: 0, estimatedHours: null, completionCycles: [], activeCycleStartedAt: "", completedAt: null, legacyCompletionUnknown: false, checklist: [], version: 3, priority: "medium", dueDate: "", notes: "", resources: [], tags: [], createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-31T00:00:00Z", recurringSeriesId: "", recurrenceIndex: undefined },
  ];
  const exported = csv.exportTaskCsv(source, csv.SNAPSHOT_FIELDS, { "old-series": sourceSeries });
  const parsed = csv.parseCsv(exported);
  const rows = csv.mapCsvRows(parsed, csv.autoMapHeaders(parsed.headers));
  const imported = prepareCsvImport({ tasks: [] }, rows, { id: "new-user", role: "admin" }, false, "2026-01-01T00:00:00Z");
  assert.equal(imported.imported, 2);
  assert.notEqual(imported.tasks[0].id, "old-a");
  assert.equal(imported.tasks[0].ownerId, "new-user");
  assert.equal(imported.tasks[0].version, 1);
  assert.equal(imported.tasks[0].description, "含\n换行");
  assert.equal(imported.tasks[1].dependencyIds[0], imported.tasks[0].id);
  assert.equal(imported.series[0].active, false);
});

test("bundled Chinese font embeds into a downloadable PDF", async () => {
  const bytes = await readFile(new URL("../public/fonts/NotoSansCJKsc-Regular.otf", import.meta.url));
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(bytes);
  pdf.addPage().drawText("学习任务报告 · 分类分布", { x: 40, y: 500, size: 18, font });
  const saved = await pdf.save();
  assert.ok(saved.length > 10000);
  assert.equal((await PDFDocument.load(saved)).getPageCount(), 1);
});

test("CSV API rejects invalid batch atomically, imports 100 rows and keeps JSON import", async t => {
  const { base } = await createPgTestServer(t);
  let token = "";
  const request = async (method, route, body) => {
    const response = await fetch(`${base}${route}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  for (let attempt = 0; attempt < 60; attempt++) { try { await fetch(`${base}/auth/me`); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
  token = (await request("POST", "/auth/login", { username: "admin", password: "admin123" })).data.token;
  const initial = (await request("GET", "/tasks")).data.total;
  const rows = [{ rowNumber: 2, data: { title: "有效行" } }, { rowNumber: 3, data: { title: "" } }];
  assert.equal((await request("POST", "/tasks/import-csv", { rows, skipInvalid: false })).status, 422);
  assert.equal((await request("GET", "/tasks")).data.total, initial);
  assert.equal((await request("POST", "/tasks/import-csv/preview", { rows })).data.invalid, 1);
  const committed = await request("POST", "/tasks/import-csv", { rows, skipInvalid: true });
  assert.deepEqual([committed.data.imported, committed.data.skipped], [1, 1]);
  const hundred = Array.from({ length: 100 }, (_, index) => ({ rowNumber: index + 2, data: { title: `性能任务 ${index}` } }));
  const started = performance.now();
  assert.equal((await request("POST", "/tasks/import-csv", { rows: hundred, skipInvalid: false })).data.imported, 100);
  assert.ok(performance.now() - started < 2000, "100 rows commit within 2 seconds on local mock");
  assert.equal((await request("POST", "/tasks/import", { tasks: [{ title: "原 JSON 入口" }] })).data.added, 1);
  assert.equal((await request("GET", "/tasks")).data.total, initial + 102);
});
