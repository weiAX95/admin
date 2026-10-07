import test from "node:test";
import assert from "node:assert/strict";
import { basicFixture, createPgTestServer } from "./pg-helper.mjs";

test("note links backfill, persist, survive rename and become dangling on deletion", async t => {
  const fixture = basicFixture();
  const at = new Date().toISOString();
  fixture.notes = [
    { id: "source", title: "来源", content: "见 [[目标]]；`[[目标]]`", taskId: null, sourceSessionId: null, createdAt: at, updatedAt: at },
    { id: "target", title: "目标", content: "", taskId: null, sourceSessionId: null, createdAt: at, updatedAt: at },
  ];
  const server = await createPgTestServer(t, fixture);
  const base = server.base;
  const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
  const { token } = await login.json();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const get = async path => (await fetch(`${base}${path}`, { headers })).json();
  const write = async (path, method, body) => fetch(`${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });

  let source = await get("/notes/source");
  assert.equal(source.content, "见 [[目标|id:target]]；`[[目标]]`");
  assert.deepEqual(source.links.map(link => link.targetId), ["target"]);
  assert.deepEqual((await get("/notes/target")).backlinks.map(note => note.id), ["source"]);
  assert.equal((await get("/notes/graph")).edges.length, 1);
  assert.equal((await server.client.query("SELECT count(*)::int AS total FROM note_links")).rows[0].total, 1);

  assert.equal((await write("/notes/target", "PATCH", { title: "新目标" })).status, 200);
  source = await get("/notes/source");
  assert.equal(source.links[0].targetTitle, "新目标");
  assert.equal((await write("/notes/target", "DELETE")).status, 200);
  source = await get("/notes/source");
  assert.equal(source.links[0].targetId, null);
  assert.equal(source.links[0].reason, "missing");
  assert.equal((await get("/notes/graph")).edges[0].reason, "missing");

  const pendingResponse = await write("/notes", "POST", { title: "待解析", content: "[[将来]]" });
  const pending = await pendingResponse.json();
  assert.equal((await get(`/notes/${pending.id}`)).links[0].reason, "missing");
  const createdResponse = await write("/notes", "POST", { title: "将来", content: "" });
  const created = await createdResponse.json();
  const resolved = await get(`/notes/${pending.id}`);
  assert.equal(resolved.links[0].targetId, created.id);
  assert.match(resolved.content, new RegExp(`\\|id:${created.id}`));
});
