import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Row,
  Segmented,
  Space,
  Spin,
  Statistic,
  Typography,
} from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { getStats } from "../api/stats";
import RadarChart from "../components/RadarChart";
import TaskTrendChart from "../components/TaskTrendChart";
import OverduePanel from "../components/OverduePanel";
import ActivityTimeline from "../components/ActivityTimeline";
import ActivityHeatmap from "../components/ActivityHeatmap";
import DashboardQuickActions from "../components/DashboardQuickActions";
import CategoryProgressChart from "../components/CategoryProgressChart";
import { useDashboardAutoRefresh } from "../hooks/useDashboardAutoRefresh";
import type { RefreshSeconds } from "../hooks/useDashboardAutoRefresh";
import { STATUS_META } from "../components/TaskMeta";
import type { Stats, TaskStatus, TimeWindow } from "../types";

const { RangePicker } = DatePicker;
const STATUS_KEYS = Object.keys(STATUS_META) as TaskStatus[];

// ── 时间窗口预设 ─────────────────────────────────────────────────────

interface WindowOption {
  label: string;
  value: TimeWindow;
}

const WINDOW_OPTIONS: WindowOption[] = [
  { label: "今日", value: "today" },
  { label: "本周", value: "week" },
  { label: "本月", value: "month" },
  { label: "近 30 天", value: "30d" },
  { label: "近 90 天", value: "90d" },
  { label: "近一年", value: "365d" },
  { label: "自定义", value: "custom" },
];

/** 根据预设 + 自定义区间生成 API query */
function buildQuery(
  preset: TimeWindow,
  customRange: [Dayjs, Dayjs] | null,
): { start?: string; end?: string } | undefined {
  if (preset === "custom" && customRange) {
    return {
      start: customRange[0].startOf("day").format("YYYY-MM-DD"),
      end: customRange[1].endOf("day").format("YYYY-MM-DD"),
    };
  }

  switch (preset) {
    case "today":
      return {
        start: dayjs().startOf("day").format("YYYY-MM-DD"),
        end: dayjs().endOf("day").format("YYYY-MM-DD"),
      };
    case "week":
      return {
        start: dayjs().startOf("week").format("YYYY-MM-DD"),
        end: dayjs().endOf("day").format("YYYY-MM-DD"),
      };
    case "month":
      return {
        start: dayjs().startOf("month").format("YYYY-MM-DD"),
        end: dayjs().endOf("day").format("YYYY-MM-DD"),
      };
    case "30d":
      return {
        start: dayjs().endOf("day").subtract(29, "day").format("YYYY-MM-DD"),
        end: dayjs().endOf("day").format("YYYY-MM-DD"),
      };
    case "90d":
      return {
        start: dayjs().endOf("day").subtract(89, "day").format("YYYY-MM-DD"),
        end: dayjs().endOf("day").format("YYYY-MM-DD"),
      };
    case "365d":
      return {
        start: dayjs().endOf("day").subtract(364, "day").format("YYYY-MM-DD"),
        end: dayjs().endOf("day").format("YYYY-MM-DD"),
      };
    default:
      return undefined;
  }
}

// ── 页面 ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [windowPreset, setWindowPreset] = useState<TimeWindow>("365d");
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const latestRequest = useRef(0);
  const hasStats = useRef(false);

  const refresh = useCallback(async (silent = false) => {
    const request = ++latestRequest.current;
    if (silent && hasStats.current) setRefreshing(true);
    else setLoading(true);
    setError("");
    setRefreshError("");
    try {
      const data = await getStats(buildQuery(windowPreset, customRange));
      if (request !== latestRequest.current) return;
      hasStats.current = true;
      setStats(data);
      setRefreshKey(previous => previous + 1);
    } catch (err: unknown) {
      if (request !== latestRequest.current) return;
      const message = err instanceof Error ? err.message : String(err);
      if (silent && hasStats.current) setRefreshError(message);
      else setError(message);
    } finally {
      if (request === latestRequest.current) { setLoading(false); setRefreshing(false); }
    }
  }, [windowPreset, customRange]);

  useEffect(() => {
    void refresh();
    return () => { ++latestRequest.current; };
  }, [refresh]);
  const backgroundRefresh = useCallback(() => { void refresh(true); }, [refresh]);
  const { seconds, changeSeconds, transport } = useDashboardAutoRefresh(backgroundRefresh);

  // ── 派生值（所有 hooks 必须在守卫之前） ──────────────────────

  // ── 状态守卫 ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <Spin size="large" style={{ display: "block", margin: "80px auto" }} />
    );
  }
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载统计失败"
        description={error}
        action={
          <Button size="small" onClick={() => void refresh()}>
            重试
          </Button>
        }
      />
    );
  }
  if (!stats) return null;
  const variance = stats.workVariance ?? { percent: null, taskCount: 0, highlight: false };

  // ── 渲染 ─────────────────────────────────────────────────────────

  return (
    <Space direction="vertical" size={16} className="dashboard-page" style={{ width: "100%" }}>
      <DashboardQuickActions refreshKey={refreshKey} />

      {/* ─── 时间窗口工具栏 ─── */}
      <Card size="small" className="dashboard-filter">
        <Space wrap align="center" size={12}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            时间窗口：
          </Typography.Text>
          <Segmented
            value={windowPreset}
            options={WINDOW_OPTIONS}
            onChange={(val) => setWindowPreset(val as TimeWindow)}
          />
          {windowPreset === "custom" && (
            <RangePicker
              value={customRange}
              onChange={(dates) => {
                if (dates && dates[0] && dates[1]) {
                  setCustomRange([dates[0], dates[1]]);
                } else {
                  setCustomRange(null);
                }
              }}
              allowClear
              placeholder={["开始日期", "结束日期"]}
            />
          )}
        </Space>
        <div className="dashboard-refresh-controls">
          <Typography.Text type="secondary">自动刷新：</Typography.Text>
          <Segmented aria-label="自动刷新间隔" value={seconds} onChange={value => changeSeconds(value as RefreshSeconds)} options={[{ label: "关闭", value: 0 }, { label: "30s", value: 30 }, { label: "60s", value: 60 }, { label: "120s", value: 120 }]} />
          <span className="dashboard-refresh-indicator" role="status" aria-live="polite">
            {transport === "websocket" ? "● 实时推送中" : transport === "polling" ? `● 自动刷新中 · ${seconds}s` : transport === "paused" ? "已暂停 · 页面不可见" : transport === "connecting" ? "正在连接实时推送…" : "自动刷新已关闭"}
            {refreshing && <Spin size="small" />}
          </span>
        </div>
        {refreshError && <Alert type="warning" showIcon message={`自动刷新失败：${refreshError}`} action={<Button size="small" onClick={backgroundRefresh}>重试</Button>} />}
      </Card>

      {/* ─── 逾期预警 ─── */}
      <OverduePanel tasks={stats.overdue} />

      {/* ─── 指标卡片 ─── */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="metric-card">
            <Statistic title="学习任务总数" value={stats.total} />
            <span className="metric-caption">全部学习计划</span>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="metric-card metric-progress">
            <Statistic
              title="进行中"
              value={stats.byStatus.in_progress}
              valueStyle={{ color: "#b2a1ff" }}
            />
            <span className="metric-caption">正在推进的学习任务</span>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="metric-card metric-done">
            <Statistic
              title="已完成"
              value={stats.byStatus.done}
              valueStyle={{ color: "#7dcca4" }}
            />
            <span className="metric-caption">已达成的学习目标</span>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="metric-card metric-average">
            <Statistic
              title="平均进度"
              value={stats.avgProgress}
              suffix="%"
              valueStyle={{ color: "#79b8e8" }}
            />
            <span className="metric-caption">全部任务的平均完成进度</span>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className={`metric-card ${variance.highlight ? "metric-work-alert" : "metric-work"}`}>
            <Statistic title="工时偏差率" value={variance.percent === null ? "暂无数据" : variance.percent} suffix={variance.percent === null ? undefined : "%"} valueStyle={variance.highlight ? { color: "#ec929f" } : undefined} />
            <span className="metric-caption">参与计算 {variance.taskCount} 个任务 · 累计指标</span>
          </Card>
        </Col>
      </Row>

      {/* ─── 完成趋势 + 热力图 ─── */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <TaskTrendChart trends={stats.trends} />
        </Col>

        <Col xs={24} lg={12}>
          <ActivityHeatmap refreshKey={refreshKey} days={stats.heatmap} anchorDate={buildQuery(windowPreset, customRange)?.end || dayjs().format("YYYY-MM-DD")} />
        </Col>
      </Row>

      <CategoryProgressChart categories={stats.byCategory} />

      {/* ─── 雷达图 + 状态分布 + 最近动态 ─── */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title="能力维雷达图" className="dashboard-bottom-card">
            <RadarChart categories={stats.byCategory} />
          </Card>
        </Col>

        <Col xs={24} lg={7}>
          <Card title="状态分布" className="dashboard-bottom-card">
            <div className="status-list">
              {STATUS_KEYS.map((key) => {
                const count = stats.byStatus[key];
                const percentage = stats.total ? Math.round(count / stats.total * 100) : 0;
                const colors: Record<TaskStatus, string> = { todo: "#8991aa", in_progress: "#a491ff", done: "#7dcca4", blocked: "#ec929f" };
                return (
                  <div key={key}>
                    <div className="status-list-row">
                      <span className="status-list-label"><span className="status-dot" style={{ background: colors[key], boxShadow: "none" }} />{STATUS_META[key].label}</span>
                      <span className="status-list-value">{count}<small>{percentage}%</small></span>
                    </div>
                    <div className="status-track" role="progressbar" aria-label={STATUS_META[key].label} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
                      <span style={{ width: `${percentage}%`, background: colors[key] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={7}>
          <ActivityTimeline refreshKey={refreshKey} start={buildQuery(windowPreset, customRange)?.start} end={buildQuery(windowPreset, customRange)?.end} />
        </Col>
      </Row>
    </Space>
  );
}
