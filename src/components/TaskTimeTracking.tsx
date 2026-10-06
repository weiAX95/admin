import { useEffect, useState } from "react";
import { App, Alert, Button, Card, DatePicker, Drawer, Empty, Form, Input, InputNumber, Popconfirm, Select, Space, Spin, Statistic, Typography } from "antd";
import dayjs from "dayjs";
import { createTimeEntry, deleteTimeEntry, listTimeEntries, updateTimeEntry } from "../api/tasks";
import { getStoredUser } from "../api/client";
import type { AuthUser, LearningTask, TimeEntry, TimeEntryInput } from "../types";

interface FormValues {
  mode: "duration" | "interval";
  workDate?: dayjs.Dayjs;
  hours?: number;
  startedAt?: dayjs.Dayjs;
  endedAt?: dayjs.Dayjs;
  note?: string;
}

function elapsed(start: string, end: string) {
  const minutes = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const rest = minutes % 60;
  return `${days ? `${days} 天 ` : ""}${hours} 小时 ${rest} 分钟`;
}

const dateTime = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });

export default function TaskTimeTracking({ task }: { task: LearningTask }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const mode = Form.useWatch("mode", form);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [actualMinutes, setActualMinutes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const current = getStoredUser<AuthUser>();
  const completionCycles = Array.isArray(task.completionCycles) ? task.completionCycles : [];
  const completedAt = task.completedAt || completionCycles.at(-1)?.completedAt || null;
  const legacyCompletionUnknown = task.legacyCompletionUnknown ?? (task.status === "done" && !completedAt);
  const estimatedHours = typeof task.estimatedHours === "number" ? task.estimatedHours : null;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listTimeEntries(task.id)
      .then(result => { if (alive) { setEntries(result.items); setActualMinutes(result.actualMinutes); } })
      .catch(cause => { if (alive) message.error(cause instanceof Error ? cause.message : "加载工时记录失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [task.id, reload, message]);

  const openForm = (entry: TimeEntry | null) => {
    setEditing(entry);
    form.resetFields();
    form.setFieldsValue(entry ? {
      mode: entry.mode, workDate: dayjs(entry.workDate), hours: entry.durationMinutes / 60,
      startedAt: entry.startedAt ? dayjs(entry.startedAt) : undefined,
      endedAt: entry.endedAt ? dayjs(entry.endedAt) : undefined, note: entry.note,
    } : { mode: "duration", workDate: dayjs(), note: "" });
    setOpen(true);
  };

  const save = async (values: FormValues) => {
    let input: TimeEntryInput;
    if (values.mode === "interval") {
      if (!values.startedAt || !values.endedAt || !values.endedAt.isAfter(values.startedAt)) { message.error("结束时间必须晚于开始时间"); return; }
      input = { mode: "interval", startedAt: values.startedAt.toISOString(), endedAt: values.endedAt.toISOString(), note: values.note || "" };
    } else {
      if (!values.workDate || !values.hours || values.hours <= 0) { message.error("请填写工作日期和正数时长"); return; }
      input = { mode: "duration", workDate: values.workDate.format("YYYY-MM-DD"), hours: values.hours, note: values.note || "" };
    }
    setSaving(true);
    try {
      if (editing) await updateTimeEntry(task.id, editing.id, input);
      else await createTimeEntry(task.id, input);
      message.success(editing ? "工时记录已更新" : "工时记录已添加");
      setOpen(false);
      setReload(value => value + 1);
    } catch (cause) { message.error(cause instanceof Error ? cause.message : "保存工时失败"); }
    finally { setSaving(false); }
  };

  const remove = async (entry: TimeEntry) => {
    try { await deleteTimeEntry(task.id, entry.id); message.success("工时记录已删除"); setReload(value => value + 1); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : "删除失败"); }
  };

  return <Card title="工作量估算与追踪" extra={<Button type="primary" onClick={() => openForm(null)}>记录工时</Button>}>
    <div className="task-time-summary">
      <Statistic title="预估工时" value={estimatedHours === null ? "未设置" : `${estimatedHours} 小时`} />
      <Statistic title="实际投入" value={`${Math.round(actualMinutes / 60 * 100) / 100} 小时`} />
      <Statistic title={task.status === "done" ? "任务总历时" : "任务总历时（截至上次完成）"} value={completedAt ? elapsed(task.createdAt, completedAt) : legacyCompletionUnknown ? "历史完成时间未知" : "暂无完成记录"} />
    </div>
    <Typography.Title level={5}>完成周期</Typography.Title>
    {legacyCompletionUnknown && <Alert type="info" showIcon message="旧任务的历史完成时间未知，以下仅展示迁移后记录的周期。" className="task-time-legacy" />}
    {completionCycles.length === 0 ? <Typography.Text type="secondary">暂无可计算的完成周期</Typography.Text> : <div className="task-time-cycles">{completionCycles.map((cycle, index) => <div key={`${cycle.completedAt}-${index}`}>第 {index + 1} 次：{dateTime(cycle.startedAt)} → {dateTime(cycle.completedAt)} · {elapsed(cycle.startedAt, cycle.completedAt)}</div>)}</div>}
    {task.status !== "done" && task.activeCycleStartedAt && <Typography.Paragraph type="secondary">当前周期进行中：自 {dateTime(task.activeCycleStartedAt)} 开始；任务历时不会计入实际投入。</Typography.Paragraph>}
    <Typography.Title level={5} className="task-time-records-title">实际工时记录</Typography.Title>
    {loading ? <Spin className="task-detail-loading" /> : entries.length === 0 ? <Empty description="暂无工时记录" /> : <div className="task-time-entries">{entries.map(entry => {
      const editable = current?.role === "admin" || current?.id === entry.recordedBy;
      return <div className="task-time-entry" key={entry.id}>
        <div><strong>{Math.round(entry.durationMinutes / 60 * 100) / 100} 小时</strong><Typography.Text type="secondary">{entry.mode === "interval" && entry.startedAt && entry.endedAt ? `${dateTime(entry.startedAt)} — ${dateTime(entry.endedAt)}` : entry.workDate} · {entry.recordedByName}</Typography.Text>{entry.note && <p>{entry.note}</p>}</div>
        {editable && <Space><Button size="small" onClick={() => openForm(entry)}>编辑</Button><Popconfirm title="删除这条工时记录？" onConfirm={() => void remove(entry)}><Button size="small" danger>删除</Button></Popconfirm></Space>}
      </div>;
    })}</div>}
    <Drawer title={editing ? "编辑工时记录" : "记录实际工时"} width={480} open={open} onClose={() => setOpen(false)} extra={<Button type="primary" loading={saving} onClick={() => form.submit()}>保存</Button>}>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="mode" label="记录方式"><Select options={[{ value: "duration", label: "实际时长" }, { value: "interval", label: "开始与结束" }]} /></Form.Item>
        {mode === "interval" ? <>
          <Form.Item name="startedAt" label="开始时间" rules={[{ required: true, message: "请选择开始时间" }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="endedAt" label="结束时间" rules={[{ required: true, message: "请选择结束时间" }]}><DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} /></Form.Item>
          <Typography.Paragraph type="secondary">暂停或等待期间请拆成不同工作段；重叠记录仍会分别计入。</Typography.Paragraph>
        </> : <>
          <Form.Item name="workDate" label="工作日期" rules={[{ required: true, message: "请选择工作日期" }]}><DatePicker style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="hours" label="实际时长（小时）" rules={[{ required: true, message: "请输入实际时长" }]}><InputNumber min={0.01} step={0.25} style={{ width: "100%" }} /></Form.Item>
        </>}
        <Form.Item name="note" label="备注"><Input.TextArea rows={3} maxLength={500} /></Form.Item>
      </Form>
    </Drawer>
  </Card>;
}
