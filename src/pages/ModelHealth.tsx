import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Card, Space, Statistic, Table, Tag, Typography } from 'antd';
import { getModelHealth, type ModelHealthItem, type ModelHealthReport } from '../api/model-health';
import './ModelHealth.css';

const healthLabel = { healthy: '调用正常', degraded: '异常', unknown: '暂无调用', retired: '已退役' };
const healthColor = { healthy: 'success', degraded: 'error', unknown: 'default', retired: 'default' } as const;

export default function ModelHealth() {
  const [report, setReport] = useState<ModelHealthReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [changed, setChanged] = useState<string[]>([]);
  const previous = useRef<Record<string, string>>({});
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const value = await getModelHealth();
      const next = Object.fromEntries(value.items.map(item => [item.id, item.health]));
      setChanged(value.items.filter(item => previous.current[item.id] && previous.current[item.id] !== item.health).map(item => item.id));
      previous.current = next;
      setReport(value);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '获取模型健康状态失败'); }
    finally { busy.current = false; setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const formatMs = (value: number | null) => value === null ? '—' : `${value} ms`;
  const columns = [
    { title: '模型', dataIndex: 'displayName', render: (_: string, item: ModelHealthItem) => <Space><strong>{item.displayName}</strong>{item.status !== 'active' && <Tag>{item.status === 'deprecated' ? '已弃用' : '已退役'}</Tag>}</Space> },
    { title: '观察状态', dataIndex: 'health', render: (value: ModelHealthItem['health']) => <Badge status={healthColor[value]} text={healthLabel[value]} /> },
    { title: 'QPS', dataIndex: 'qps', render: (value: number) => value.toFixed(3) },
    { title: 'P50', dataIndex: 'p50Ms', render: formatMs },
    { title: 'P95', dataIndex: 'p95Ms', render: formatMs },
    { title: 'P99', dataIndex: 'p99Ms', render: formatMs },
    { title: '5xx 错误率', dataIndex: 'errorRate5xx', render: (value: number | null) => value === null ? '—' : `${value.toFixed(2)}%` },
    { title: '5 分钟请求数', dataIndex: 'sampleCount' },
  ];
  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    <Card title="模型健康 Dashboard">
      <Typography.Paragraph type="secondary">每 5 秒刷新过去 5 分钟的实际模型调用。绿色表示该窗口内已记录的调用未触发阈值；红色表示 5xx 错误率超过 5% 或 P95 超过 10 秒。无调用样本时无法判断提供商是否在线。</Typography.Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Space size="large" wrap style={{ marginBottom: 16 }}>
        <Statistic title="模型数" value={report?.items.length ?? 0} />
        <Statistic title="异常模型" value={report?.items.filter(item => item.health === 'degraded').length ?? 0} valueStyle={{ color: report?.items.some(item => item.health === 'degraded') ? '#ff4d4f' : undefined }} />
        <Statistic title="最近更新" value={report ? new Date(report.measuredAt).toLocaleTimeString('zh-CN') : '—'} />
      </Space>
      <Table<ModelHealthItem> rowKey="id" loading={loading} dataSource={report?.items || []} columns={columns} scroll={{ x: 950 }} pagination={false} rowClassName={item => `${item.health === 'degraded' ? 'model-health-degraded ' : ''}${changed.includes(item.id) ? 'model-health-changed' : ''}`} />
    </Card>
  </Space>;
}
