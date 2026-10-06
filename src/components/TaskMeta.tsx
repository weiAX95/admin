import { Tag } from "antd";
import type { TaskPriority, TaskStatus } from "../types";

export const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: "待开始", color: "default" },
  in_progress: { label: "进行中", color: "processing" },
  done: { label: "已完成", color: "success" },
  blocked: { label: "受阻", color: "error" },
};

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; color: string }
> = {
  low: { label: "低", color: "default" },
  medium: { label: "中", color: "warning" },
  high: { label: "高", color: "magenta" },
};

export const STATUS_OPTIONS = (
  Object.keys(STATUS_META) as TaskStatus[]
).map((value) => ({ value, label: STATUS_META[value].label }));

export const PHASE_OPTIONS = ["基础", "进阶", "实战", "工程化"].map((v) => ({
  value: v,
  label: v,
}));

export const PRIORITY_OPTIONS = (
  Object.keys(PRIORITY_META) as TaskPriority[]
).map((value) => ({ value, label: PRIORITY_META[value].label }));

export const PRESET_TASK_TAGS = ["必学", "可选", "紧急", "长期", "复习", "已归档"];

export function StatusTag({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.todo;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

export function PriorityTag({ priority }: { priority: TaskPriority }) {
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.medium;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}
