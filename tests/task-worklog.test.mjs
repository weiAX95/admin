import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { workVariance } from "../mock/task-worklog.mjs";

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("variance includes only estimated tasks with actual entries and highlights strictly above 50%", () => {
  const tasks = [{ id: "a", estimatedHours: 2 }, { id: "b", estimatedHours: 2 }, { id: "c", estimatedHours: null }];
  assert.deepEqual(workVariance(tasks, []), { percent: null, taskCount: 0, highlight: false });
  const entries = [{ taskId: "a", durationMinutes: 60 }, { taskId: "b", durationMinutes: 60 }, { taskId: "c", durationMinutes: 999 }];
  assert.deepEqual(workVariance(tasks, entries), { percent: 50, taskCount: 2, highlight: false });
  entries[1].durationMinutes = 59;
  assert.equal(workVariance(tasks, entries).highlight, true);
});

test("linked records, time entries, completion cycles, and stats use separate persisted data", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "admin-worklog-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["mock/server.mjs"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, MOCK_PORT: String(port), MOCK_DB_FILE: path.join(directory, "db.json") },
    stdio: "ignore",
  });
  t.after(async () => { child.kill(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}/api`;
  let token = "";
  const call = async (method, route, body) => {
    const response = await fetch(`${base}${route}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await fetch(`${base}/auth/me`); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.ok(ready);
  token = (await call("POST", "/auth/login", { username: "admin", password: "admin123" })).data.token;
  const legacyDone = (await call("GET", "/tasks")).data.items.find(task => task.status === "done");
  assert.equal(legacyDone.completedAt, null);
  assert.equal(legacyDone.legacyCompletionUnknown, true);
  const reopenedLegacy = (await call("PATCH", `/tasks/${legacyDone.id}`, { status: "in_progress" })).data;
  const finishedLegacy = (await call("PATCH", `/tasks/${legacyDone.id}`, { status: "done" })).data;
  assert.equal(finishedLegacy.completionCycles.length, 1);
  assert.equal(finishedLegacy.completionCycles[0].startedAt, reopenedLegacy.activeCycleStartedAt);
  assert.equal(finishedLegacy.legacyCompletionUnknown, true);

  let task = (await call("POST", "/tasks", { title: "工时测试", estimatedHours: 4 })).data;
  assert.equal(task.completedAt, null);
  assert.equal((await call("POST", "/tasks", { title: "无效估算", estimatedHours: -2 })).status, 400);
  const note = (await call("POST", "/notes", { title: "关联笔记", taskId: task.id })).data;
  const experiment = (await call("POST", "/experiments", { title: "关联实验", taskId: task.id })).data;
  assert.deepEqual((await call("GET", `/notes?taskId=${task.id}`)).data.items.map(item => item.id), [note.id]);
  assert.deepEqual((await call("GET", `/experiments?taskId=${task.id}`)).data.items.map(item => item.id), [experiment.id]);
  assert.equal((await call("GET", `/notes/${note.id}`)).data.title, note.title);
  assert.equal((await call("GET", `/experiments/${experiment.id}`)).data.title, experiment.title);
  assert.deepEqual((await call("GET", "/notes?taskId=missing")).data.items, []);

  assert.equal((await call("POST", `/tasks/${task.id}/time-entries`, { mode: "duration", workDate: "2026-10-05", hours: 0 })).status, 400);
  assert.equal((await call("POST", `/tasks/${task.id}/time-entries`, { mode: "interval", startedAt: "2026-10-05T10:00:00Z", endedAt: "2026-10-05T09:00:00Z" })).status, 400);
  const first = (await call("POST", `/tasks/${task.id}/time-entries`, { mode: "duration", workDate: "2026-10-05", hours: 2, note: "实际工作" })).data;
  const second = (await call("POST", `/tasks/${task.id}/time-entries`, { mode: "interval", startedAt: "2026-10-05T09:00:00Z", endedAt: "2026-10-05T10:00:00Z", note: "上午" })).data;
  const overlapping = (await call("POST", `/tasks/${task.id}/time-entries`, { mode: "interval", startedAt: "2026-10-05T09:30:00Z", endedAt: "2026-10-05T10:30:00Z", note: "允许重叠" })).data;
  assert.equal((await call("GET", `/tasks/${task.id}/time-entries`)).data.actualMinutes, 240);
  assert.equal((await call("GET", "/stats")).data.workVariance.taskCount, 1);
  assert.equal((await call("GET", "/stats")).data.workVariance.percent, 0);

  const memberToken = (await call("POST", "/auth/login", { username: "learner", password: "learn123" })).data.token;
  const adminToken = token;
  token = memberToken;
  assert.equal((await call("PUT", `/tasks/${task.id}/time-entries/${first.id}`, { mode: "duration", workDate: "2026-10-05", hours: 3 })).status, 403);
  const memberEntry = (await call("POST", `/tasks/${task.id}/time-entries`, { mode: "duration", workDate: "2026-10-05", hours: 0.5 })).data;
  assert.equal((await call("PUT", `/tasks/${task.id}/time-entries/${memberEntry.id}`, { mode: "duration", workDate: "2026-10-05", hours: 1 })).status, 200);
  token = adminToken;
  assert.equal((await call("DELETE", `/tasks/${task.id}/time-entries/${memberEntry.id}`)).status, 200);
  assert.equal((await call("DELETE", `/tasks/${task.id}/time-entries/${overlapping.id}`)).status, 200);
  assert.equal((await call("GET", `/tasks/${task.id}/time-entries`)).data.actualMinutes, first.durationMinutes + second.durationMinutes);
  assert.equal((await call("GET", "/stats?start=1900-01-01&end=1900-01-02")).data.workVariance.percent, 25);

  task = (await call("PATCH", `/tasks/${task.id}`, { status: "done" })).data;
  assert.equal(task.completionCycles.length, 1);
  assert.equal(task.completedAt, task.completionCycles[0].completedAt);
  const firstCompletedAt = task.completedAt;
  task = (await call("PATCH", `/tasks/${task.id}`, { status: "in_progress" })).data;
  assert.equal(task.completedAt, firstCompletedAt);
  assert.ok(task.activeCycleStartedAt);
  task = (await call("PATCH", `/tasks/${task.id}`, { status: "done" })).data;
  assert.equal(task.completionCycles.length, 2);
  task = (await call("PATCH", `/tasks/${task.id}`, { status: "done" })).data;
  assert.equal(task.completionCycles.length, 2);
  const statusChange = (await call("GET", `/tasks/${task.id}/change-logs`)).data.items.find(item => item.fieldName === "status" && item.oldValue === "in_progress");
  const rolled = await call("POST", `/tasks/${task.id}/change-logs/${statusChange.id}/rollback`, { version: task.version });
  assert.equal(rolled.status, 200);
  assert.equal(rolled.data.status, "in_progress");
  assert.equal(rolled.data.completionCycles.length, 2);
  assert.ok(rolled.data.activeCycleStartedAt);
  assert.ok((await call("GET", `/tasks/${task.id}/change-logs`)).data.items.some(item => item.fieldName === "estimatedHours") === false);
  task = (await call("PATCH", `/tasks/${task.id}`, { estimatedHours: 5.5 })).data;
  assert.ok((await call("GET", `/tasks/${task.id}/change-logs`)).data.items.some(item => item.fieldName === "estimatedHours" && item.newValue === 5.5));
  assert.equal(task.estimatedHours, 5.5);
});
