import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("atomic bulk changes and field history, including rollback and legacy activity", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "admin-task-history-"));
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
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await fetch(`${base}/auth/me`); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.ok(ready, "mock API starts");
  token = (await request("POST", "/auth/login", { username: "admin", password: "admin123" })).data.token;
  const tasks = (await request("GET", "/tasks")).data.items;
  let first = tasks[0];
  let second = tasks[1];
  const originalCategory = first.category;
  const originalDueDate = first.dueDate;
  const priority = first.priority === "high" ? "low" : "high";

  first = (await request("PATCH", `/tasks/${first.id}`, { category: "审计测试", priority })).data;
  let history = (await request("GET", `/tasks/${first.id}/change-logs`)).data;
  const categoryEntry = history.items.find(item => item.fieldName === "category");
  const priorityEntry = history.items.find(item => item.fieldName === "priority");
  assert.equal(categoryEntry.oldValue, originalCategory);
  assert.equal(categoryEntry.newValue, "审计测试");
  assert.equal(categoryEntry.operationId, priorityEntry.operationId);
  assert.ok(history.legacyItems.length > 0);

  first = (await request("PUT", `/tasks/${first.id}/checklist`, { version: first.version, checklist: [{ id: "check-1", text: "验证", done: true }] })).data;
  first = (await request("PUT", `/tasks/${first.id}/tags`, { version: first.version, tags: ["紧急"] })).data;
  history = (await request("GET", `/tasks/${first.id}/change-logs`)).data;
  assert.ok(history.items.some(item => item.fieldName === "checklist"));
  assert.ok(history.items.some(item => item.fieldName === "tags"));
  assert.equal(history.items.some(item => item.fieldName === "progress"), false);

  const finished = (await request("POST", "/tasks", { title: "清单状态联动", status: "done", checklist: [{ id: "done-item", text: "已完成", done: true }] })).data;
  const reopened = (await request("PUT", `/tasks/${finished.id}/checklist`, { version: finished.version, checklist: [{ id: "done-item", text: "已完成", done: false }] })).data;
  assert.equal(reopened.status, "in_progress");
  const linkedChanges = (await request("GET", `/tasks/${finished.id}/change-logs`)).data.items;
  assert.deepEqual(new Set(linkedChanges.map(item => item.fieldName)), new Set(["checklist", "status"]));
  assert.equal(new Set(linkedChanges.map(item => item.operationId)).size, 1);

  first = (await request("PATCH", `/tasks/${first.id}`, { plannedStartDate: "2030-01-01", dueDate: "2031-01-01" })).data;
  const beforeFailedBulk = (await request("GET", `/tasks/${second.id}/change-logs`)).data.items.length;
  const invalid = await request("POST", "/tasks/bulk", {
    ids: [first.id, second.id], versions: { [first.id]: first.version, [second.id]: second.version },
    action: "update", changes: { dueDate: "2029-01-01" },
  });
  assert.equal(invalid.status, 409);
  assert.deepEqual([invalid.data.successCount, invalid.data.failedCount], [0, 2]);
  assert.ok(invalid.data.errors.some(item => item.taskId === first.id));
  assert.equal((await request("GET", `/tasks/${first.id}`)).data.dueDate, "2031-01-01");
  assert.equal((await request("GET", `/tasks/${second.id}`)).data.dueDate, second.dueDate);
  assert.equal((await request("GET", `/tasks/${second.id}/change-logs`)).data.items.length, beforeFailedBulk);

  const success = await request("POST", "/tasks/bulk", {
    ids: [first.id, second.id], versions: { [first.id]: first.version, [second.id]: second.version },
    action: "update", changes: { category: "批量分类" },
  });
  assert.equal(success.status, 200);
  assert.deepEqual([success.data.successCount, success.data.failedCount], [2, 0]);
  first = (await request("GET", `/tasks/${first.id}`)).data;
  second = (await request("GET", `/tasks/${second.id}`)).data;
  assert.equal(first.category, "批量分类");
  assert.equal(second.category, "批量分类");

  const stale = await request("POST", `/tasks/${first.id}/change-logs/${categoryEntry.id}/rollback`, { version: first.version - 1 });
  assert.equal(stale.status, 409);
  const badRollback = await request("POST", `/tasks/${first.id}/change-logs/${(await request("GET", `/tasks/${first.id}/change-logs`)).data.items.find(item => item.fieldName === "dueDate").id}/rollback`, { version: first.version });
  assert.equal(badRollback.status, 400);
  assert.equal((await request("GET", `/tasks/${first.id}`)).data.dueDate, "2031-01-01");
  const rolled = await request("POST", `/tasks/${first.id}/change-logs/${categoryEntry.id}/rollback`, { version: first.version });
  assert.equal(rolled.status, 200);
  assert.equal(rolled.data.category, originalCategory);
  history = (await request("GET", `/tasks/${first.id}/change-logs`)).data;
  assert.ok(history.items.some(item => item.action === "rollback" && item.sourceEntryId === categoryEntry.id && item.newValue === originalCategory));
  assert.equal(history.legacyItems.some(item => item.detail === "回滚 category"), false);
  assert.notEqual(originalDueDate, "2031-01-01");

  const parent = (await request("POST", "/tasks", { title: "批量删除前置", category: "测试" })).data;
  const dependent = (await request("POST", "/tasks", { title: "依赖任务", dependencyIds: [parent.id] })).data;
  const rejectedDelete = await request("POST", "/tasks/bulk", { ids: [parent.id, second.id], versions: { [parent.id]: parent.version, [second.id]: second.version - 1 }, action: "delete" });
  assert.equal(rejectedDelete.status, 409);
  assert.equal((await request("GET", `/tasks/${parent.id}`)).status, 200);
  assert.deepEqual((await request("GET", `/tasks/${dependent.id}`)).data.dependencyIds, [parent.id]);
  const deleted = await request("POST", "/tasks/bulk", { ids: [parent.id, second.id], versions: { [parent.id]: parent.version, [second.id]: second.version }, action: "delete" });
  assert.equal(deleted.status, 200);
  assert.equal((await request("GET", `/tasks/${parent.id}`)).status, 404);
  assert.deepEqual((await request("GET", `/tasks/${dependent.id}`)).data.dependencyIds, []);
  assert.ok((await request("GET", `/tasks/${dependent.id}/change-logs`)).data.items.some(item => item.fieldName === "dependencyIds"));
  const persisted = JSON.parse(await readFile(path.join(directory, "db.json"), "utf8"));
  assert.ok(persisted.changeLogs.some(item => item.action === "rollback" && item.sourceEntryId === categoryEntry.id));
  assert.ok(persisted.legacyActivityIds.length > 0);
});
