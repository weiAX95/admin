import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Select, Spin, Tag, Timeline } from "antd";
import { http } from "../api/client";
import type { Activity, ActivityPage, ActivityType } from "../types";

const LABELS: Record<ActivityType, string> = { create: "创建", update: "更新", complete: "完成", delete: "删除", note: "笔记", experiment: "实验" };
const COLORS: Record<ActivityType, string> = { create: "blue", update: "purple", complete: "green", delete: "red", note: "gold", experiment: "cyan" };

export default function ActivityTimeline({ start, end, refreshKey }: { start?: string; end?: string; refreshKey?: number }) {
  const [type, setType] = useState<string>();
  const [userId, setUserId] = useState<string>();
  const [items, setItems] = useState<Activity[]>([]);
  const [users, setUsers] = useState<ActivityPage["users"]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = ++generation.current;
    busy.current = true;
    setItems([]); setCursor(null); setTotal(0); setLoading(true); setError("");
    if (viewport.current) viewport.current.scrollTop = 0;
    http.get<ActivityPage>("/activity", { type, userId, start, end }).then(page => {
      if (generation.current !== current) return;
      setItems(page.items); setUsers(page.users); setCursor(page.nextCursor); setTotal(page.total);
    }).catch(e => {
      if (generation.current === current) setError(e instanceof Error ? e.message : "活动加载失败");
    }).finally(() => {
      if (generation.current === current) { busy.current = false; setLoading(false); }
    });
    return () => { ++generation.current; };
  }, [type, userId, start, end, retry, refreshKey]);

  const loadMore = useCallback(() => {
    if (!cursor || busy.current) return;
    const current = generation.current;
    busy.current = true; setLoading(true); setError("");
    http.get<ActivityPage>("/activity", { type, userId, start, end, cursor }).then(page => {
      if (generation.current !== current) return;
      setItems(previous => [...previous, ...page.items.filter(a => !previous.some(p => p.id === a.id))]);
      setCursor(page.nextCursor); setTotal(page.total); setUsers(page.users);
    }).catch(e => {
      if (generation.current === current) setError(e instanceof Error ? e.message : "活动加载失败");
    }).finally(() => {
      if (generation.current === current) { busy.current = false; setLoading(false); }
    });
  }, [cursor, type, userId, start, end]);

  useEffect(() => {
    if (loading || error || !cursor || !sentinel.current) return;
    const current = generation.current;
    const observer = new IntersectionObserver(entries => {
      if (generation.current === current && entries.some(entry => entry.isIntersecting)) loadMore();
    }, { root: viewport.current, rootMargin: "0px 0px 60px 0px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [loading, error, cursor, loadMore]);

  return (
    <Card title="最近活动" className="dashboard-bottom-card activity-card" extra={<span className="activity-count">{total} 条</span>}>
      <div className="activity-filters">
        <Select aria-label="活动类型筛选" placeholder="全部活动类型" allowClear value={type} onChange={setType} options={Object.entries(LABELS).map(([value, label]) => ({ value, label }))} />
        <Select aria-label="活动用户筛选" placeholder="全部用户" allowClear value={userId} onChange={setUserId} options={users.map(u => ({ value: u.id, label: u.username && u.username !== u.name ? `${u.name}（${u.username}）` : u.name }))} />
      </div>
      <div className="activity-scroll" ref={viewport} role="region" aria-label="最近活动时间线" tabIndex={0} aria-busy={loading}>
        {items.length > 0 && <Timeline items={items.map(a => ({ color: COLORS[a.type], children: <div className="activity-entry">
          <div><Tag color={COLORS[a.type]}>{LABELS[a.type] || a.type}</Tag><span className="activity-title">{a.title}</span></div>
          <p className="activity-detail">{a.detail}</p>
          <div className="activity-meta"><span>{a.userName || a.username || "用户未知（历史记录）"}</span><time dateTime={a.at}>{new Date(a.at).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}</time></div>
        </div> }))} />}
        {!loading && !error && items.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无符合筛选条件的活动" />}
        {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => items.length ? loadMore() : setRetry(n => n + 1)}>重试</Button>} />}
        <div ref={sentinel} className="activity-footer">
          {loading ? <div role="status"><Spin size="small" /><span>{items.length ? "正在加载更多…" : "正在加载活动…"}</span></div> : !error && (cursor ? <Button type="text" size="small" onClick={loadMore}>加载更多</Button> : items.length > 0 && <span>已显示全部 {items.length} 条活动</span>)}
        </div>
      </div>
    </Card>
  );
}
