import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Popover, Space, Tooltip, Typography } from "antd";
import { FileTextOutlined, PlusOutlined, ReadOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { getQuickActionCounts, getQuickPreview } from "../api/dashboard";
import type { QuickActionCounts, QuickActionKind, QuickPreviewItem } from "../api/dashboard";

const CACHE_MS = 60_000;
type PreviewState = { items: QuickPreviewItem[]; loading: boolean; error: string };

export default function DashboardQuickActions({ refreshKey = 0 }: { refreshKey?: number }) {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<QuickActionCounts | null>(null);
  const [countsError, setCountsError] = useState("");
  const [countsRetry, setCountsRetry] = useState(0);
  const [previews, setPreviews] = useState<Partial<Record<QuickActionKind, PreviewState>>>({});
  const cache = useRef<Partial<Record<QuickActionKind, { items: QuickPreviewItem[]; at: number }>>>({});
  const inFlight = useRef(new Set<QuickActionKind>());
  const mounted = useRef(true);

  useEffect(() => {
    cache.current = {};
    setPreviews({});
    mounted.current = true;
    let active = true;
    setCountsError("");
    getQuickActionCounts().then(value => { if (active) setCounts(value); })
      .catch(error => { if (active) setCountsError(error instanceof Error ? error.message : "入口状态加载失败"); });
    return () => { active = false; mounted.current = false; };
  }, [countsRetry, refreshKey]);

  const loadPreview = useCallback((kind: QuickActionKind) => {
    const hit = cache.current[kind];
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setPreviews(previous => ({ ...previous, [kind]: { items: hit.items, loading: false, error: "" } }));
      return;
    }
    if (inFlight.current.has(kind)) return;
    inFlight.current.add(kind);
    setPreviews(previous => ({ ...previous, [kind]: { items: previous[kind]?.items || [], loading: true, error: "" } }));
    getQuickPreview(kind).then(({ items }) => {
      if (!mounted.current) return;
      cache.current[kind] = { items, at: Date.now() };
      setPreviews(previous => ({ ...previous, [kind]: { items, loading: false, error: "" } }));
    }).catch(error => {
      if (mounted.current) setPreviews(previous => ({ ...previous, [kind]: { items: previous[kind]?.items || [], loading: false, error: error instanceof Error ? error.message : "预览加载失败" } }));
    }).finally(() => inFlight.current.delete(kind));
  }, []);

  const recent = (kind: QuickActionKind) => {
    const preview = previews[kind];
    return <div className="quick-preview" role="status">
      <strong>最近 3 条</strong>
      {preview?.loading || !preview ? <Typography.Text type="secondary">正在加载…</Typography.Text> : preview.error ? <><Typography.Text type="danger">{preview.error}</Typography.Text><Button size="small" onClick={() => loadPreview(kind)}>重试</Button></> : preview.items.length ? preview.items.map(item => <div className="quick-preview-item" key={item.id}>{item.title}</div>) : <Typography.Text type="secondary">{kind === "tasks" ? "暂无任务，点击创建第一条" : kind === "sessions" ? "暂无会话" : "暂无笔记"}</Typography.Text>}
    </div>;
  };
  const unavailable = (kind: "sessions" | "notes") => countsError || (counts === null ? "正在加载记录" : kind === "sessions" ? "暂无会话" : "暂无笔记");
  return <Card size="small" className="dashboard-quick-actions">
    <div className="quick-actions-inner"><div><strong>快速操作</strong><p>从这里继续今天的学习</p></div><Space wrap size={8}>
      <Popover trigger={["hover", "focus"]} onOpenChange={open => { if (open) loadPreview("tasks"); }} content={recent("tasks")}><Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/tasks?create=1")}>创建任务</Button></Popover>
      {counts?.sessions ? <Popover trigger={["hover", "focus"]} onOpenChange={open => { if (open) loadPreview("sessions"); }} content={recent("sessions")}><Button icon={<ReadOutlined />} onClick={() => navigate("/sessions")}>最新会话</Button></Popover> : <Tooltip title={unavailable("sessions")}><span className="quick-disabled-wrap"><Button icon={<ReadOutlined />} disabled>最新会话</Button></span></Tooltip>}
      {counts?.notes ? <Popover trigger={["hover", "focus"]} onOpenChange={open => { if (open) loadPreview("notes"); }} content={recent("notes")}><Button icon={<FileTextOutlined />} onClick={() => navigate("/notes")}>最近笔记</Button></Popover> : <Tooltip title={unavailable("notes")}><span className="quick-disabled-wrap"><Button icon={<FileTextOutlined />} disabled>最近笔记</Button></span></Tooltip>}
    </Space>{countsError && <Button size="small" type="link" onClick={() => setCountsRetry(n => n + 1)}>重试入口状态</Button>}</div>
  </Card>;
}
