import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Card, Empty, Popover, Segmented, Spin, Tag, Typography, theme } from "antd";
import dayjs from "dayjs";
import type { ActivityDay, DayCount } from "../types";
import { http } from "../api/client";

type View = "day" | "month" | "year";
const WEEKDAY_LABELS = ["一", "", "三", "", "五", "", "日"];
type HeatColors = readonly [string, string, string, string, string];
function heatColor(count: number, colors: HeatColors): string {
  return colors[Math.min(4, Math.max(0, count))];
}

function DayDetail({ date }: { date: string }) {
  const [detail, setDetail] = useState<ActivityDay | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    http.get<ActivityDay>("/activity/day", { date }).then(value => {
      if (active) setDetail(value);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "加载失败"); });
    return () => { active = false; };
  }, [date]);
  return <div className="heatmap-day-detail">
    <strong>{date}</strong>
    {error ? <Alert type="error" message={error} /> : !detail ? <Spin size="small" /> : <>
      <div className="heatmap-day-totals"><Tag color="green">完成 {detail.completed}</Tag><Tag color="blue">创建 {detail.created}</Tag><span>活动 {detail.items.length}</span></div>
      {detail.items.length ? <ul>{detail.items.map(item => <li key={item.id}><span>{item.title || item.detail}</span><small>{item.detail} · {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(item.at))}</small></li>)}</ul> : <p>当日无活动</p>}
    </>}
  </div>;
}

function DayCell({ item, colors }: { item: DayCount; colors: HeatColors }) {
  if ("outside" in item) return <span className="heatmap-cell heatmap-outside" aria-hidden="true" style={{ background: colors[0] }} />;
  return <Popover trigger="click" placement="bottom" content={<DayDetail date={item.date} />}>
    <button type="button" className="heatmap-cell" aria-label={`${item.date}，${item.count} 次活动，查看详情`} style={{ background: heatColor(item.count, colors) }} />
  </Popover>;
}

function WeeklyGrid({ days, scrollRef, colors }: { days: DayCount[]; scrollRef: React.RefObject<HTMLDivElement>; colors: HeatColors }) {
  const weeks = useMemo(() => {
    if (!days.length) return [] as DayCount[][];
    const byDate = new Map(days.map(item => [item.date, item]));
    const start = dayjs(days[0].date);
    const end = dayjs(days.at(-1)!.date);
    const first = start.subtract((start.day() + 6) % 7, "day");
    const last = end.add((7 - end.day()) % 7, "day");
    const result: DayCount[][] = [];
    for (let week = first; !week.isAfter(last, "day"); week = week.add(7, "day")) {
      result.push(Array.from({ length: 7 }, (_, offset) => {
        const date = week.add(offset, "day").format("YYYY-MM-DD");
        return byDate.get(date) || { date, count: 0, outside: true };
      }));
    }
    return result;
  }, [days]);
  const months = useMemo(() => {
    const result: { label: string; start: number }[] = [];
    weeks.forEach((week, index) => {
      const firstInRange = week.find(item => item.date >= days[0].date && item.date <= days.at(-1)!.date);
      if (!firstInRange) return;
      const label = dayjs(firstInRange.date).format("M月");
      if (result.at(-1)?.label !== label) result.push({ label, start: index });
    });
    return result;
  }, [weeks, days]);
  return <div className="heatmap-scroll" ref={scrollRef}>
    <div className="heatmap-month-head" style={{ marginLeft: 28 }}>
      {months.map((month, index) => <span key={`${month.start}-${month.label}`} style={{ width: ( (months[index + 1]?.start ?? weeks.length) - month.start ) * 16 - 4 }}>{month.label}</span>)}
    </div>
    <div className="heatmap-week-row"><div className="heatmap-week-labels">{WEEKDAY_LABELS.map((label, index) => <span key={index}>{label}</span>)}</div>
      {weeks.map((week, index) => <div className="heatmap-week" key={index}>{week.map(item => <DayCell key={item.date} item={item} colors={colors} />)}</div>)}
    </div>
  </div>;
}

export default function ActivityHeatmap({ days, anchorDate, refreshKey }: { days: DayCount[]; anchorDate: string; refreshKey?: number }) {
  const { token } = theme.useToken();
  const colors: HeatColors = [token.colorFillQuaternary, token.colorPrimaryBg, token.colorPrimaryBgHover, token.colorPrimaryBorder, token.colorPrimary];
  const [view, setView] = useState<View>("day");
  const [yearCache, setYearCache] = useState<Record<string, DayCount[]>>({});
  const [yearError, setYearError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const year = anchorDate.slice(0, 4);
  useEffect(() => {
    let active = true;
    setYearError("");
    http.get<{ items: DayCount[] }>("/activity/heatmap", { start: `${year}-01-01`, end: `${year}-12-31` }).then(result => {
      if (active) setYearCache(previous => ({ ...previous, [year]: result.items }));
    }).catch(e => { if (active) setYearError(e instanceof Error ? e.message : "热力图加载失败"); });
    return () => { active = false; };
  }, [year, refreshKey]);
  const shown = useMemo(() => {
    if (view === "day") return days;
    const yearDays = yearCache[year] || [];
    return view === "year" ? yearDays : yearDays.filter(item => item.date.slice(0, 7) === anchorDate.slice(0, 7));
  }, [view, days, yearCache, year, anchorDate]);
  const summary = useMemo(() => ({ total: shown.reduce((sum, item) => sum + item.count, 0), active: shown.filter(item => item.count > 0).length }), [shown]);
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollLeft = view === "day" ? element.scrollWidth : 0;
  }, [view, shown]);
  return <Card title="学习热力图" className="activity-heatmap-card" extra={<Segmented aria-label="热力图视图" size="small" value={view} onChange={value => setView(value as View)} options={[{ label: "按天", value: "day" }, { label: "月视图", value: "month" }, { label: "年视图", value: "year" }]} />}>
    <div className="heatmap-headline"><Typography.Text type="secondary">{view === "day" ? "所选时间范围" : view === "month" ? `${anchorDate.slice(0, 4)}年${Number(anchorDate.slice(5, 7))}月` : `${year} 年`}</Typography.Text><span>{summary.total} 次活动 · {summary.active} 天活跃</span></div>
    {view !== "day" && !yearCache[year] ? <div className="heatmap-loading">{yearError ? <Alert type="error" message={yearError} /> : <Spin size="small" tip="正在加载热力图" />}</div> : shown.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该时段暂无活动" /> : <>
      {view === "month" ? <div className="heatmap-calendar"><div className="heatmap-calendar-labels">{["一","二","三","四","五","六","日"].map(d => <span key={d}>{d}</span>)}</div><div className="heatmap-calendar-grid">
        {Array.from({ length: (dayjs(shown[0].date).day() + 6) % 7 }, (_, index) => <span key={`blank-${index}`} />)}
        {shown.map(item => <div className="heatmap-calendar-day" key={item.date}><small>{Number(item.date.slice(-2))}</small><DayCell item={item} colors={colors} /></div>)}
      </div></div> : <WeeklyGrid days={shown} scrollRef={scrollRef} colors={colors} />}
      <div className="heatmap-legend"><span>少</span>{[0,1,2,3,4].map(number => <i key={number} style={{ background: heatColor(number, colors) }} />)}<span>多</span></div>
    </>}
  </Card>;
}
