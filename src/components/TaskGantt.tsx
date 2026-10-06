import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { App, Alert, Empty, Modal, Segmented, Space, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import { patchTask } from "../api/tasks";
import type { LearningTask } from "../types";

const DAY = 86_400_000;
const LABEL_WIDTH = 238;
const HEADER_HEIGHT = 48;
const ROW_HEIGHT = 58;
const key = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const day = (value: string) => Date.parse(`${key(value)}T00:00:00Z`) / DAY;
const date = (value: number) => new Date(value * DAY).toISOString().slice(0, 10);
const title = (value: number, mode: "day" | "week") => mode === "day" ? (date(value).endsWith("-01") ? date(value).slice(5).replace("-", "/") : date(value).slice(8)) : `${date(value).slice(5)} 周`;

interface Props { tasks: LearningTask[]; onRefresh: () => Promise<void> | void; }
interface Preview { id: string; start: number; end: number; }

export default function TaskGantt({ tasks, onRefresh }: Props) {
  const [mode, setMode] = useState<"day" | "week">("week");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const { message } = App.useApp();
  const rows = useMemo(() => tasks.map(task => {
    const start = day(task.plannedStartDate || task.createdAt);
    const due = day(task.dueDate || task.plannedStartDate || task.createdAt);
    return { task, start, end: Math.max(start, due), estimated: !task.plannedStartDate, earlyDue: due < start };
  }), [tasks]);
  const min = rows.length ? Math.min(...rows.map(row => row.start)) - 2 : 0;
  const max = rows.length ? Math.max(...rows.map(row => Math.max(row.end, row.start))) + 3 : 0;
  const cell = mode === "day" ? 30 : 12;
  const timelineWidth = (max - min + 1) * cell;
  const ticks = Array.from({ length: max - min + 1 }, (_, index) => min + index).filter(value => mode === "day" || value === min || new Date(value * DAY).getUTCDay() === 1);
  const position = new Map(rows.map((row, index) => [row.task.id, { index, start: row.start, end: row.end }]));

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, row: typeof rows[number], edge: "start" | "end") => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = event.clientX;
    const base = { id: row.task.id, start: row.start, end: row.end };
    const handle = event.currentTarget;
    const move = (next: PointerEvent) => {
      const delta = Math.round((next.clientX - origin) / cell);
      setPreview({ ...base, [edge]: base[edge] + delta });
    };
    const release = (next: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", release);
      handle.removeEventListener("pointercancel", cancel);
      setPreview(null);
      const delta = Math.round((next.clientX - origin) / cell);
      if (!delta) return;
      const changed = { ...base, [edge]: base[edge] + delta };
      const actualStart = edge === "start" ? changed.start : row.start;
      const actualEnd = edge === "end" ? changed.end : row.task.dueDate ? day(row.task.dueDate) : row.end;
      if (actualEnd < actualStart) { message.error("截止日期不能早于计划开始日期"); return; }
      const field = edge === "start" ? "plannedStartDate" : "dueDate";
      const value = date(changed[edge]);
      Modal.confirm({
        title: "确认调整计划日期？",
        content: `${row.task.title}：${field === "plannedStartDate" ? "计划开始" : "截止"}日期改为 ${value}`,
        okText: "保存", cancelText: "取消",
        onOk: async () => {
          try { await patchTask(row.task.id, { [field]: value }); await onRefresh(); setError(""); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "保存日期失败"); throw cause; }
        },
      });
    };
    const cancel = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", release); handle.removeEventListener("pointercancel", cancel); setPreview(null); };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", release);
    handle.addEventListener("pointercancel", cancel);
  };

  return <Space direction="vertical" size={12} style={{ width: "100%" }}>
    <Space wrap><Typography.Text type="secondary">时间粒度</Typography.Text><Segmented value={mode} onChange={value => setMode(value as "day" | "week")} options={[{ label: "按天", value: "day" }, { label: "按周", value: "week" }]} /><Typography.Text type="secondary">拖动横条两端调整日期，松开后确认保存</Typography.Text></Space>
    {error && <Alert type="error" showIcon message={error} />}
    {!rows.length ? <Empty description="暂无任务" /> : <div className="gantt-scroll" role="region" aria-label="任务甘特图，可横向滚动" tabIndex={0}>
      <div className="gantt-inner" style={{ width: LABEL_WIDTH + timelineWidth }}>
        <div className="gantt-header" style={{ height: HEADER_HEIGHT }}><div className="gantt-label gantt-header-label" style={{ width: LABEL_WIDTH }}>学习任务</div><div className="gantt-axis" style={{ width: timelineWidth }}>{ticks.map(value => <span key={value} className="gantt-tick" style={{ left: (value - min) * cell, width: mode === "day" ? cell : cell * 7 }}>{title(value, mode)}</span>)}</div></div>
        <div className="gantt-rows">{rows.map(row => {
          const shown = preview?.id === row.task.id ? preview : row;
          const left = (shown.start - min) * cell;
          const width = Math.max(cell, (shown.end - shown.start + 1) * cell);
          return <div className="gantt-row" key={row.task.id} style={{ height: ROW_HEIGHT }}>
            <div className="gantt-label" style={{ width: LABEL_WIDTH }}><Link to={`/tasks/${row.task.id}`}>{row.task.recurringSeriesId ? "🔄 " : ""}{row.task.title}</Link>{row.estimated && <Tag color="gold">{row.earlyDue ? "待补计划 · 截止早于创建日" : "待补计划"}</Tag>}</div>
            <div className="gantt-track" style={{ width: timelineWidth, backgroundSize: `${mode === "day" ? cell : cell * 7}px 100%` }}>
              <div className={`gantt-bar${shown.end < shown.start ? " invalid" : ""}`} style={{ left, width }} title={`${date(shown.start)} → ${date(shown.end)} · 进度 ${row.task.progress}%`}>
                <div className="gantt-bar-fill" style={{ width: `${row.task.progress}%` }} />
                <button className="gantt-handle start" aria-label={`调整 ${row.task.title} 的计划开始日期`} onPointerDown={event => startDrag(event, row, "start")} />
                <button className="gantt-handle end" aria-label={`调整 ${row.task.title} 的截止日期`} onPointerDown={event => startDrag(event, row, "end")} />
              </div>
            </div>
          </div>;
        })}</div>
        <svg className="gantt-arrows" width={timelineWidth} height={HEADER_HEIGHT + rows.length * ROW_HEIGHT} style={{ left: LABEL_WIDTH }} aria-hidden="true"><defs><marker id="gantt-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="none" stroke="#b19eff" strokeWidth="1.5" /></marker></defs>{rows.flatMap(row => (row.task.dependencyIds || []).map(id => {
          const source = position.get(id); const target = position.get(row.task.id);
          if (!source || !target) return null;
          const fromX = (source.end - min + 1) * cell;
          const toX = (target.start - min) * cell;
          const fromY = HEADER_HEIGHT + source.index * ROW_HEIGHT + ROW_HEIGHT / 2;
          const toY = HEADER_HEIGHT + target.index * ROW_HEIGHT + ROW_HEIGHT / 2;
          const middle = Math.max(fromX + 12, (fromX + toX) / 2);
          return <path key={`${id}-${row.task.id}`} d={`M${fromX} ${fromY} H${middle} V${toY} H${toX - 4}`} fill="none" stroke="#b19eff" strokeWidth="1.5" markerEnd="url(#gantt-arrow)" />;
        }))}</svg>
      </div>
    </div>}
  </Space>;
}
