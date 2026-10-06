import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, Select } from "antd";
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from "chart.js";
import { PHASE_OPTIONS, STATUS_META } from "./TaskMeta";
import { aggregateCategoryProgress, categorySegmentPercent } from "../utils/categoryProgress";
import type { CategoryStat, TaskStatus } from "../types";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);
const SERIES: { status: TaskStatus; color: string }[] = [
  { status: "done", color: "#7dcca4" },
  { status: "in_progress", color: "#a491ff" },
  { status: "todo", color: "#8296bd" },
  { status: "blocked", color: "#ec929f" },
];

export default function CategoryProgressChart({ categories }: { categories: CategoryStat[] }) {
  const [phase, setPhase] = useState("");
  const [hoverDetail, setHoverDetail] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"bar", number[], string> | null>(null);
  const grouped = useMemo(() => aggregateCategoryProgress(categories, phase), [categories, phase]);
  const groupedRef = useRef(grouped);
  groupedRef.current = grouped;
  const phases = useMemo(() => [...new Set([...PHASE_OPTIONS.map(option => option.value), ...categories.flatMap(category => category.tasks.map(task => task.phase)).filter(Boolean)])], [categories]);
  const total = grouped.reduce((sum, category) => sum + category.total, 0);
  const hasData = grouped.length > 0;
  const description = `${phase || "全部阶段"}分类进度堆叠柱状图，横轴为分类，纵轴为任务数，按已完成、进行中、待开始和受阻四种状态堆叠。`;

  useLayoutEffect(() => {
    if (!canvasRef.current || !hasData) return;
    const chart = new Chart<"bar", number[], string>(canvasRef.current, {
      type: "bar",
      data: {
        labels: grouped.map(category => category.category),
        datasets: SERIES.map(series => ({
          label: STATUS_META[series.status].label,
          data: grouped.map(category => category.counts[series.status]),
          backgroundColor: series.color,
          hoverBackgroundColor: series.color,
          borderWidth: 0,
          maxBarThickness: 56,
          categoryPercentage: .65,
          barPercentage: .8,
          stack: "tasks",
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", intersect: true },
        plugins: {
          tooltip: {
            backgroundColor: "#20253a", titleColor: "#eef0ff", bodyColor: "#c5cbde", padding: 12,
            callbacks: {
              label: item => {
                const category = groupedRef.current[item.dataIndex];
                const count = item.parsed.y ?? 0;
                return `${item.dataset.label}：${count} 个（${categorySegmentPercent(count, category.total)}%）`;
              },
              footer: items => `该分类共 ${groupedRef.current[items[0].dataIndex].total} 个任务`,
            },
            external: ({ tooltip }) => {
              const item = tooltip.dataPoints?.[0];
              if (!tooltip.opacity || !item) { setHoverDetail(""); return; }
              const category = groupedRef.current[item.dataIndex];
              const count = item.parsed.y ?? 0;
              setHoverDetail(`${category.category} · ${item.dataset.label}：${count} 个（${categorySegmentPercent(count, category.total)}%），该分类共 ${category.total} 个任务。`);
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { color: "#30364c" }, title: { display: true, text: "分类", color: "#949db6", font: { size: 11 } }, ticks: { color: "#b8c0d4", font: { size: 11 }, maxRotation: 0, autoSkip: false, callback: function(value) { const label = this.getLabelForValue(Number(value)); return label.length > 10 ? `${label.slice(0, 9)}…` : label; } } },
          y: { stacked: true, beginAtZero: true, suggestedMax: 1, border: { display: false }, grid: { color: "#252b40" }, title: { display: true, text: "任务数", color: "#949db6", font: { size: 11 } }, ticks: { color: "#949db6", precision: 0, maxTicksLimit: 6 } },
        },
      },
    });
    chartRef.current = chart;
    return () => { chart.destroy(); chartRef.current = null; };
  }, [hasData]);

  useLayoutEffect(() => {
    setHoverDetail("");
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels = grouped.map(category => category.category);
    chart.data.datasets.forEach((dataset, index) => {
      dataset.data = grouped.map(category => category.counts[SERIES[index].status]);
    });
    chart.update("none");
  }, [grouped, hasData]);

  return (
    <Card title="分类进度" className="category-progress-card" extra={
      <Select aria-label="分类进度阶段筛选" value={phase} style={{ width: 150 }}
        options={[{ label: "全部阶段", value: "" }, ...phases.map(value => ({ label: value, value }))]}
        onChange={setPhase} />
    }>
      <div className="category-progress-toolbar">
        <div className="category-progress-legend" aria-label="任务状态图例">{SERIES.map(series => <span key={series.status}><i style={{ background: series.color }} />{STATUS_META[series.status].label}</span>)}</div>
        <span className="category-progress-summary">{grouped.length} 个分类 · {total} 个任务</span>
      </div>
      {grouped.length ? <>
        <div className="category-chart-scroll"><div className="category-chart-container" style={{ minWidth: Math.max(300, grouped.length * 110) }}>
          <canvas ref={canvasRef} role="img" aria-label={description}>{description}</canvas>
        </div></div>
        <p className="category-hover-detail" role="status" aria-live="polite">{hoverDetail || "悬停柱内任一状态段，查看任务数量及其占该分类的百分比。"}</p>
        <details className="category-progress-data"><summary>查看分类数据</summary>
          <div className="category-data-scroll"><table><caption>{phase || "全部阶段"}分类任务数量及占比</caption><thead><tr><th scope="col">分类</th>{SERIES.map(series => <th key={series.status} scope="col">{STATUS_META[series.status].label}</th>)}<th scope="col">总数</th></tr></thead><tbody>{grouped.map(category => <tr key={category.category}><th scope="row">{category.category}</th>{SERIES.map(series => <td key={series.status}>{category.counts[series.status]} 个（{categorySegmentPercent(category.counts[series.status], category.total)}%）</td>)}<td>{category.total}</td></tr>)}</tbody></table></div>
        </details>
      </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该阶段暂无任务" />}
    </Card>
  );
}
