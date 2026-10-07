import test from "node:test";
import assert from "node:assert/strict";
import { buildKnowledgeGraph } from "../mock/knowledge-graph.mjs";
import { basicFixture, createPgTestServer } from "./pg-helper.mjs";

test("knowledge graph includes typed nodes, three edge types and reference weights", () => {
  const graph = buildKnowledgeGraph({
    tasks: [{ id: "t1", title: "学习任务", description: "任务摘要" }],
    sessions: [{ id: "s1", messages: [{ role: "user", content: "如何学习 React？" }] }],
    notes: [
      { id: "n1", title: "第一篇", content: "正文", taskId: "t1", sourceSessionId: "s1", links: [{ targetId: "n2", label: "第二篇" }, { targetId: null, label: "悬空" }] },
      { id: "n2", title: "第二篇", content: "被引用", links: [] },
    ],
  });
  assert.deepEqual(graph.nodes.filter(node => !node.missing).map(node => node.type).sort(), ["note", "note", "session", "task"]);
  assert.deepEqual(graph.edges.map(edge => edge.type).sort(), ["association", "reference", "reference", "source"]);
  assert.equal(graph.nodes.find(node => node.id === "note:n2").referenceCount, 1);
  assert.equal(graph.nodes.find(node => node.id === "task:t1").referenceCount, 1);
  assert.equal(graph.nodes.find(node => node.id === "session:s1").referenceCount, 1);
  assert.equal(graph.nodes.find(node => node.missing).title, "悬空");
});

test("knowledge graph payload handles more than 100 nodes without duplicate identities", () => {
  const notes = Array.from({ length: 120 }, (_, index) => ({ id: `n${index}`, title: `笔记 ${index}`, content: "摘要", links: index ? [{ targetId: `n${index - 1}`, label: "上一页" }] : [] }));
  const graph = buildKnowledgeGraph({ notes, tasks: [], sessions: [] });
  assert.equal(graph.nodes.length, 120);
  assert.equal(graph.edges.length, 119);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, 120);
});

test("authenticated knowledge graph API includes persisted note, task and session relationships", async t => {
  const fixture = basicFixture();
  const at = new Date().toISOString();
  fixture.sessions = [{ id: "s1", userId: "chat-user", createdAt: at, updatedAt: at, messages: [{ id: "m1", role: "user", content: "会话主题", at }] }];
  fixture.notes = [
    { id: "n1", title: "第一篇", content: "引用 [[第二篇]]", taskId: "seed-task-1", sourceSessionId: "s1", categoryId: null, tags: [], createdAt: at, updatedAt: at },
    { id: "n2", title: "第二篇", content: "", taskId: null, sourceSessionId: null, categoryId: null, tags: [], createdAt: at, updatedAt: at },
  ];
  const api = await createPgTestServer(t, fixture);
  assert.equal((await fetch(`${api.base}/knowledge-graph`)).status, 401);
  const login = await fetch(`${api.base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
  const { token } = await login.json();
  const response = await fetch(`${api.base}/knowledge-graph`, { headers: { Authorization: `Bearer ${token}` } });
  const graph = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(graph.edges.map(edge => edge.type).sort(), ["association", "reference", "source"]);
  assert.equal(graph.nodes.find(node => node.id === "note:n2").referenceCount, 1);
});
