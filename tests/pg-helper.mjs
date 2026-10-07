import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import { migrate, importJson } from "../mock/postgres-store.mjs";
import { hashPassword } from "../mock/passwords.mjs";

const baseUrl = process.env.TEST_DATABASE_URL || "postgres://admin:admin_local_only@127.0.0.1:55432/agent_admin_test";
const root = new URL("../", import.meta.url);
export function basicFixture() {
  const t = new Date().toISOString();
  return {
    users: [
      { id: "admin", username: "admin", password: "admin123", name: "管理员", role: "admin", status: "active", createdAt: t, updatedAt: t },
      { id: "member", username: "member", password: "test", name: "成员", role: "member", status: "active", createdAt: t, updatedAt: t },
      { id: "learner", username: "learner", password: "learn123", name: "学习者", role: "member", status: "active", createdAt: t, updatedAt: t },
    ],
    tasks: [
      { id: "seed-task-1", title: "起始任务", description: "", category: "基础", phase: "基础", status: "todo", priority: "high", dueDate: "2026-10-01", plannedStartDate: "", notes: "", progress: 0, manualProgress: 0, ownerId: "admin", version: 1, tags: [], resources: [], checklist: [], dependencyIds: [], createdAt: t, updatedAt: t },
      { id: "seed-task-2", title: "历史完成任务", description: "", category: "进阶", phase: "基础", status: "done", priority: "medium", dueDate: "", plannedStartDate: "", notes: "", progress: 100, manualProgress: 100, ownerId: "admin", version: 1, tags: [], resources: [], checklist: [], dependencyIds: [], createdAt: t, updatedAt: new Date(Date.now()-1000).toISOString() },
    ],
    sessions: [], notes: [], experiments: [], activity: [{ id: "seed-activity", type: "update", taskId: "seed-task-1", title: "起始任务", detail: "早期活动", at: t }],
    legacyActivityIds: ["seed-activity"], taskTrendEvents: [], taskTrendSnapshots: [], taskTemplates: [], changeLogs: [], timeEntries: [], recurringSeries: [],
  };
}

async function freePort() {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

export async function createPgTestServer(t, fixture = basicFixture(), extraEnv = {}) {
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const database = `admin_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await migrate(client);
    const data = { ...fixture, users: (fixture.users || []).map(user => ({ ...user, passwordHash: hashPassword(user.password), password: undefined })) };
    await client.query("BEGIN");
    await importJson(client, data, randomUUID());
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  const port = await freePort();
  const child = spawn(process.execPath, [new URL("../mock/server.mjs", import.meta.url).pathname], { cwd: root.pathname, env: { ...process.env, DATABASE_URL: url.toString(), MOCK_PORT: String(port), ...extraEnv }, stdio: "ignore" });
  t.after(async () => {
    child.kill("SIGTERM");
    await client.end();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  });
  const base = `http://127.0.0.1:${port}/api`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch(`${base}/auth/me`); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  if (!ready) throw new Error("PostgreSQL API failed to start");
  return { base, port, child, client, database, url: url.toString() };
}
