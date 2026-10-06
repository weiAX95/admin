import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { createSeries, generateDueInstances, occurrenceDueAt, parseDueAt, updateSeries } from "../mock/recurring.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test("recurrence preserves Shanghai time and original month-end anchor", () => {
  assert.equal(parseDueAt("2028-02-29"), "2028-02-28T16:00:00.000Z");
  assert.equal(parseDueAt("2026-02-30"), null);
  const task = { id: "first", ownerId: "u", title: "学习", dueDate: "2028-01-31T15:45:00+08:00", checklist: [{ text: "一步", done: true, order: 0 }] };
  const series = createSeries(task, { frequency: "monthly", interval: 1, endType: "count", endCount: 3 }, Date.parse("2028-01-01T00:00:00Z"));
  assert.equal(occurrenceDueAt(series, 2), "2028-02-29T07:45:00.000Z");
  assert.equal(occurrenceDueAt(series, 3), "2028-03-31T07:45:00.000Z");
  const weekly = { ...series, frequency: "weekly", interval: 2 };
  assert.equal(occurrenceDueAt(weekly, 2), "2028-02-14T07:45:00.000Z");
  const untilFebruary = createSeries(task, { frequency: "monthly", interval: 1, endType: "date", endDate: "2028-02-29" }, Date.parse("2028-01-01T00:00:00Z"));
  const limited = { tasks: [task], recurringSeries: [untilFebruary] };
  assert.equal(generateDueInstances(limited, Date.parse("2028-04-01T00:00:00Z")), 1);
  assert.equal(limited.tasks[1].recurrenceIndex, 2);
  assert.throws(() => createSeries(task, { frequency: "daily", interval: 1, endType: "never" }, Date.parse("2028-02-01T00:00:00Z")), /未来/);
});

test("catch-up creates every missed instance once; deletion does not replace an occurrence", () => {
  const task = { id: "first", ownerId: "u", title: "旧标题", description: "描述", category: "课程", phase: "基础", priority: "high", tags: ["复习"], resources: [], estimatedHours: 2, dueDate: "2026-01-01T09:00:00+08:00", checklist: [{ id: "a", text: "阅读", done: true, order: 0 }] };
  const series = createSeries(task, { frequency: "daily", interval: 1, endType: "count", endCount: 4 }, Date.parse("2025-12-31T00:00:00Z"));
  const db = { tasks: [task], recurringSeries: [series] };
  assert.equal(generateDueInstances(db, Date.parse("2026-01-05T00:00:00Z"), 2), 2);
  assert.equal(generateDueInstances(db, Date.parse("2026-01-05T00:00:00Z"), 2), 1);
  assert.equal(generateDueInstances(db, Date.parse("2026-01-05T00:00:00Z"), 2), 0);
  assert.deepEqual(db.tasks.map(item => item.recurrenceIndex || 1), [1, 2, 3, 4]);
  assert.deepEqual(db.tasks.slice(1).map(item => item.dueDate), ["2026-01-02T01:00:00.000Z", "2026-01-03T01:00:00.000Z", "2026-01-04T01:00:00.000Z"]);
  assert.ok(db.tasks.slice(1).every(item => item.status === "todo" && item.notes === "" && item.checklist[0].done === false && item.checklist[0].id !== "a"));
  db.tasks.splice(1, 1);
  assert.equal(generateDueInstances(db, Date.parse("2026-01-10T00:00:00Z")), 0);
  assert.equal(db.tasks.length, 3);
  const restarted = JSON.parse(JSON.stringify(db));
  assert.equal(generateDueInstances(restarted, Date.parse("2026-01-10T00:00:00Z")), 0);
  assert.equal(restarted.tasks.length, 3);
  const changed = updateSeries(series, { frequency: "weekly", interval: 1, endType: "never" }, { ...task, title: "新标题" }, { updateSnapshot: true });
  assert.equal(changed.snapshot.title, "新标题");
  assert.equal(series.snapshot.title, "旧标题");
});

test("mock API searches notes and generates the next instance at due time", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "admin-recurring-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["mock/server.mjs"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, MOCK_PORT: String(port), MOCK_DB_FILE: path.join(directory, "db.json") },
    stdio: "ignore",
  });
  t.after(async () => { child.kill(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}/api`;
  let token = "";
  const request = async (method, route, body) => {
    const response = await fetch(`${base}${route}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await fetch(`${base}/auth/me`); break; } catch { await delay(50); }
  }
  token = (await request("POST", "/auth/login", { username: "admin", password: "admin123" })).data.token;
  const dueDate = new Date(Date.now() + 1500).toISOString();
  const created = await request("POST", "/tasks", { title: "重复原任务", description: "普通描述", notes: "独有搜索词 QwErTy", dueDate, checklist: [{ text: "阅读", done: true }], recurrence: { enabled: true, frequency: "daily", interval: 1, endType: "count", endCount: 2 } });
  assert.equal(created.status, 201);
  assert.equal(created.data.recurrenceIndex, 1);
  const id = created.data.recurringSeriesId;
  assert.ok(id);
  assert.equal((await request("GET", "/tasks?keyword=qwerty")).data.items.some(item => item.id === created.data.id), true);
  assert.equal((await request("GET", "/tasks?keyword=普通描述")).data.items.some(item => item.id === created.data.id), true);
  assert.equal((await request("GET", "/tasks?keyword=重复原任务")).data.items.some(item => item.id === created.data.id), true);
  assert.equal((await request("GET", "/tasks?keyword=does-not-exist")).data.total, 0);
  assert.ok((await request("GET", "/tasks?keyword=")).data.total > 0);
  const series = (await request("GET", `/recurring-series/${id}`)).data;
  assert.equal(series.nextSequence, 2);
  let generated;
  for (let attempt = 0; attempt < 40; attempt++) {
    generated = (await request("GET", "/tasks")).data.items.find(item => item.recurringSeriesId === id && item.recurrenceIndex === 2);
    if (generated) break;
    await delay(100);
  }
  assert.ok(generated, "scheduler generates the next occurrence");
  assert.equal(generated.title, "重复原任务");
  assert.equal(generated.notes, "");
  assert.equal(generated.checklist[0].done, false);
  assert.equal((await request("GET", `/recurring-series/${id}`)).data.finished, true);
  const persisted = JSON.parse(await readFile(path.join(directory, "db.json"), "utf8"));
  assert.equal(persisted.recurringSeries.find(item => item.id === id).nextSequence, 3);
  assert.equal(persisted.tasks.filter(item => item.recurringSeriesId === id).length, 2);
  await request("DELETE", `/tasks/${generated.id}`);
  assert.equal((await request("GET", `/recurring-series/${id}`)).data.nextSequence, 3);

  const dueLater = new Date(Date.now() + 1700).toISOString();
  const source = (await request("POST", "/tasks", { title: "序列原稿", dueDate: dueLater })).data;
  const attached = await request("POST", "/recurring-series", { taskId: source.id, frequency: "daily", interval: 1, endType: "never" });
  assert.equal(attached.status, 201);
  await request("PATCH", `/tasks/${source.id}`, { title: "仅本次修改" });
  assert.equal((await request("GET", `/recurring-series/${attached.data.id}`)).data.snapshot.title, "序列原稿");
  const updated = await request("PUT", `/recurring-series/${attached.data.id}`, { taskId: source.id, version: attached.data.version, frequency: "daily", interval: 1, endType: "never", updateSnapshot: true });
  assert.equal(updated.data.snapshot.title, "仅本次修改");
  assert.equal((await request("PUT", `/recurring-series/${attached.data.id}`, { taskId: source.id, version: attached.data.version, frequency: "weekly", interval: 1, endType: "never" })).status, 409);
  assert.equal((await request("POST", `/recurring-series/${attached.data.id}/stop`, {})).data.finished, true);
  await delay(1900);
  assert.equal((await request("GET", "/tasks")).data.items.some(item => item.recurringSeriesId === attached.data.id && item.recurrenceIndex === 2), false);
});
