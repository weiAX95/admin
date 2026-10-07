import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Select, Space, Spin, Tag, Typography } from "antd";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import { Link, useNavigate } from "react-router-dom";
import { getKnowledgeGraph } from "../api/notes";
import type { KnowledgeGraphData } from "../types";

type Node = KnowledgeGraphData["nodes"][number] & { x?: number; y?: number; fx?: number | null; fy?: number | null };
type Edge = { source: string | Node; target: string | Node; type: KnowledgeGraphData["edges"][number]["type"]; missing: boolean };
const colors = { note: "#9582ff", task: "#7dcca4", session: "#80b9ed" };
const labels = { note: "笔记", task: "任务", session: "会话" };
const radius = (node: Node) => Math.min(31, 14 + Math.sqrt(node.referenceCount) * 4);
const route = (node: Node) => node.type === "note" ? `/notes/${encodeURIComponent(node.entityId)}` : node.type === "task" ? `/tasks/${encodeURIComponent(node.entityId)}` : `/sessions?sessionId=${encodeURIComponent(node.entityId)}`;

export default function NoteGraph() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<KnowledgeGraphData | null>(null);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<{ node: Node; x: number; y: number } | null>(null);
  useEffect(() => {
    let alive = true;
    getKnowledgeGraph().then(result => { if (alive) setData(result); }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "加载知识图谱失败"); });
    return () => { alive = false; };
  }, []);
  const graph = useMemo(() => data ? {
    nodes: data.nodes.map((node, index) => ({ ...node, x: 500 + Math.cos(index * 2.4) * Math.sqrt(index) * 20, y: 320 + Math.sin(index * 2.4) * Math.sqrt(index) * 20 })) as Node[],
    edges: data.edges.map(edge => ({ source: edge.sourceId, target: edge.targetId, type: edge.type, missing: edge.missing })) as Edge[],
  } : null, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph?.nodes.length) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const view = { width: 1000, height: 640, scale: 1, x: 0, y: 0, dpr: window.devicePixelRatio || 1 };
    let frame = 0;
    let active = true;
    let down: { x: number; y: number; lastX: number; lastY: number; node: Node | null; dragged: boolean } | null = null;
    const draw = () => {
      frame = 0;
      if (!active) return;
      context.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      context.clearRect(0, 0, view.width, view.height);
      context.translate(view.x, view.y); context.scale(view.scale, view.scale);
      for (const edge of graph.edges) {
        const source = edge.source as Node; const target = edge.target as Node;
        if (source.x === undefined || target.x === undefined) continue;
        context.beginPath(); context.moveTo(source.x, source.y || 0); context.lineTo(target.x, target.y || 0);
        context.strokeStyle = edge.missing ? "#ec929f" : edge.type === "reference" ? colors.note : edge.type === "association" ? colors.task : colors.session;
        context.globalAlpha = .55; context.lineWidth = 1.6; context.setLineDash(edge.missing ? [5, 4] : edge.type === "source" ? [3, 3] : []); context.stroke();
      }
      context.setLineDash([]); context.globalAlpha = 1;
      for (const node of graph.nodes) {
        const x = node.x || 0; const y = node.y || 0; const r = radius(node);
        context.beginPath();
        if (node.type === "note") context.rect(x - r, y - r, r * 2, r * 2);
        else if (node.type === "session") { context.moveTo(x, y - r * 1.2); context.lineTo(x + r * 1.2, y); context.lineTo(x, y + r * 1.2); context.lineTo(x - r * 1.2, y); context.closePath(); }
        else context.arc(x, y, r, 0, Math.PI * 2);
        context.fillStyle = node.missing ? "#3a2028" : "#1c2236"; context.strokeStyle = node.missing ? "#ec929f" : colors[node.type];
        context.lineWidth = 2; context.fill(); context.stroke();
        if (view.scale >= .65) { context.font = "12px sans-serif"; context.textAlign = "center"; context.fillStyle = node.missing ? "#ec929f" : "#e8eaf4"; context.fillText(node.title.length > 14 ? `${node.title.slice(0, 14)}…` : node.title, x, y + r + 17, 155); }
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    const simulation = forceSimulation<Node>(graph.nodes)
      .force("link", forceLink<Node, Edge>(graph.edges).id(node => node.id).distance(115))
      .force("charge", forceManyBody().strength(-260))
      .force("center", forceCenter(view.width / 2, view.height / 2))
      .force("collision", forceCollide<Node>().radius(node => radius(node) + 24))
      .alphaDecay(.045).on("tick", schedule);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      view.width = rect.width; view.height = rect.height; view.dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * view.dpr); canvas.height = Math.round(rect.height * view.dpr);
      simulation.force("center", forceCenter(rect.width / 2, rect.height / 2)); simulation.alpha(.2).restart(); schedule();
    };
    const point = (event: PointerEvent | WheelEvent) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const hit = (x: number, y: number) => {
      const worldX = (x - view.x) / view.scale; const worldY = (y - view.y) / view.scale;
      for (let index = graph.nodes.length - 1; index >= 0; index--) { const node = graph.nodes[index]; if (Math.hypot((node.x || 0) - worldX, (node.y || 0) - worldY) <= radius(node) + 5) return node; }
      return null;
    };
    const onDown = (event: PointerEvent) => { const p = point(event); down = { ...p, lastX: p.x, lastY: p.y, node: hit(p.x, p.y), dragged: false }; canvas.setPointerCapture(event.pointerId); if (down.node) { down.node.fx = down.node.x; down.node.fy = down.node.y; simulation.alphaTarget(.12).restart(); } };
    const onMove = (event: PointerEvent) => {
      const p = point(event);
      if (down) {
        if (Math.hypot(p.x - down.x, p.y - down.y) > 4) down.dragged = true;
        if (down.node) { down.node.fx = (p.x - view.x) / view.scale; down.node.fy = (p.y - view.y) / view.scale; simulation.alpha(.15).restart(); }
        else if (down.dragged) { view.x += p.x - down.lastX; view.y += p.y - down.lastY; schedule(); }
        down.lastX = p.x; down.lastY = p.y;
      }
      const node = hit(p.x, p.y);
      canvas.style.cursor = down?.node ? "grabbing" : node?.missing ? "help" : node ? "pointer" : down ? "grabbing" : "grab";
      setHover(node ? { node, x: Math.min(p.x + 14, Math.max(8, canvas.clientWidth - 260)), y: Math.min(p.y + 14, Math.max(8, canvas.clientHeight - 110)) } : null);
    };
    const onUp = (event: PointerEvent) => { if (!down) return; const current = down; down = null; if (current.node) { current.node.fx = null; current.node.fy = null; simulation.alphaTarget(0); } if (!current.dragged && current.node && !current.node.missing) navigate(route(current.node)); if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
    const onCancel = (event: PointerEvent) => { if (down?.node) { down.node.fx = null; down.node.fy = null; simulation.alphaTarget(0); } down = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); setHover(null); };
    const onLeave = () => setHover(null);
    const onWheel = (event: WheelEvent) => { event.preventDefault(); const p = point(event); const next = Math.min(3, Math.max(.35, view.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12))); view.x = p.x - (p.x - view.x) * next / view.scale; view.y = p.y - (p.y - view.y) * next / view.scale; view.scale = next; schedule(); };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove); canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onCancel); canvas.addEventListener("pointerleave", onLeave); canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => { active = false; simulation.stop(); observer.disconnect(); if (frame) cancelAnimationFrame(frame); canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onCancel); canvas.removeEventListener("pointerleave", onLeave); canvas.removeEventListener("wheel", onWheel); };
  }, [graph, navigate]);

  if (error) return <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => window.location.reload()}>重试</Button>} />;
  if (!graph) return <Spin className="task-detail-loading" />;
  return <Card title="知识图谱" extra={<Link to="/notes">返回笔记列表</Link>}>
    <Space wrap><Tag color="purple">□ 笔记／引用</Tag><Tag color="green">○ 任务／关联</Tag><Tag color="blue">◇ 会话／来源</Tag><Tag color="red">红色虚线：目标缺失</Tag><Typography.Text type="secondary">节点大小反映被引用／关联次数；拖动节点或画布，滚轮缩放。</Typography.Text></Space>
    {graph.nodes.length === 0 ? <Empty description="暂无知识节点" /> : <>
      <div className="knowledge-graph-wrap"><canvas ref={canvasRef} className="knowledge-graph-canvas" aria-label="知识图谱：笔记、任务和会话节点" />{hover && <div className="knowledge-graph-tooltip" style={{ left: hover.x, top: hover.y }}><strong>{labels[hover.node.type]} · {hover.node.title}</strong><p>{hover.node.summary || "暂无摘要"}</p><small>{hover.node.referenceCount} 条引用或关联{hover.node.missing ? " · 目标不存在" : ""}</small></div>}</div>
      <Select showSearch aria-label="查找知识节点" placeholder="查找节点并跳转（键盘可用）" style={{ width: "min(420px, 100%)", marginTop: 12 }} value={undefined} options={graph.nodes.filter(node => !node.missing).map(node => ({ value: node.id, label: `${labels[node.type]} · ${node.title}` }))} onChange={id => { const node = graph.nodes.find(item => item.id === id); if (node) navigate(route(node)); }} />
    </>}
  </Card>;
}
