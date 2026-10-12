import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Space, Spin, Statistic, Table, Typography, theme } from 'antd';
import { CategoryScale, Chart, LineController, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import { getSessionTokenStats } from '../api/sessions';
import type { SessionTokenStats as TokenStats } from '../api/sessions';

Chart.register(CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip);

export default function SessionTokenStats({ onOpen }: { onOpen: (id: string) => void }) {
  const { token } = theme.useToken();
  const [stats, setStats] = useState<TokenStats>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    void getSessionTokenStats().then(result => { if (active) { setStats(result); setError(''); } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '读取用量失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  useLayoutEffect(() => {
    if (!canvasRef.current || !stats?.hasData) return;
    const chart = new Chart<'line', number[], string>(canvasRef.current, {
      type: 'line',
      data: { labels: stats.daily.map(item => item.date), datasets: [{ label: '每日 token', data: stats.daily.map(item => item.totalTokens), borderColor: token.colorPrimary, backgroundColor: token.colorPrimary, borderWidth: 2, pointRadius: stats.daily.length > 40 ? 0 : 3, tension: 0.2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { tooltip: { callbacks: { label: item => `${item.parsed.y?.toLocaleString() || 0} token` } } }, scales: { x: { ticks: { color: token.colorTextSecondary, maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: token.colorTextSecondary, precision: 0 } } } },
    });
    return () => chart.destroy();
  }, [stats, token.colorPrimary, token.colorTextSecondary]);

  return <Card title="会话 Token 用量" extra={<Button size="small" onClick={() => { setLoading(true); setRevision(value => value + 1); }}>刷新</Button>}>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
    {loading && !stats ? <Spin /> : error && !stats ? null : !stats?.hasData ? <Empty description="需接入 token 统计" /> : <>
      <Space size="large" wrap><Statistic title="本月 token" value={stats.monthTokens ?? 0} /><Statistic title="总 token" value={stats.totalTokens ?? 0} /><Statistic title="每次已上报会话平均 token" value={Math.round(stats.averagePerSession ?? 0)} /><Statistic title="已上报会话" value={stats.reportedSessions} /></Space>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>仅统计聊天端明确上报的 assistant 消息用量；未上报的会话不按 0 token 计入平均值。日期按上海时区。</Typography.Paragraph>
      <div className="trend-chart-container"><canvas ref={canvasRef} role="img" aria-label="每日会话 token 消耗趋势" /></div>
      <Table size="small" rowKey="id" pagination={false} dataSource={stats.topSessions} columns={[
        { title: 'Top 10 耗 token 会话', dataIndex: 'title', render: (title: string, row: TokenStats['topSessions'][number]) => <Button type="link" onClick={() => onOpen(row.id)}>{title}</Button> },
        { title: 'Token', dataIndex: 'totalTokens', align: 'right', render: (value: number) => value.toLocaleString() },
      ]} />
    </>}
  </Card>;
}
