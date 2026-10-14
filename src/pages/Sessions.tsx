import { isAdministrator } from '../utils/roles';
import { useSettings } from "../components/SettingsProvider";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Card, Empty, Grid, Input, Modal, Select, Space, Spin, Switch, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { annotateSessionMessage, configureSessionClusters, exportSelectedSessions, getSession, listSessionClusters, listSessions, renameSessionCluster, searchSessionMessages } from "../api/sessions";
import type { SessionCluster, SessionSearchHit } from "../api/sessions";
import { getStoredUser } from "../api/client";
import { createNote } from "../api/notes";
import { Link, useSearchParams } from "react-router-dom";
import { listTasks } from "../api/tasks";
import SessionMessageBubble from "../components/SessionMessageBubble";
import SessionTokenStats from "../components/SessionTokenStats";
import SessionCostStats from "../components/SessionCostStats";
import type { SessionCostRow } from "../api/sessions";
import SessionLearningPath from "../components/SessionLearningPath";
import RelatedSessions from "../components/RelatedSessions";
import { NoteFormDrawer } from "./Notes";
import type { AuthUser, LearningTask, MessageAnnotationTag, NotePayload, SessionDetail, SessionMessage, SessionSummary } from "../types";

export default function Sessions() {
  const { pageSize } = useSettings();
  const screens = Grid.useBreakpoint();
  const narrowScreen = screens.md === false;
  const [searchParams] = useSearchParams();
  const requestedSessionId = searchParams.get("sessionId");
  const { message } = App.useApp();
  const [items, setItems] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [details, setDetails] = useState<Record<string, SessionDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<LearningTask[]>([]);
  const [linkMsg, setLinkMsg] = useState<SessionMessage | null>(null);
  const [linkSessionId, setLinkSessionId] = useState<string | null>(null);
  const [linkTaskId, setLinkTaskId] = useState<string | undefined>();
  const [quickDraft, setQuickDraft] = useState<Partial<NotePayload> | null>(null);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchItems, setSearchItems] = useState<SessionSearchHit[]>([]);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exporting, setExporting] = useState<"json" | "markdown" | null>(null);
  const [costsBySession, setCostsBySession] = useState<Record<string, SessionCostRow>>({});
  const [qualityFilter, setQualityFilter] = useState<"rejection" | "excessive_length" | "">("");
  const [clusterFilter, setClusterFilter] = useState("");
  const [clusters, setClusters] = useState<SessionCluster[]>([]);
  const [clusterK, setClusterK] = useState<number | "auto">("auto");
  const [clusterSettingsOpen, setClusterSettingsOpen] = useState(false);
  const [clusterSaving, setClusterSaving] = useState(false);
  const [editingCluster, setEditingCluster] = useState<SessionCluster | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const isAdmin = isAdministrator(getStoredUser<AuthUser>());
  const acceptSessionCosts = useCallback((rows: SessionCostRow[]) => setCostsBySession(Object.fromEntries(rows.map(row => [row.id, row]))), []);
  const searchRequest = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems((await listSessions({ quality: qualityFilter || undefined, clusterId: clusterFilter || undefined })).items); }
    catch (error) { message.error(error instanceof Error ? error.message : "加载会话失败"); }
    finally { setLoading(false); }
  }, [message, qualityFilter, clusterFilter]);

  const loadClusters = useCallback(async () => {
    try {
      const result = await listSessionClusters();
      setClusters(result.items);
      setClusterK(result.requestedK);
    } catch (error) { message.error(error instanceof Error ? error.message : "加载主题聚类失败"); }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => { void loadClusters(); }, [loadClusters]);
  useEffect(() => {
    void listTasks({}).then(result => setTasks(result.items)).catch(() => setTasks([]));
  }, []);
  useEffect(() => {
    const term = query.trim();
    const requestId = ++searchRequest.current;
    if (!term) {
      setSearchItems([]);
      setSearchHasMore(false);
      setSearchError("");
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void searchSessionMessages(term, regex, searchPage).then(result => {
        if (searchRequest.current !== requestId) return;
        setSearchItems(result.items);
        setSearchHasMore(result.hasMore);
        setSearchError("");
      }).catch(error => {
        if (searchRequest.current !== requestId) return;
        setSearchItems([]);
        setSearchHasMore(false);
        setSearchError(error instanceof Error ? error.message : "搜索失败");
      }).finally(() => { if (searchRequest.current === requestId) setSearchLoading(false); });
    }, 300);
    return () => { window.clearTimeout(timer); if (searchRequest.current === requestId) searchRequest.current++; };
  }, [query, regex, searchPage]);
  useEffect(() => {
    if (requestedSessionId && items.some(item => item.id === requestedSessionId)) {
      setPage(Math.floor(items.findIndex(item => item.id === requestedSessionId) / pageSize) + 1);
      setExpandedId(requestedSessionId);
      if (!details[requestedSessionId]) void loadDetail(requestedSessionId);
    }
  }, [requestedSessionId, items, pageSize]);

  const loadDetail = async (id: string) => {
    setDetailLoading(id);
    setDetailErrors(previous => ({ ...previous, [id]: "" }));
    try {
      const detail = await getSession(id);
      setDetails(previous => ({ ...previous, [id]: detail }));
    } catch (error) { setDetailErrors(previous => ({ ...previous, [id]: error instanceof Error ? error.message : "会话加载失败" })); }
    finally { setDetailLoading(current => current === id ? null : current); }
  };
  const toggle = (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!details[id]) void loadDetail(id);
  };
  const openSearchHit = (sessionId: string) => {
    const index = items.findIndex(item => item.id === sessionId);
    if (index >= 0) setPage(Math.floor(index / pageSize) + 1);
    setExpandedId(sessionId);
    if (!details[sessionId]) void loadDetail(sessionId);
    document.getElementById("session-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const downloadSelected = async (format: "json" | "markdown") => {
    setExporting(format);
    try {
      const { blob, filename } = await exportSelectedSessions(selectedIds, format);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      message.success(`已导出 ${selectedIds.length} 条会话`);
    } catch (error) { message.error(error instanceof Error ? error.message : "导出失败"); }
    finally { setExporting(null); }
  };

  const sinkNote = async (session: SessionDetail, entry: SessionMessage, taskId: string | null) => {
    try {
      await createNote({ title: entry.content.slice(0, 30) || "会话沉淀", content: entry.content, taskId, sourceSessionId: session.id });
      message.success(taskId ? "已关联到学习任务并沉淀为笔记" : "已沉淀为学习笔记");
      setLinkMsg(null);
      setLinkSessionId(null);
      setLinkTaskId(undefined);
    } catch (error) { message.error(error instanceof Error ? error.message : "沉淀失败"); }
  };

  const columns: ColumnsType<SessionSummary> = [
    { title: "会话主题", dataIndex: "title", key: "title", render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
    { title: "用户", dataIndex: "userId", key: "userId", width: 140 },
    { title: "消息数", dataIndex: "messageCount", key: "messageCount", width: 90, render: (value: number) => <Tag>{value}</Tag> },
    { title: "主题聚类", key: "cluster", width: 150, render: (_, row) => row.clusterLabel ? <Tag color="blue">{row.clusterLabel}</Tag> : <Typography.Text type="secondary">未归类</Typography.Text> },
    { title: "质量标记", key: "quality", width: 120, render: (_, row) => row.qualityFlags.length ? <Tooltip title={row.qualityFlags.map(flag => flag === "rejection" ? "检测到拒答" : "输出超过 2000 token").join("；")}><Tag color="warning">⚠️ {row.qualityFlags.length}</Tag></Tooltip> : <Typography.Text type="secondary">—</Typography.Text> },
    { title: 'Token 用量', dataIndex: 'totalTokens', key: 'totalTokens', width: 120, render: (value: number | null) => value === null ? <Typography.Text type="secondary">未上报</Typography.Text> : value.toLocaleString() },
    { title: '估算成本 USD', key: 'costUsd', width: 140, render: (_, row) => { const cost = costsBySession[row.id]; if (!cost) return '—'; if (cost.unpricedMessages) return <Tooltip title={`${cost.unpricedMessages} 条消息未定价，当前已知部分 $${cost.knownCostUsd?.toFixed(6) ?? '0'}`}><Typography.Text type="warning">{cost.pricedMessages ? '部分未定价' : '未定价'}</Typography.Text></Tooltip>; return cost.costUsd === null ? <Typography.Text type="secondary">无用量</Typography.Text> : `$${cost.costUsd.toFixed(6)}`; } },
    { title: "更新时间", dataIndex: "updatedAt", key: "updatedAt", width: 180, render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false }) },
    { title: "操作", key: "actions", width: 100, render: (_, row) => <Button type="link" size="small" onClick={event => { event.stopPropagation(); toggle(row.id); }}>{expandedId === row.id ? "收起" : "查看"}</Button> },
  ];

  const expandedRow = (row: SessionSummary) => {
    const detail = details[row.id];
    if (detailLoading === row.id) return <div className="session-detail-state"><Spin /> 正在加载会话…</div>;
    if (detailErrors[row.id]) return <div className="session-detail-state"><Typography.Text type="danger">{detailErrors[row.id]}</Typography.Text><Button size="small" onClick={() => void loadDetail(row.id)}>重试</Button></div>;
    if (!detail) return <div className="session-detail-state"><Spin /></div>;
    if (!detail.messages.length) return <><Empty description="暂无消息" /><RelatedSessions sessionId={detail.id} onOpen={openSearchHit} /></>;
    return <><div className="session-timeline">{detail.messages.map(entry => <SessionMessageBubble key={entry.id} entry={entry}
      onSinkNote={() => void sinkNote(detail, entry, null)} onLinkTask={() => { setLinkMsg(entry); setLinkSessionId(detail.id); }}
      onSaveSelection={text => setQuickDraft({ title: Array.from(text.replace(/\s+/g, " ").trim()).slice(0, 50).join("") || "会话摘录", content: text, sourceSessionId: detail.id, taskId: null })}
      onSave={async (rating: number, tags: MessageAnnotationTag[]) => {
        const annotation = await annotateSessionMessage(detail.id, entry.id, rating, tags);
        setDetails(previous => ({ ...previous, [detail.id]: { ...previous[detail.id], messages: previous[detail.id].messages.map(item => item.id === entry.id ? { ...item, annotation } : item) } }));
        return annotation;
      }} />)}</div><RelatedSessions sessionId={detail.id} onOpen={openSearchHit} /></>;
  };

  return <><Card className="collection-card" title={<span className="collection-title">会话列表<span className="collection-count">{items.length} 条</span></span>}>
    {selectedIds.length > 0 && <Space wrap style={{ marginBottom: 16 }} aria-live="polite">
      <Typography.Text>已选 {selectedIds.length} 条会话（最多导出 50 条）</Typography.Text>
      <Button loading={exporting === "json"} disabled={exporting !== null || selectedIds.length > 50} onClick={() => void downloadSelected("json")}>导出 JSON</Button>
      <Button loading={exporting === "markdown"} disabled={exporting !== null || selectedIds.length > 50} onClick={() => void downloadSelected("markdown")}>导出 Markdown</Button>
      <Button disabled={exporting !== null} onClick={() => setSelectedIds([])}>清空选择</Button>
    </Space>}
    <div className="session-search-controls">
      <Input.Search value={query} onChange={event => { setQuery(event.target.value); setSearchPage(1); }} allowClear placeholder="搜索所有会话消息" aria-label="搜索会话消息" />
      <Space size={8}><Switch checked={regex} onChange={value => { setRegex(value); setSearchPage(1); }} aria-label="正则表达式搜索" /><Typography.Text>正则表达式</Typography.Text></Space>
      <Select aria-label="按质量标记筛选会话" value={qualityFilter} style={{ minWidth: 170 }} onChange={value => { setQualityFilter(value); setPage(1); setSelectedIds([]); }} options={[{ value: "", label: "全部质量标记" }, { value: "rejection", label: "检测到拒答" }, { value: "excessive_length", label: "输出过长" }]} />
      <Select aria-label="按主题聚类筛选会话" value={clusterFilter} style={{ minWidth: 180 }} onChange={value => { setClusterFilter(value); setPage(1); setSelectedIds([]); }} options={[{ value: "", label: "全部主题" }, ...clusters.map(cluster => ({ value: cluster.id, label: `${cluster.label} (${cluster.memberCount})` }))]} />
      {isAdmin && <Button onClick={() => setClusterSettingsOpen(true)}>聚类设置</Button>}
    </div>
    {query.trim() && <div className="session-search-results" aria-live="polite">
      {searchError && <Alert type="warning" showIcon message={searchError} />}
      {searchLoading ? <div className="session-detail-state"><Spin /> 正在搜索…</div> : !searchError && (searchItems.length ? <>
        {searchItems.map(hit => <div className="session-search-hit" key={`${hit.sessionId}:${hit.messageId}`}>
          <Space size={10} wrap><Button type="link" size="small" onClick={() => openSearchHit(hit.sessionId)}>{hit.sessionTitle}</Button><Tag>{hit.role === "user" ? "User" : "Assistant"}</Tag><Typography.Text type="secondary">{hit.userId} · {new Date(hit.at).toLocaleString("zh-CN", { hour12: false })}</Typography.Text></Space>
          <div className="session-search-snippet">{hit.snippet.before}<mark>{hit.snippet.match}</mark>{hit.snippet.after}</div>
        </div>)}
        <Space style={{ marginTop: 12 }}><Button disabled={searchPage === 1} onClick={() => setSearchPage(value => value - 1)}>上一页</Button><Typography.Text type="secondary">第 {searchPage} 页</Typography.Text><Button disabled={!searchHasMore} onClick={() => setSearchPage(value => value + 1)}>下一页</Button></Space>
      </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配消息" />)}
    </div>}
    <div id="session-table"><Table rowKey="id" loading={loading} columns={narrowScreen ? columns.filter(column => column.key === "title") : columns} dataSource={items} scroll={narrowScreen ? undefined : { x: 1000 }} pagination={{ pageSize, showSizeChanger: false, current: page, onChange: setPage }}
      rowSelection={{ selectedRowKeys: selectedIds, preserveSelectedRowKeys: true, onChange: keys => setSelectedIds(keys.map(String)), getCheckboxProps: () => ({ disabled: exporting !== null }) }}
      onRow={row => ({ onClick: () => toggle(row.id), className: "session-clickable-row" })}
      expandable={{ expandedRowRender: expandedRow, expandedRowKeys: expandedId ? [expandedId] : [], showExpandColumn: false, onExpand: (_, row) => toggle(row.id) }} /></div>
    <Modal title="关联到学习任务" open={linkMsg !== null} onCancel={() => { setLinkMsg(null); setLinkSessionId(null); setLinkTaskId(undefined); }}
      onOk={() => { const detail = linkSessionId ? details[linkSessionId] : null; if (detail && linkMsg) void sinkNote(detail, linkMsg, linkTaskId || null); }} okText="确认关联" cancelText="取消">
      <Space direction="vertical" size={8} style={{ width: "100%" }}><Typography.Text type="secondary">将该条 Agent 回答沉淀为笔记；不选任务则创建独立笔记。</Typography.Text>
        <Select placeholder="选择学习任务（可选）" allowClear style={{ width: "100%" }} value={linkTaskId} onChange={setLinkTaskId} options={tasks.map(task => ({ value: task.id, label: task.title }))} />
      </Space>
    </Modal>
    <NoteFormDrawer open={quickDraft !== null} initial={null} tasks={tasks} prefill={quickDraft || undefined} suppressSuccess onClose={() => setQuickDraft(null)} onSaved={note => { setQuickDraft(null); message.success({ content: <>笔记已保存 · <Link to={`/notes/${note.id}`}>查看笔记</Link></> }); }} />
    <Modal title="主题聚类设置" open={clusterSettingsOpen} confirmLoading={clusterSaving} okText="保存并重新聚类" onCancel={() => setClusterSettingsOpen(false)} onOk={async () => {
      setClusterSaving(true);
      try { await configureSessionClusters(clusterK); setClusterSettingsOpen(false); setClusterFilter(""); await loadClusters(); await load(); message.success("主题聚类已更新"); }
      catch (error) { message.error(error instanceof Error ? error.message : "聚类失败"); }
      finally { setClusterSaving(false); }
    }}>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Typography.Text>聚类数量 K</Typography.Text>
        <Select value={clusterK} onChange={setClusterK} options={[{ value: "auto", label: "自动" }, ...Array.from({ length: 20 }, (_, index) => ({ value: index + 1, label: String(index + 1) }))]} />
        <Typography.Text type="secondary">按每段会话的首条用户问题分词，使用 TF-IDF 和 K-Means；重算会保留可匹配聚类的人工标签。</Typography.Text>
        {clusters.map(cluster => <Space key={cluster.id} wrap><Tag>{cluster.label}</Tag><Typography.Text type="secondary">{cluster.memberCount} 条</Typography.Text><Button size="small" onClick={() => { setEditingCluster(cluster); setLabelDraft(cluster.label); }}>修改标签</Button></Space>)}
        {!clusters.length && <Typography.Text type="secondary">暂无可归类会话</Typography.Text>}
      </Space>
    </Modal>
    <Modal title="修改聚类标签" open={editingCluster !== null} okText="保存" onCancel={() => setEditingCluster(null)} onOk={async () => {
      if (!editingCluster) return;
      try { await renameSessionCluster(editingCluster.id, labelDraft); setEditingCluster(null); await loadClusters(); await load(); message.success("标签已更新"); }
      catch (error) { message.error(error instanceof Error ? error.message : "修改失败"); }
    }}><Input value={labelDraft} maxLength={60} onChange={event => setLabelDraft(event.target.value)} aria-label="聚类标签" /></Modal>
  </Card><SessionTokenStats onOpen={openSearchHit} /><SessionCostStats onSessionCosts={acceptSessionCosts} /><SessionLearningPath userIds={[...new Set(items.map(item => item.userId))].sort()} onOpen={openSearchHit} /></>;
}
