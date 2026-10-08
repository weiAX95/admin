import { useSettings } from "../components/SettingsProvider";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Empty, Modal, Select, Space, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { annotateSessionMessage, getSession, listSessions } from "../api/sessions";
import { createNote } from "../api/notes";
import { Link, useSearchParams } from "react-router-dom";
import { listTasks } from "../api/tasks";
import SessionMessageBubble from "../components/SessionMessageBubble";
import { NoteFormDrawer } from "./Notes";
import type { LearningTask, MessageAnnotationTag, NotePayload, SessionDetail, SessionMessage, SessionSummary } from "../types";

export default function Sessions() {
  const { pageSize } = useSettings();
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

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems((await listSessions()).items); }
    catch (error) { message.error(error instanceof Error ? error.message : "加载会话失败"); }
    finally { setLoading(false); }
  }, [message]);

  useEffect(() => {
    void load();
    void listTasks({}).then(result => setTasks(result.items)).catch(() => setTasks([]));
  }, [load]);
  useEffect(() => {
    if (requestedSessionId && items.some(item => item.id === requestedSessionId)) {
      setPage(Math.floor(items.findIndex(item => item.id === requestedSessionId) / 8) + 1);
      setExpandedId(requestedSessionId);
      if (!details[requestedSessionId]) void loadDetail(requestedSessionId);
    }
  }, [requestedSessionId, items]);

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
    { title: "更新时间", dataIndex: "updatedAt", key: "updatedAt", width: 180, render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false }) },
    { title: "操作", key: "actions", width: 100, render: (_, row) => <Button type="link" size="small" onClick={event => { event.stopPropagation(); toggle(row.id); }}>{expandedId === row.id ? "收起" : "查看"}</Button> },
  ];

  const expandedRow = (row: SessionSummary) => {
    const detail = details[row.id];
    if (detailLoading === row.id) return <div className="session-detail-state"><Spin /> 正在加载会话…</div>;
    if (detailErrors[row.id]) return <div className="session-detail-state"><Typography.Text type="danger">{detailErrors[row.id]}</Typography.Text><Button size="small" onClick={() => void loadDetail(row.id)}>重试</Button></div>;
    if (!detail) return <div className="session-detail-state"><Spin /></div>;
    if (!detail.messages.length) return <Empty description="暂无消息" />;
    return <div className="session-timeline">{detail.messages.map(entry => <SessionMessageBubble key={entry.id} entry={entry}
      onSinkNote={() => void sinkNote(detail, entry, null)} onLinkTask={() => { setLinkMsg(entry); setLinkSessionId(detail.id); }}
      onSaveSelection={text => setQuickDraft({ title: Array.from(text.replace(/\s+/g, " ").trim()).slice(0, 50).join("") || "会话摘录", content: text, sourceSessionId: detail.id, taskId: null })}
      onSave={async (rating: number, tags: MessageAnnotationTag[]) => {
        const annotation = await annotateSessionMessage(detail.id, entry.id, rating, tags);
        setDetails(previous => ({ ...previous, [detail.id]: { ...previous[detail.id], messages: previous[detail.id].messages.map(item => item.id === entry.id ? { ...item, annotation } : item) } }));
        return annotation;
      }} />)}</div>;
  };

  return <Card className="collection-card" title={<span className="collection-title">会话列表<span className="collection-count">{items.length} 条</span></span>}>
    <Table rowKey="id" loading={loading} columns={columns} dataSource={items} scroll={{ x: 760 }} pagination={{ pageSize, showSizeChanger: false, current: page, onChange: setPage }}
      onRow={row => ({ onClick: () => toggle(row.id), className: "session-clickable-row" })}
      expandable={{ expandedRowRender: expandedRow, expandedRowKeys: expandedId ? [expandedId] : [], showExpandColumn: false, onExpand: (_, row) => toggle(row.id) }} />
    <Modal title="关联到学习任务" open={linkMsg !== null} onCancel={() => { setLinkMsg(null); setLinkSessionId(null); setLinkTaskId(undefined); }}
      onOk={() => { const detail = linkSessionId ? details[linkSessionId] : null; if (detail && linkMsg) void sinkNote(detail, linkMsg, linkTaskId || null); }} okText="确认关联" cancelText="取消">
      <Space direction="vertical" size={8} style={{ width: "100%" }}><Typography.Text type="secondary">将该条 Agent 回答沉淀为笔记；不选任务则创建独立笔记。</Typography.Text>
        <Select placeholder="选择学习任务（可选）" allowClear style={{ width: "100%" }} value={linkTaskId} onChange={setLinkTaskId} options={tasks.map(task => ({ value: task.id, label: task.title }))} />
      </Space>
    </Modal>
    <NoteFormDrawer open={quickDraft !== null} initial={null} tasks={tasks} prefill={quickDraft || undefined} suppressSuccess onClose={() => setQuickDraft(null)} onSaved={note => { setQuickDraft(null); message.success({ content: <>笔记已保存 · <Link to={`/notes/${note.id}`}>查看笔记</Link></> }); }} />
  </Card>;
}
