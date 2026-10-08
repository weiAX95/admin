const excerpt = value => String(value || "").replace(/\s+/g, " ").trim().slice(0, 140);

export function buildKnowledgeGraph(data) {
  const nodes = [];
  const edges = [];
  const byId = new Map();
  const add = node => { if (!byId.has(node.id)) { nodes.push(node); byId.set(node.id, node); } };
  for (const note of data.notes || []) add({ id: `note:${note.id}`, entityId: note.id, type: "note", title: note.title, summary: excerpt(note.content), referenceCount: 0, missing: false });
  for (const task of data.tasks || []) add({ id: `task:${task.id}`, entityId: task.id, type: "task", title: task.title, summary: excerpt(task.description), referenceCount: 0, missing: false });
  for (const session of data.sessions || []) {
    const first = session.messages?.find(item => item.role === "user")?.content || "会话";
    add({ id: `session:${session.id}`, entityId: session.id, type: "session", title: excerpt(first).slice(0, 40), summary: excerpt(first), referenceCount: 0, missing: false });
  }
  const connect = (sourceId, targetId, type, missingTitle) => {
    if (!byId.has(targetId)) {
      const [nodeType, entityId] = targetId.split(/:(.*)/s);
      add({ id: targetId, entityId, type: nodeType, title: missingTitle, summary: "目标已不存在", referenceCount: 0, missing: true });
    }
    edges.push({ sourceId, targetId, type, missing: byId.get(targetId).missing });
    byId.get(targetId).referenceCount += 1;
  };
  for (const note of data.notes || []) {
    for (const [index, link] of (note.links || []).entries()) connect(`note:${note.id}`, link.targetId ? `note:${link.targetId}` : `note:missing:${note.id}:${index}`, "reference", link.label || "笔记不存在");
    if (note.taskId) connect(`note:${note.id}`, `task:${note.taskId}`, "association", "任务已删除");
    if (note.sourceSessionId) connect(`note:${note.id}`, `session:${note.sourceSessionId}`, "source", "原会话已清理");
  }
  return { nodes, edges };
}
