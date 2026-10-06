import { useEffect, useState } from "react";
import { App, Button, Dropdown, Progress, Tag, Typography } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { patchTask } from "../api/tasks";
import { PRIORITY_META, STATUS_META } from "./TaskMeta";
import type { LearningTask, TaskStatus } from "../types";

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "done", "blocked"];

export default function TaskKanban({ tasks, onRefresh }: { tasks: LearningTask[]; onRefresh: () => Promise<void> | void }) {
  const [cards, setCards] = useState(tasks);
  const [moving, setMoving] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const { message } = App.useApp();
  useEffect(() => setCards(tasks), [tasks]);

  const move = async (id: string, target: TaskStatus) => {
    const task = cards.find(item => item.id === id);
    if (!task || moving || task.effectiveStatus === target) return;
    if (task.blockedBy.length > 0 && target !== "blocked") {
      message.warning("请先完成前置任务，才能将卡片移出受阻列");
      return;
    }
    setMoving(id);
    setCards(current => current.map(item => item.id === id ? { ...item, status: target, effectiveStatus: target } : item));
    try {
      const saved = await patchTask(id, { status: target });
      setCards(current => current.map(item => item.id === id ? saved : item));
      if (saved.effectiveStatus !== target) message.warning("依赖状态已变化，卡片已放回实际状态列");
      await onRefresh();
    } catch (cause) {
      setCards(current => current.map(item => item.id === id ? task : item));
      message.error(cause instanceof Error ? `移动失败，卡片已回到原列：${cause.message}` : "移动失败，卡片已回到原列");
    } finally { setMoving(null); }
  };

  return <div className="task-kanban" role="region" aria-label="任务看板">
    {COLUMNS.map(status => {
      const columnCards = cards.filter(task => task.effectiveStatus === status);
      return <section key={status} className={`task-kanban-column${over === status ? " is-over" : ""}`} aria-label={`${STATUS_META[status].label}，${columnCards.length} 个任务`}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(status); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null); }}
        onDrop={event => { event.preventDefault(); setOver(null); void move(event.dataTransfer.getData("text/plain"), status); }}>
        <div className="task-kanban-heading"><strong>{STATUS_META[status].label}</strong><span>{columnCards.length}</span></div>
        <div className="task-kanban-list">{columnCards.length ? columnCards.map(task => {
          const checklist = task.checklist || [];
          return <div key={task.id} className={`task-kanban-card${moving === task.id ? " is-moving" : ""}`} draggable={moving === null}
            onDragStart={event => { event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setOver(null)}>
            <div className="task-kanban-card-head"><Link to={`/tasks/${task.id}`}>{task.recurringSeriesId ? "🔄 " : ""}{task.title}</Link><Dropdown trigger={["click"]} menu={{ items: COLUMNS.filter(next => next !== task.effectiveStatus).map(next => ({ key: next, label: `移到${STATUS_META[next].label}`, onClick: () => void move(task.id, next) })) }}><Button type="text" size="small" icon={<MoreOutlined />} aria-label={`移动 ${task.title}`} /></Dropdown></div>
            <div className="task-kanban-meta"><Tag color={PRIORITY_META[task.priority]?.color || "default"}>{PRIORITY_META[task.priority]?.label || "中"}优先级</Tag><Tag color="geekblue">{task.phase || "未设阶段"}</Tag></div>
            {task.tags?.length > 0 && <div className="task-kanban-tags">{task.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>}
            <Progress percent={task.progress} size="small" showInfo={false} strokeColor={task.progress === 100 ? "#7dcca4" : "#a491ff"} className="task-kanban-progress" />
            <div className="task-kanban-foot"><Typography.Text type="secondary">进度 {task.progress}%</Typography.Text><Typography.Text type="secondary">检查项 {checklist.filter(item => item.done).length}/{checklist.length}</Typography.Text></div>
            {task.blockedBy.length > 0 && <Typography.Text type="warning" className="task-kanban-blocked">等待 {task.blockedBy.length} 个前置任务</Typography.Text>}
          </div>;
        }) : <div className="task-kanban-empty">拖动任务到此列</div>}</div>
      </section>;
    })}
  </div>;
}
