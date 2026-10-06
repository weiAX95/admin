import { useMemo } from "react";
import { Empty, Popover, Progress, Space, Typography, theme } from "antd";
import { STATUS_META } from "./TaskMeta";
import type { CategoryStat } from "../types";

// ── 四维能力维度 ─────────────────────────────────────────────────────

const DIMENSIONS = ["基础概念", "工具链", "实战", "工程化"] as const;

// ── SVG 几何常量 ─────────────────────────────────────────────────────

const CX = 160;
const CY = 135;
const R = 100;
const VIEW_W = 320;
const VIEW_H = 280;

/** 四轴角度：上( -90° ) / 右( 0° ) / 下( 90° ) / 左( 180° ) */
const ANGLES = [-90, 0, 90, 180];

/** 极坐标 → SVG 平面坐标 */
function polar(angleDeg: number, r: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
}

// ── 类型 ─────────────────────────────────────────────────────────────

interface DimensionData {
  category: string;
  count: number;
  doneCount: number;
  completionRate: number; // 0–1
  tasks: CategoryStat["tasks"];
}

interface RadarChartProps {
  categories: CategoryStat[];
}

// ── 组件 ─────────────────────────────────────────────────────────────

export default function RadarChart({ categories }: RadarChartProps) {
  const { token } = theme.useToken();
  // 将数据映射到四维标准维度
  const dimensionData: DimensionData[] = useMemo(
    () =>
      DIMENSIONS.map((dim) => {
        const stat = categories.find((c) => c.category === dim);
        if (stat && stat.count > 0) {
          return {
            category: stat.category,
            count: stat.count,
            doneCount: stat.doneCount ?? 0,
            completionRate: (stat.doneCount ?? 0) / stat.count,
            tasks: stat.tasks ?? [],
          };
        }
        return {
          category: dim,
          count: 0,
          doneCount: 0,
          completionRate: 0,
          tasks: [],
        };
      }),
    [categories],
  );

  const hasData = dimensionData.some((d) => d.count > 0);

  // ── 预计算 SVG 形状 ──────────────────────────────────────────────

  const ringPaths = useMemo(() => {
    const ratios = [0.25, 0.5, 0.75, 1.0];
    return ratios.map((ratio) => {
      const r = R * ratio;
      return ANGLES.map((a) => polar(a, r))
        .map(([x, y]) => `${x},${y}`)
        .join(" ");
    });
  }, []);

  const axisLines = useMemo(
    () => ANGLES.map((a) => polar(a, R)),
    [],
  );

  const polygonPoints = useMemo(
    () =>
      dimensionData
        .map((d, i) => {
          const r = R * Math.max(0.02, d.completionRate); // 最小可见
          const [x, y] = polar(ANGLES[i], r);
          return `${x},${y}`;
        })
        .join(" "),
    [dimensionData],
  );

  const dataDots = useMemo(
    () =>
      dimensionData.map((d, i) => {
        const r = R * Math.max(0.02, d.completionRate);
        return polar(ANGLES[i], r);
      }),
    [dimensionData],
  );

  // 标签位置（外环外偏移）
  const labelPositions = useMemo(
    () =>
      DIMENSIONS.map((_, i) => {
        const [x, y] = polar(ANGLES[i], R + 42);
        return { x, y };
      }),
    [],
  );

  // ── 空状态 ────────────────────────────────────────────────────────

  if (!hasData) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无任务数据"
      />
    );
  }

  // ── 渲染 ──────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 420,
        margin: "0 auto",
      }}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          overflow: "visible",
        }}
      >
        {/* ─── 网格环 ─── */}
        {ringPaths.map((points, i) => (
          <polygon
            key={`ring-${i}`}
            points={points}
            fill="none"
            stroke={token.colorBorderSecondary}
            strokeWidth={i === 3 ? 1.2 : 0.7}
          />
        ))}

        {/* ─── 轴线 ─── */}
        {axisLines.map(([x2, y2], i) => (
          <line
            key={`axis-${i}`}
            x1={CX}
            y1={CY}
            x2={x2}
            y2={y2}
            stroke={token.colorBorder}
            strokeWidth={0.8}
          />
        ))}

        {/* ─── 数据多边形（渐变填色） ─── */}
        <defs>
          <linearGradient id="radarFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={token.colorPrimary} stopOpacity={0.28} />
            <stop offset="100%" stopColor={token.colorPrimary} stopOpacity={0.12} />
          </linearGradient>
        </defs>
        <polygon
          points={polygonPoints}
          fill="url(#radarFill)"
          stroke={token.colorPrimary}
          strokeWidth={1.5}
          strokeLinejoin="round"
          style={{ transition: "opacity 0.4s ease" }}
        />

        {/* ─── 数据点 ─── */}
        {dataDots.map(([cx, cy], i) => (
          <circle
            key={`dot-${i}`}
            cx={cx}
            cy={cy}
            r={4}
            fill={token.colorPrimary}
            stroke={token.colorBgContainer}
            strokeWidth={2}
            style={{
              transition: "all 0.4s ease",
              cursor: dimensionData[i].count > 0 ? "pointer" : "default",
            }}
          />
        ))}
      </svg>

      {/* ─── 浮层触发区（绝对定位叠在 SVG 上方） ─── */}
      {DIMENSIONS.map((dim, i) => {
        const d = dimensionData[i];
        const { x, y } = labelPositions[i];
        const leftPct = (x / VIEW_W) * 100;
        const topPct = (y / VIEW_H) * 100;
        const pct = Math.round(d.completionRate * 100);

        const popoverContent = (
          <div style={{ maxWidth: 300, minWidth: 200 }}>
            <Space
              direction="vertical"
              size={4}
              style={{ width: "100%", marginBottom: 8 }}
            >
              <Typography.Text strong style={{ fontSize: 13 }}>
                {dim}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已完成 {d.doneCount}/{d.count} · 完成率 {pct}%
              </Typography.Text>
            </Space>

            {!d.tasks || d.tasks.length === 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                该分类暂无任务
              </Typography.Text>
            ) : (
              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                {d.tasks.map((t) => {
                  const meta = STATUS_META[t.status] ?? STATUS_META.todo;
                  return (
                    <div
                      key={t.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-block",
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background:
                            t.status === "done"
                              ? token.colorSuccess
                              : t.status === "in_progress"
                                ? token.colorPrimary
                                : t.status === "blocked"
                                  ? token.colorError
                                  : token.colorTextTertiary,
                        }}
                      />
                      <Typography.Text
                        ellipsis={{ tooltip: true }}
                        style={{ flex: 1, fontSize: 12, minWidth: 0 }}
                      >
                        {t.title}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 11, flexShrink: 0 }}
                      >
                        {meta.label}
                      </Typography.Text>
                      <Progress
                        percent={t.progress}
                        size="small"
                        style={{ width: 50, marginBottom: 0 }}
                        strokeColor={
                          t.progress === 100
                            ? token.colorSuccess
                            : t.progress >= 50
                              ? token.colorPrimary
                              : token.colorTextTertiary
                        }
                      />
                    </div>
                  );
                })}
              </Space>
            )}
          </div>
        );

        return (
          <Popover
            key={dim}
            trigger="click"
            placement="top"
            content={popoverContent}
            overlayStyle={{ maxWidth: 340 }}
          >
            <div
              style={{
                position: "absolute",
                left: `${leftPct}%`,
                top: `${topPct}%`,
                transform: "translate(-50%, -50%)",
                cursor: d.count > 0 ? "pointer" : "default",
                textAlign: "center",
                userSelect: "none",
                padding: "4px 8px",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: token.colorTextSecondary,
                  lineHeight: 1.4,
                }}
              >
                {dim}
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: token.colorPrimary,
                  lineHeight: 1.3,
                }}
              >
                {pct}%
              </div>
              {d.count > 0 && (
                <div
                  style={{
                    fontSize: 10,
                    color: token.colorTextTertiary,
                    lineHeight: 1.2,
                  }}
                >
                  {d.doneCount}/{d.count}
                </div>
              )}
            </div>
          </Popover>
        );
      })}
    </div>
  );
}
