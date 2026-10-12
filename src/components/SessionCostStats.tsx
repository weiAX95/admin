import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Segmented, Space, Spin, Statistic, Typography, theme } from 'antd';
import { ArcElement, CategoryScale, Chart, Legend, LineController, LineElement, LinearScale, PieController, PointElement, Tooltip } from 'chart.js';
import { getSessionCostStats } from '../api/sessions';
import type { SessionCostGranularity, SessionCostRow, SessionCostStats as CostStats, SessionPriceMode } from '../api/sessions';

Chart.register(ArcElement, CategoryScale, Legend, LineController, LineElement, LinearScale, PieController, PointElement, Tooltip);

export default function SessionCostStats({ onSessionCosts }: { onSessionCosts: (rows: SessionCostRow[]) => void }) {
  const { token } = theme.useToken();
  const [priceMode, setPriceMode] = useState<SessionPriceMode>('current');
  const [granularity, setGranularity] = useState<SessionCostGranularity>('day');
  const [stats, setStats] = useState<CostStats>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const trendRef = useRef<HTMLCanvasElement>(null);
  const pieRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    onSessionCosts([]);
    setStats(undefined);
    setLoading(true);
    void getSessionCostStats(priceMode, granularity).then(result => {
      if (!active) return;
      setStats(result); setError(''); onSessionCosts(result.sessions);
    }).catch(cause => { if (active) { setStats(undefined); setError(cause instanceof Error ? cause.message : '读取成本失败'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [priceMode, granularity, revision, onSessionCosts]);

  useLayoutEffect(() => {
    if (!stats?.trend.length || !trendRef.current) return;
    const chart = new Chart<'line', number[], string>(trendRef.current, {
      type: 'line', data: { labels: stats.trend.map(item => item.date), datasets: [{ label: '成本 USD', data: stats.trend.map(item => item.costUsd), borderColor: token.colorPrimary, backgroundColor: token.colorPrimary, borderWidth: 2, tension: 0.2, pointRadius: stats.trend.length > 40 ? 0 : 3 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { x: { ticks: { color: token.colorTextSecondary, maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: token.colorTextSecondary } } } },
    });
    return () => chart.destroy();
  }, [stats, token.colorPrimary, token.colorTextSecondary]);

  useLayoutEffect(() => {
    if (!stats?.byModel.length || !pieRef.current) return;
    const colors = [token.colorPrimary, token.colorSuccess, token.colorInfo, token.colorWarning, token.colorError, token.colorTextSecondary];
    const chart = new Chart<'pie', number[], string>(pieRef.current, {
      type: 'pie', data: { labels: stats.byModel.map(item => item.model), datasets: [{ data: stats.byModel.map(item => item.costUsd), backgroundColor: stats.byModel.map((_, index) => colors[index % colors.length]) }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { color: token.colorTextSecondary } }, tooltip: { callbacks: { label: item => `${item.label}：$${Number(item.parsed).toFixed(6)}（${stats.totalUsd ? (Number(item.parsed) / stats.totalUsd * 100).toFixed(1) : 0}%）` } } } },
    });
    return () => chart.destroy();
  }, [stats, token.colorPrimary, token.colorSuccess, token.colorInfo, token.colorWarning, token.colorError, token.colorTextSecondary]);

  return <Card title="会话成本估算" extra={<Space wrap><Segmented aria-label="成本时间粒度" value={granularity} onChange={value => setGranularity(value as SessionCostGranularity)} options={[{ label: '按天', value: 'day' }, { label: '按周', value: 'week' }, { label: '按月', value: 'month' }]} /><Segmented aria-label="价格口径" value={priceMode} onChange={value => setPriceMode(value as SessionPriceMode)} options={[{ label: '按现价重算', value: 'current' }, { label: '上报时价格', value: 'snapshot' }]} /><Button size="small" onClick={() => setRevision(value => value + 1)}>刷新</Button></Space>}>
    {error && <Alert type="error" showIcon message={error} />}
    {loading && !stats ? <Spin /> : stats ? <>
      <Space size="large" wrap><Statistic title="已知成本 USD" value={stats.totalUsd ?? 0} precision={8} /><Statistic title="可计价消息" value={stats.pricedMessages} /><Statistic title="未定价消息" value={stats.unpricedMessages} /></Space>
      {stats.unpricedMessages > 0 && <Alert type="warning" showIcon style={{ marginTop: 12 }} message={`${stats.unpricedMessages} 条消息缺少${priceMode === 'snapshot' ? '上报时价格快照' : '匹配的模型价格'}；总额只包含可计价消息。`} />}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>价格来自统一模型目录，单位为美元／千 token；聊天端需上报该目录中的模型唯一标识。按现价重算会随设置变化，上报时价格保留原快照。</Typography.Paragraph>
      {stats.totalUsd === null ? <Empty description="暂无可计价数据，请配置模型价格并上报模型标识" /> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20 }}>
        <div><Typography.Text strong>成本趋势</Typography.Text><div className="trend-chart-container"><canvas ref={trendRef} role="img" aria-label="会话成本趋势折线图" /></div></div>
        <div><Typography.Text strong>模型成本占比</Typography.Text>{stats.totalUsd === 0 ? <Empty description="总成本为 0，暂无占比" /> : <div className="trend-chart-container"><canvas ref={pieRef} role="img" aria-label="模型成本占比饼图" /></div>}</div>
      </div>}
    </> : null}
  </Card>;
}
