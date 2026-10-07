import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { basicFixture, createPgTestServer } from "./pg-helper.mjs";
import { migrate } from "../mock/postgres-store.mjs";

test("note tags have a persistent catalog and admin-only global management", async t => {
  const api = await createPgTestServer(t, basicFixture());
  const login = async (username, password) => {
    const response = await fetch(`${api.base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    return (await response.json()).token;
  };
  const admin = await login("admin", "admin123");
  const member = await login("member", "test");
  const call = async (token, route, method = "GET", body) => {
    const response = await fetch(`${api.base}${route}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };

  const first = (await call(member, "/notes", "POST", { title: "第一篇", tags: [" React ", "react", "前端"] })).data;
  const second = (await call(member, "/notes", "POST", { title: "第二篇", tags: ["REACT", "前端"] })).data;
  assert.deepEqual(first.tags, ["React", "前端"]);
  assert.deepEqual(second.tags, ["React", "前端"]);
  let catalog = (await call(member, "/note-tags")).data.items;
  const react = catalog.find(tag => tag.name === "React");
  const frontend = catalog.find(tag => tag.name === "前端");
  assert.equal(react.count, 2);
  assert.equal((await call(member, "/note-tags", "POST", { name: "空标签" })).status, 403);
  assert.equal((await call(member, `/note-tags/${react.id}`, "PATCH", { name: "ReactJS" })).status, 403);
  assert.equal((await call(member, `/note-tags/${react.id}/merge`, "POST", { targetId: frontend.id, expectedUsageCount: 2 })).status, 403);
  assert.equal((await call(member, `/note-tags/${react.id}?expectedUsageCount=2`, "DELETE")).status, 403);
  assert.equal((await call(admin, "/note-tags", "POST", { name: " react " })).status, 409);

  const renamed = await call(admin, `/note-tags/${react.id}`, "PATCH", { name: "ReactJS" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.id, react.id);
  assert.deepEqual((await call(member, `/notes/${first.id}`)).data.tags, ["ReactJS", "前端"]);
  assert.equal((await call(admin, `/note-tags/${react.id}`, "PATCH", { name: "前端" })).status, 409);
  assert.equal((await call(member, "/notes?tag=reactjs&tag=%E5%89%8D%E7%AB%AF")).data.total, 2);

  assert.equal((await call(admin, `/note-tags/${react.id}/merge`, "POST", { targetId: frontend.id, expectedUsageCount: 1 })).status, 409);
  const merged = await call(admin, `/note-tags/${react.id}/merge`, "POST", { targetId: frontend.id, expectedUsageCount: 2 });
  assert.equal(merged.status, 200);
  assert.deepEqual((await call(member, `/notes/${first.id}`)).data.tags, ["前端"]);
  assert.deepEqual((await call(member, `/notes/${second.id}`)).data.tags, ["前端"]);
  catalog = (await call(member, "/note-tags")).data.items;
  assert.equal(catalog.some(tag => tag.id === react.id), false);
  assert.equal(catalog.find(tag => tag.id === frontend.id).count, 2);

  const empty = await call(admin, "/note-tags", "POST", { name: "空标签" });
  assert.equal(empty.status, 201);
  assert.equal((await call(member, "/note-tags")).data.items.find(tag => tag.id === empty.data.id).count, 0);
  assert.equal((await call(member, "/notes")).data.tags.some(tag => tag.name === "空标签"), false);
  await call(member, `/notes/${first.id}`, "PATCH", { tags: ["空标签", "前端"] });
  assert.equal((await call(admin, `/note-tags/${empty.data.id}?expectedUsageCount=0`, "DELETE")).status, 409);
  assert.equal((await call(admin, `/note-tags/${empty.data.id}?expectedUsageCount=1`, "DELETE")).status, 200);
  assert.deepEqual((await call(member, `/notes/${first.id}`)).data.tags, ["前端"]);
  assert.equal((await call(member, "/note-tags")).data.items.some(tag => tag.id === empty.data.id), false);
  await call(member, `/notes/${second.id}`, "PATCH", { tags: [] });
  await call(member, `/notes/${first.id}`, "PATCH", { tags: [] });
  assert.equal((await call(member, "/note-tags")).data.items.find(tag => tag.id === frontend.id).count, 0);
  assert.equal((await call(member, "/notes")).data.tags.length, 0);
});

test("legacy case variants are migrated without duplicate assignments", async t => {
  const fixture = basicFixture();
  fixture.notes = [{ id: "legacy-note", title: "旧笔记", content: "", taskId: null, sourceSessionId: null, categoryId: null, tags: ["React", "react", " React "], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  const api = await createPgTestServer(t, fixture);
  const tags = (await api.client.query("SELECT tag FROM note_tags WHERE note_id='legacy-note'")).rows;
  const definitions = (await api.client.query("SELECT name FROM note_tag_definitions")).rows;
  assert.deepEqual(tags, [{ tag: "React" }]);
  assert.deepEqual(definitions, [{ name: "React" }]);
});

test("SQL migration backfills and deduplicates existing note_tags", async t => {
  const base = process.env.TEST_DATABASE_URL || "postgres://admin:admin_local_only@127.0.0.1:55432/agent_admin_test";
  const adminUrl = new URL(base); adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const database = `admin_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(base); url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  t.after(async () => { await client.end(); await admin.query(`DROP DATABASE ${database} WITH (FORCE)`); await admin.end(); });
  for (const name of ["001_initial", "002_constraints", "003_note_links", "004_media_assets", "005_note_taxonomy"]) {
    await client.query(readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), "utf8"));
    await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [name]);
  }
  await client.query("INSERT INTO notes(id,title,content,created_at,updated_at) VALUES('n1','旧笔记','','2026-01-01','2026-01-01'),('n2','另一篇','','2026-01-01','2026-01-01')");
  await client.query("INSERT INTO note_tags(note_id,tag,item_order) VALUES('n1','React',0),('n1','react',1),('n1',' React ',2),('n2','REACT',0)");
  await migrate(client);
  const definitions = (await client.query("SELECT name,normalized_key FROM note_tag_definitions")).rows;
  const assigned = (await client.query("SELECT note_id,tag FROM note_tags ORDER BY note_id")).rows;
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].normalized_key, "react");
  assert.deepEqual(assigned, [{ note_id: "n1", tag: definitions[0].name }, { note_id: "n2", tag: definitions[0].name }]);
  await assert.rejects(client.query("INSERT INTO note_tags(note_id,tag,item_order) VALUES('n1','orphan',5)"), { code: "23503" });
});
