import { useState } from "react";
import { App, Select, Space, Typography } from "antd";
import { getTask, saveTaskTags } from "../api/tasks";
import { ApiError } from "../api/client";
import type { LearningTask } from "../types";
import { PRESET_TASK_TAGS } from "./TaskMeta";

export default function TaskTagEditor({ task, onChanged }: { task: LearningTask; onChanged: (task: LearningTask) => void }) {
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  const options = [...new Set([...PRESET_TASK_TAGS, ...(task.tags || [])])].map(tag => ({ value: tag, label: tag }));
  const change = async (values: string[]) => {
    setSaving(true);
    try { onChanged(await saveTaskTags(task.id, task.version, values)); }
    catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        message.warning("任务已在其他页面修改，已加载最新标签，请重试");
        try { onChanged(await getTask(task.id)); } catch { message.error("刷新任务失败"); }
      } else message.error(cause instanceof Error ? cause.message : "保存标签失败");
    } finally { setSaving(false); }
  };
  return <Space direction="vertical" size={8} style={{ width: "100%" }}>
    <Typography.Text type="secondary">选择预置标签，或输入自定义标签后按 Enter；变更会立即保存。</Typography.Text>
    <Select mode="tags" aria-label="任务标签" value={task.tags || []} options={options} disabled={saving} onChange={values => void change(values)} placeholder="添加标签" tokenSeparators={[","]} style={{ width: "100%" }} />
  </Space>;
}
