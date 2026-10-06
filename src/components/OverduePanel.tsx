import { Alert, Card, Tag } from "antd";
import { ClockCircleOutlined, ExclamationCircleOutlined, RightOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { StatusTag } from "./TaskMeta";
import type { OverdueTask } from "../types";

const LEVELS = {
  warning: { label: "轻度逾期", range: "1–3 天" },
  moderate: { label: "中度逾期", range: "4–7 天" },
  severe: { label: "严重逾期", range: ">7 天" },
};

export default function OverduePanel({ tasks }: { tasks: OverdueTask[] }) {
  const sorted = [...tasks].sort((a, b) => b.overdueDays - a.overdueDays);
  const severeCount = tasks.filter(task => task.overdueDays > 7).length;
  return (
    <Card className="overdue-panel" title={<span className="overdue-panel-title"><ClockCircleOutlined />逾期预警</span>}
      extra={<span className="overdue-timezone">按上海日期计算</span>}>
      <div className="overdue-summary">
        <div><span>逾期总数</span><strong>{tasks.length}<small>个任务</small></strong></div>
        <div className="overdue-summary-severe"><span><ExclamationCircleOutlined /> 严重逾期</span><strong>{severeCount}<small>超过 7 天</small></strong></div>
        {tasks.length > 0 && <div className="overdue-legend" aria-label="逾期等级说明">
          {Object.entries(LEVELS).map(([key, level]) => <span key={key} className={`overdue-level-${key}`}><i />{level.range}</span>)}
        </div>}
      </div>
      {tasks.length === 0 ? <Alert type="success" showIcon message="无逾期任务" description="所有未完成任务均未超过到期日，继续保持当前节奏。" /> : <>
        <p className="overdue-hint">优先展示逾期较久的任务，点击任意一行查看任务详情。</p>
        <ul className="overdue-list" aria-label="逾期任务列表">
          {sorted.map(task => <li key={task.id}>
            <Link to={`/tasks/${encodeURIComponent(task.id)}`} className={`overdue-row overdue-level-${task.severity}`}>
              <span className="overdue-task-title">{task.title}</span>
              <span className="overdue-task-date">到期 {task.dueDate}</span>
              <Tag className="overdue-days">逾期 {task.overdueDays} 天</Tag>
              <span className="overdue-task-status"><StatusTag status={task.status} /></span>
              <RightOutlined className="overdue-row-arrow" />
            </Link>
          </li>)}
        </ul>
      </>}
    </Card>
  );
}
