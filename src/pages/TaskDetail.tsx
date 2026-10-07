import { useEffect, useState } from "react";
import { Alert, App, Button, Card, Descriptions, Empty, Input, Modal, Popconfirm, Progress, Space, Spin, Tabs, Typography } from "antd";
import { ArrowLeftOutlined, EditOutlined, HistoryOutlined, LinkOutlined } from "@ant-design/icons";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getRecurringSeries, getTask, saveTaskTemplate, stopRecurringSeries } from "../api/tasks";
import { ApiError } from "../api/client";
import { PriorityTag, StatusTag } from "../components/TaskMeta";
import TaskFormDrawer from "../components/TaskFormDrawer";
import TaskHistoryPanel from "../components/TaskHistoryPanel";
import TaskChecklist from "../components/TaskChecklist";
import TaskTagEditor from "../components/TaskTagEditor";
import TaskRelations from "../components/TaskRelations";
import TaskTimeTracking from "../components/TaskTimeTracking";
import MarkdownContent from "../components/MarkdownContent";
import type { LearningTask, RecurringSeries } from "../types";

function safeResourceUrl(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [task, setTask] = useState<LearningTask | null>(null);
  const [series, setSeries] = useState<RecurringSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const { message } = App.useApp();
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(""); setTask(null);
    getTask(encodeURIComponent(id || ""))
      .then(value => { if (alive) setTask(value); })
      .catch(err => { if (alive) setError(err instanceof ApiError && err.status === 404 ? "该任务不存在或已被删除。" : err instanceof Error ? err.message : "加载任务失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, reload]);
  useEffect(() => {
    let alive = true;
    setSeries(null);
    if (task?.recurringSeriesId) void getRecurringSeries(task.recurringSeriesId).then(value => { if (alive) setSeries(value); }).catch(() => {});
    return () => { alive = false; };
  }, [task?.recurringSeriesId, reload]);
  return (
    <Space direction="vertical" size={16} className="task-detail-page">
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/tasks")}>返回任务列表</Button>
      {loading ? <Spin className="task-detail-loading" size="large" /> : error ? <Alert type="error" showIcon message="无法查看任务" description={error}
        action={<Button size="small" onClick={() => setReload(value => value + 1)}>重试</Button>} /> : task && <>
        <Tabs activeKey={searchParams.get("tab") === "history" ? "history" : "detail"} onChange={tab => setSearchParams(tab === "history" ? { tab: "history" } : {}, { replace: true })} items={[
          { key: "detail", label: "任务详情", children: <>
        <Card title="任务详情" extra={<Space wrap><Button onClick={() => { setTemplateName(task.title); setTemplateOpen(true); }}>保存为模板</Button><Button icon={<HistoryOutlined />} onClick={() => setSearchParams({ tab: "history" }, { replace: true })}>变更历史</Button><Button type="primary" icon={<EditOutlined />} onClick={() => setEditing(true)}>编辑任务</Button></Space>}>
          <Typography.Title className="task-detail-title" level={3}>{task.recurringSeriesId ? "🔄 " : ""}{task.title}</Typography.Title>
          {task.recurringSeriesId && <Space style={{ marginBottom: 12 }}><Typography.Text>第 {task.recurrenceIndex || 1} 次重复{series?.finished ? series.active ? " · 已达截止条件" : " · 已停止后续生成" : ""}</Typography.Text>{series && !series.finished && <Popconfirm title="停止后续重复？" description="已生成的任务会保留。" onConfirm={async () => { try { setSeries(await stopRecurringSeries(series.id)); message.success("已停止后续重复"); } catch (cause) { message.error(cause instanceof Error ? cause.message : "停止失败"); } }}><Button size="small">停止重复</Button></Popconfirm>}</Space>}
          <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="middle" items={[
            { key: "status", label: "当前状态", children: <Space><StatusTag status={task.effectiveStatus} />{task.blockedBy.length > 0 && <><Typography.Text type="secondary">用户设置：</Typography.Text><StatusTag status={task.status} /></>}</Space> },
            { key: "priority", label: "优先级", children: <PriorityTag priority={task.priority} /> },
            { key: "dueDate", label: "到期日", children: task.dueDate ? task.recurringSeriesId ? new Date(task.dueDate).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : new Date(task.dueDate).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) : "未设置" },
            { key: "plannedStartDate", label: "计划开始", children: task.plannedStartDate || <Typography.Text type="warning">待补计划（暂按创建日展示）</Typography.Text> },
            { key: "category", label: "分类", children: task.category || "未分类" },
            { key: "phase", label: "学习阶段", children: task.phase || "未设置" },
            { key: "progress", label: "学习进度", children: <Progress percent={task.progress} size="small" style={{ width: 160 }} /> },
          ]} />
          {task.blockedBy.length > 0 && <Alert type="warning" showIcon message="前置任务尚未完成" description={<Space wrap>{task.blockedBy.map(item => <Link key={item.id} to={`/tasks/${item.id}`}>{item.title}</Link>)}</Space>} style={{ marginTop: 16 }} />}
          <div className="task-detail-section"><h4>任务描述</h4><MarkdownContent content={task.description || "暂无任务描述"} /></div>
          <div className="task-detail-section"><h4>学习笔记</h4><MarkdownContent content={task.notes || "暂无学习笔记"} /></div>
        </Card>
        <Card title="检查清单"><TaskChecklist task={task} onChanged={setTask} /></Card>
        <Card title="任务标签"><TaskTagEditor task={task} onChanged={setTask} /></Card>
        <TaskTimeTracking task={task} />
        <TaskRelations task={task} />
        <Card title="学习资料">
          {task.resources.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无学习资料" /> : <ul className="task-resource-list">{task.resources.map((resource, index) => {
            const href = safeResourceUrl(resource.url);
            return <li key={index}><LinkOutlined />{href ? <a href={href} target="_blank" rel="noopener noreferrer">{resource.label || resource.url}</a> : <span>{resource.label || "未命名资料"}（链接不可用）</span>}</li>;
          })}</ul>}
        </Card>
          </> },
          { key: "history", label: "历史记录", children: <TaskHistoryPanel task={task} onChanged={setTask} onReload={() => setReload(value => value + 1)} /> },
        ]} />
        <TaskFormDrawer open={editing} initial={task} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setReload(value => value + 1); }} />
        <Modal title="保存为自定义模板" open={templateOpen} confirmLoading={savingTemplate} okButtonProps={{ disabled: !templateName.trim() }} onCancel={() => setTemplateOpen(false)} onOk={async () => {
          setSavingTemplate(true);
          try { await saveTaskTemplate(task.id, templateName.trim()); message.success("模板已保存，可在创建任务时使用"); setTemplateOpen(false); }
          catch (cause) { message.error(cause instanceof Error ? cause.message : "保存模板失败"); }
          finally { setSavingTemplate(false); }
        }}><Input value={templateName} maxLength={80} aria-label="模板名称" placeholder="模板名称" onChange={event => setTemplateName(event.target.value)} /></Modal>
      </>}
    </Space>
  );
}
