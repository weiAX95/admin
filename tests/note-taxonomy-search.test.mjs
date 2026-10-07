import test from "node:test";
import assert from "node:assert/strict";
import { basicFixture, createPgTestServer } from "./pg-helper.mjs";

test("note category tree, independent tags and combined full-text filters persist", async t => {
  const api = await createPgTestServer(t, basicFixture());
  const login = await fetch(`${api.base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
  const token = (await login.json()).token;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const call = async (route, method = "GET", body) => {
    const response = await fetch(`${api.base}${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const root = (await call("/note-categories", "POST", { name: "前端" })).data;
  assert.equal((await call("/note-categories", "POST", { name: "前端" })).status, 409);
  const child = (await call("/note-categories", "POST", { name: "React", parentId: root.id })).data;
  const leaf = (await call("/note-categories", "POST", { name: "Hooks", parentId: child.id })).data;
  assert.equal((await call(`/note-categories/${root.id}`, "PATCH", { parentId: leaf.id })).status, 409);
  const first = (await call("/notes", "POST", { title: "Hook 状态", content: "useState 管理状态", categoryId: leaf.id, tags: ["前端", "复习", "前端"] })).data;
  const second = (await call("/notes", "POST", { title: "React 测试", content: "组件测试", categoryId: child.id, tags: ["前端"] })).data;
  assert.deepEqual(first.tags, ["前端", "复习"]);
  const result = await call(`/notes?categoryId=${root.id}&keyword=state&tag=%E5%89%8D%E7%AB%AF`);
  assert.deepEqual(result.data.items.map(note => note.id), [first.id]);
  assert.equal(result.data.tags.find(tag => tag.name === "前端").count, 2);
  assert.equal((await call(`/notes?categoryId=${root.id}`)).data.total, 2);
  assert.equal((await call("/notes?keyword=react")).data.total, 1);
  assert.equal((await call(`/notes?tag=%E5%A4%8D%E4%B9%A0&tag=%E5%89%8D%E7%AB%AF`)).data.total, 1);
  assert.equal((await call(`/note-categories/${child.id}`, "DELETE")).status, 409);
  assert.equal((await call(`/notes/${first.id}`, "PATCH", { categoryId: null, tags: [] })).status, 200);
  assert.equal((await call(`/note-categories/${leaf.id}`, "DELETE")).status, 200);
  assert.equal((await call(`/note-categories/${child.id}`, "DELETE")).status, 200);
  assert.equal((await call(`/notes/${second.id}`)).data.categoryId ?? null, null);
  assert.equal((await api.client.query("SELECT count(*)::int AS count FROM note_tags")).rows[0].count, 1);

  assert.equal((await call("/notes", "POST", { title: "无效来源", sourceSessionId: "missing" })).status, 400);
  const session = (await call("/sessions/ingest", "POST", { userId: "chat-user", messages: [{ role: "assistant", content: "一段可摘录的文字" }] })).data;
  const excerpt = (await call("/notes", "POST", { title: "一段可摘录的文字", content: "一段可摘录的文字", sourceSessionId: session.id })).data;
  assert.equal((await call(`/notes/${excerpt.id}`)).data.sourceSessionId, session.id);
});
