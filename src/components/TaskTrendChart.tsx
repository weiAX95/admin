import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, Segmented } from "antd";
import { Chart, CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip } from "chart.js";
import type { TaskTrends } from "../types";
import { aggregateTaskTrends } from "../utils/taskTrends";
import type { TrendGranularity } from "../utils/taskTrends";

Chart.register(CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip);
const SERIES = [
  { label: "完成任务数", color: "#a491ff", axis: "count", dash: [] },
  { label: "创建任务数", color: "#79b8e8", axis: "count", dash: [5, 3] },
  { label: "累计平均进度", color: "#7dcca4", axis: "progress", dash: [2, 3] },
];
const EMPTY_TRENDS: TaskTrends = { items: [], progressHistoryStart: null };

export default function TaskTrendChart({ trends = EMPTY_TRENDS }: { trends?: TaskTrends }) {
  const [granularity, setGranularity] = useState<TrendGranularity>("day");
  const [visible, setVisible] = useState([true, true, true]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"line", (number | null)[], string> | null>(null);
  const buckets = useMemo(() => aggregateTaskTrends(trends.items, granularity), [trends.items, granularity]);
  const bucketsRef = useRef(buckets);
  bucketsRef.current = buckets;
  const hasData = trends.items.some(p => p.created > 0 || p.completed > 0 || p.avgProgress !== null);
  const chartDescription = `${granularity === "day" ? "按天" : granularity === "week" ? "按周" : "按月"}展示完成任务数、创建任务数和累计平均进度；数量使用左轴，进度使用右轴。`;

  useLayoutEffect(() => {
    if (!canvasRef.current || !hasData) return;
    const chart = new Chart<"line", (number | null)[], string>(canvasRef.current, {
      type: "line",
      data: {
        labels: buckets.map(p => granularity === "month" ? p.date.slice(0, 7) : p.date),
        datasets: SERIES.map((series, index) => ({
          label: series.label,
          data: buckets.map(p => index === 0 ? p.completed : index === 1 ? p.created : p.avgProgress),
          yAxisID: series.axis,
          borderColor: series.color,
          backgroundColor: series.color,
          borderDash: series.dash,
          borderWidth: 2,
          pointRadius: buckets.length > 60 ? 0 : 2,
          pointHoverRadius: 5,
          pointHitRadius: 12,
          hidden: !visible[index],
          spanGaps: false,
          tension: 0,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: "#20253a", titleColor: "#eef0ff", bodyColor: "#c5cbde", padding: 12,
            callbacks: {
              title: items => {
                const bucket = bucketsRef.current[items[0]?.dataIndex ?? 0];
                return bucket.date === bucket.end ? bucket.date : `${bucket.date} 至 ${bucket.end}`;
              },
              label: item => `${item.dataset.label}：${item.parsed.y}${item.dataset.yAxisID === "progress" ? "%" : " 个"}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: "#30364c" }, ticks: { color: "#949db6", maxTicksLimit: 6, maxRotation: 0, font: { size: 10 } } },
          count: { display: visible[0] || visible[1], position: "left", beginAtZero: true, suggestedMax: 1, title: { display: true, text: "任务数", color: "#949db6", font: { size: 10 } }, grid: { color: "#252b40" }, border: { display: false }, ticks: { color: "#949db6", precision: 0, maxTicksLimit: 5 } },
          progress: { display: visible[2], position: "right", min: 0, max: 100, title: { display: true, text: "进度", color: "#949db6", font: { size: 10 } }, grid: { drawOnChartArea: false }, border: { display: false }, ticks: { color: "#949db6", stepSize: 25, callback: value => `${value}%` } },
        },
      },
    });
    chartRef.current = chart;
    return () => { chart.destroy(); chartRef.current = null; };
  }, [hasData]);

  useLayoutEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels = buckets.map(p => granularity === "month" ? p.date.slice(0, 7) : p.date);
    chart.data.datasets.forEach((dataset, index) => {
      dataset.data = buckets.map(p => index === 0 ? p.completed : index === 1 ? p.created : p.avgProgress);
      dataset.hidden = !visible[index];
      dataset.pointRadius = buckets.length > 60 ? 0 : 2;
    });
    if (chart.options.scales?.count) chart.options.scales.count.display = visible[0] || visible[1];
    if (chart.options.scales?.progress) chart.options.scales.progress.display = visible[2];
    chart.update("none");
  }, [buckets, granularity, visible, hasData]);

  const historyIncomplete = trends.progressHistoryStart && trends.items.some(p => p.date < trends.progressHistoryStart! && p.avgProgress === null);
  return (
    <Card title="趋势折线图" className="task-trend-card" extra={
      <Segmented size="small" aria-label="趋势统计粒度" value={granularity}
        options={[{ label: "按天", value: "day" }, { label: "按周", value: "week" }, { label: "按月", value: "month" }]}
        onChange={value => setGranularity(value as TrendGranularity)} />
    }>
      {hasData ? <>
        <div className="trend-legend" role="group" aria-label="折线图图例">
          {SERIES.map((series, index) => <button key={series.label} type="button" aria-pressed={visible[index]}
            className={`trend-legend-button ${visible[index] ? "" : "is-hidden"}`}
            onClick={() => setVisible(previous => previous.map((value, i) => i === index ? !value : value))}>
            <span style={{ background: series.color }} />{series.label}
          </button>)}
        </div>
        <div className="trend-chart-container"><canvas ref={canvasRef} role="img" aria-label={chartDescription}>{chartDescription}</canvas></div>
        {!visible.some(Boolean) && <p className="trend-note" role="status">所有折线已隐藏，点击图例可重新显示。</p>}
        <p className="trend-note">{granularity === "day" ? "每日" : granularity === "week" ? "每周" : "每月"}创建 / 完成数量 · 平均进度取周期末全部现存任务的平均值</p>
        {historyIncomplete && <p className="trend-note">进度历史从 {trends.progressHistoryStart} 开始记录，此前缺失数据留空。</p>}
      </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该时段暂无趋势数据" />}
    </Card>
  );
}
