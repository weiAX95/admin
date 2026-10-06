import { useEffect, useState } from "react";
import { App, Button, Empty, Spin, Tag, Typography } from "antd";
import { rollbackTaskChange, taskChangeLogs } from "../api/tasks";
import type { Activity, LearningTask, TaskChangeLog } from "../types";

const FIELD_LABELS: Record<string, string> = {
  title: "标题", description: "描述", category: "分类", phase: "阶段",
  status: "用户设置状态", priority: "优先级", dueDate: "到期日期",
  plannedStartDate: "计划开始日期", dependencyIds: "前置任务",
  manualProgress: "手动进度", checklist: "检查清单", tags: "标签",
  notes: "学习笔记", resources: "学习资料", estimatedHours: "预估工时",
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "未设置";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

interface Props {
  task: LearningTask;
  onChanged: (task: LearningTask) => void;
  onReload: () => void;
}

export default function TaskHistoryPanel({ task, onChanged, onReload }: Props) {
  const { modal, message } = App.useApp();
  const [items, setItems] = useState<TaskChangeLog[]>([]);
  const [legacyItems, setLegacyItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    taskChangeLogs(task.id)
      .then(result => { if (alive) { setItems(result.items); setLegacyItems(result.legacyItems); } })
      .catch(error => { if (alive) message.error(error instanceof Error ? error.message : "加载历史记录失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [task.id, task.version, message]);

  const confirmRollback = (entry: TaskChangeLog) => {
    modal.confirm({
      title: `回滚${FIELD_LABELS[entry.fieldName] || entry.fieldName}？`,
      content: <div className="task-history-confirm">当前值：<pre>{displayValue(task[entry.fieldName as keyof LearningTask])}</pre>恢复为：<pre>{displayValue(entry.oldValue)}</pre></div>,
      okText: "确认回滚",
      cancelText: "取消",
      onOk: async () => {
        try {
          const updated = await rollbackTaskChange(task.id, entry.id, task.version);
          onChanged(updated);
          message.success("字段已恢复，回滚操作已写入历史");
        } catch (error) {
          message.error(error instanceof Error ? error.message : "回滚失败");
          onReload();
        }
      },
    });
  };

  if (loading) return <Spin className="task-detail-loading" />;

  return <div className="task-history-panel">
    <Typography.Title level={5}>字段变更</Typography.Title>
    {items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无字段变更" /> : items.map(entry => {
      const current = task[entry.fieldName as keyof LearningTask];
      const alreadyRestored = JSON.stringify(current) === JSON.stringify(entry.oldValue);
      return <div className="task-history-entry" key={entry.id}>
        <div className="task-history-entry-head">
          <div><strong>{FIELD_LABELS[entry.fieldName] || entry.fieldName}</strong> {entry.action === "rollback" && <Tag color="purple">回滚</Tag>}
            <Typography.Text type="secondary">{entry.changedByName || entry.changedBy} · {new Date(entry.changedAt).toLocaleString("zh-CN", { hour12: false })}</Typography.Text>
          </div>
          <Button size="small" disabled={alreadyRestored} onClick={() => confirmRollback(entry)}>{alreadyRestored ? "已是旧值" : "回滚"}</Button>
        </div>
        <div className="task-history-diff"><pre>{displayValue(entry.oldValue)}</pre><span aria-hidden="true">→</span><pre>{displayValue(entry.newValue)}</pre></div>
      </div>;
    })}
    <Typography.Title level={5} className="task-history-legacy-title">早期活动</Typography.Title>
    <Typography.Paragraph type="secondary">以下活动没有保存字段旧值，仅供查看，不能回滚。</Typography.Paragraph>
    {legacyItems.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无早期活动" /> : legacyItems.map(activity => <div className="task-history-legacy" key={activity.id}><span>{activity.detail || activity.type}</span><Typography.Text type="secondary">{new Date(activity.at).toLocaleString("zh-CN", { hour12: false })}</Typography.Text></div>)}
  </div>;
}
