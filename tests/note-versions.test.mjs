import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { basicFixture, createPgTestServer } from "./pg-helper.mjs";
import { migrate } from "../mock/postgres-store.mjs";

test("each note save and restore appends a complete immutable snapshot", async t => {
  const fixture = basicFixture();
  const at = new Date().toISOString();
  fixture.notes = [{ id: "old", title: "旧标题", content: "旧内容", taskId: null, sourceSessionId: null, categoryId: null, tags: [], createdAt: at, updatedAt: at }];
  const api = await createPgTestServer(t, fixture);
  const login = await fetch(`${api.base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
  const { token } = await login.json();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const call = async (path, method = "GET", body) => {
    const response = await fetch(`${api.base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };

  let versions = (await call("/notes/old/versions")).data.items;
  assert.deepEqual(versions.map(item => [item.versionNumber, item.title, item.content]), [[1, "旧标题", "旧内容"]]);
  assert.equal((await call("/notes/old", "PATCH", { title: "新标题", content: "第一行\n第二行" })).status, 200);
  assert.equal((await call("/notes/old", "PUT", { content: "第一行\n新增行" })).status, 200);
  versions = (await call("/notes/old/versions")).data.items;
  assert.deepEqual(versions.map(item => item.versionNumber), [3, 2, 1]);
  assert.deepEqual([versions[0].title, versions[0].content], ["新标题", "第一行\n新增行"]);
  assert.equal((await call(`/notes/old/versions/${versions[1].id}`)).data.content, "第一行\n第二行");
  assert.equal((await call("/notes/old/restore", "POST", { versionId: versions[0].id })).status, 200);
  const restored = await call("/notes/old/restore", "POST", { versionId: versions[2].id });
  assert.equal(restored.status, 200);
  assert.deepEqual([restored.data.title, restored.data.content], ["旧标题", "旧内容"]);
  versions = (await call("/notes/old/versions")).data.items;
  assert.deepEqual(versions.map(item => item.versionNumber), [5, 4, 3, 2, 1]);
  assert.equal(versions[0].reason, "restore");
  assert.equal((await call(`/notes/old/versions/${versions[2].id}`)).data.content, "第一行\n新增行");
  assert.equal((await call("/notes/old/restore", "POST", { versionId: "missing" })).status, 404);
  assert.equal((await api.client.query("SELECT count(*)::int AS n FROM note_versions WHERE note_id='old'")).rows[0].n, 5);
});

test("migration gives existing notes one baseline without inventing older versions", async t => {
  const base = process.env.TEST_DATABASE_URL || "postgres://admin:admin_local_only@127.0.0.1:55432/agent_admin_test";
  const adminUrl = new URL(base); adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() }); await admin.connect();
  const database = `admin_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(base); url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() }); await client.connect();
  t.after(async () => { await client.end(); await admin.query(`DROP DATABASE ${database} WITH (FORCE)`); await admin.end(); });
  for (const name of ["001_initial", "002_constraints", "003_note_links", "004_media_assets", "005_note_taxonomy", "006_note_tag_catalog"]) {
    await client.query(readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), "utf8"));
    await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [name]);
  }
  await client.query("INSERT INTO notes(id,title,content,created_at,updated_at) VALUES('old','迁移前标题','迁移前正文','2026-01-01','2026-02-01')");
  await migrate(client);
  const versions = (await client.query("SELECT version_number,title,content,reason,created_at FROM note_versions WHERE note_id='old'")).rows;
  assert.deepEqual(versions, [{ version_number: 1, title: "迁移前标题", content: "迁移前正文", reason: "baseline", created_at: "2026-02-01" }]);
});
