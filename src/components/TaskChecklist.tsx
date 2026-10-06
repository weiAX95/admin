import { useState } from "react";
import { Alert, Button, Checkbox, Input, List, Space, Typography } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { getTask, saveChecklist } from "../api/tasks";
import { ApiError } from "../api/client";
import type { ChecklistItem, LearningTask } from "../types";

interface Props { task: LearningTask; onChanged: (task: LearningTask) => void; }

export default function TaskChecklist({ task, onChanged }: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const items = [...(task.checklist || [])].sort((a, b) => a.order - b.order);

  const commit = async (next: ChecklistItem[]) => {
    setBusy(true); setError("");
    try {
      onChanged(await saveChecklist(task.id, task.version, next));
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError("此任务已在其他页面修改。已重新加载最新内容，请确认后再操作。");
        onChanged(await getTask(task.id));
      } else setError(cause instanceof Error ? cause.message : "保存检查清单失败");
      return false;
    } finally { setBusy(false); }
  };
  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    if (await commit([...items, { id: crypto.randomUUID(), text, done: false, order: items.length }])) setDraft("");
  };
  const move = (index: number, direction: number) => {
    const next = [...items];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    void commit(next);
  };
  return <Space direction="vertical" size={12} style={{ width: "100%" }}>
    {error && <Alert type="warning" showIcon message={error} />}
    <Typography.Text type="secondary">{items.length ? `${items.filter(item => item.done).length}/${items.length} 项完成 · 进度自动计算` : `无检查项 · 使用手动进度 ${task.manualProgress}%`}</Typography.Text>
    <List dataSource={items} locale={{ emptyText: "暂无检查项" }} renderItem={(item, index) => <List.Item actions={[
      <Button key="up" type="text" aria-label={`上移 ${item.text}`} icon={<ArrowUpOutlined />} disabled={busy || index === 0} onClick={() => move(index, -1)} />,
      <Button key="down" type="text" aria-label={`下移 ${item.text}`} icon={<ArrowDownOutlined />} disabled={busy || index === items.length - 1} onClick={() => move(index, 1)} />,
      <Button key="remove" type="text" danger aria-label={`删除 ${item.text}`} icon={<DeleteOutlined />} disabled={busy} onClick={() => void commit(items.filter(other => other.id !== item.id))} />,
    ]}><Checkbox checked={item.done} disabled={busy} onChange={event => void commit(items.map(other => other.id === item.id ? { ...other, done: event.target.checked } : other))}>{item.text}</Checkbox></List.Item>} />
    <Space.Compact style={{ width: "100%" }}>
      <Input value={draft} maxLength={200} placeholder="添加检查项" disabled={busy} onChange={event => setDraft(event.target.value)} onPressEnter={() => void add()} />
      <Button icon={<PlusOutlined />} disabled={busy || !draft.trim()} onClick={() => void add()}>添加</Button>
    </Space.Compact>
  </Space>;
}
