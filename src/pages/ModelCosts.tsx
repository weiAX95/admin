import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Empty, Row, Select, Space, Statistic, Table, Typography } from 'antd';
import { Chart, registerables } from 'chart.js';
import dayjs from 'dayjs';
import { getModelCosts, type CostDimension, type ModelCostsReport } from '../api/model-costs';
import { downloadBlob } from '../utils/noteExport';

Chart.register(...registerables);
const csvCell = (value: unknown) => { const raw = String(value ?? ''); const safe = /^[=+@-]/.test(raw) ? `'${raw}` : raw; return `"${safe.replaceAll('"', '""')}"`; };

export default function ModelCosts() {
  const [range, setRange] = useState<[string, string]>([dayjs().subtract(29, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')]);
  const [dimension, setDimension] = useState<CostDimension>('model');
  const [modelId, setModelId] = useState('');
  const [userId, setUserId] = useState('');
  const [module, setModule] = useState('');
  const [report, setReport] = useState<ModelCostsReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void getModelCosts({ start: range[0], end: range[1], dimension, modelId, userId, module }).then(value => {
      if (live) { setReport(value); setError(''); }
    }).catch(cause => { if (live) setError(cause.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range, dimension, modelId, userId, module]);
  useEffect(() => {
    if (!canvas.current || !report?.trend.length) return;
    const chart = new Chart(canvas.current, { type: 'line', data: { labels: report.trend.map(item => item.day), datasets: [{ label: '成本 USD', data: report.trend.map(item => Number(item.costUsd)), borderColor: '#9582ff', backgroundColor: 'rgba(149,130,255,.13)', fill: true, tension: .2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
    return () => chart.destroy();
  }, [report]);
  const exportCsv = () => {
    if (!report) return;
    const rows = [['统计维度', '名称', '费用 USD', '计费部分数'], ...report.breakdown.map(item => [dimension, item.name, item.costUsd, item.runParts])];
    downloadBlob(new Blob([`\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), `模型成本-${range[0]}-${range[1]}.csv`);
  };
  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    <Card title="成本中心" extra={<Button disabled={!report?.breakdown.length} onClick={exportCsv}>导出 CSV</Button>}>
      <Typography.Paragraph type="secondary">按 UTC 完成日统计已记账的主模型与 Judge 费用；历史价格取运行时快照。聊天端会话尚未经过本服务执行，不计入本报表。</Typography.Paragraph>
      <Space wrap size="middle" style={{ marginBottom: 20 }}>
        <DatePicker.RangePicker value={[dayjs(range[0]), dayjs(range[1])]} onChange={dates => { if (dates?.[0] && dates[1]) setRange([dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')]); }} />
        <Select aria-label="统计维度" style={{ width: 140 }} value={dimension} onChange={setDimension} options={[{ value: 'model', label: '按模型' }, { value: 'user', label: '按账号' }, { value: 'module', label: '按模块' }]} />
        <Select aria-label="模型筛选" style={{ width: 180 }} value={modelId} onChange={setModelId} options={[{ value: '', label: '全部模型' }, ...(report?.filters.models || []).map(item => ({ value: item.id, label: item.name }))]} />
        <Select aria-label="账号筛选" style={{ width: 180 }} value={userId} onChange={setUserId} options={[{ value: '', label: '全部账号' }, ...(report?.filters.users || []).map(item => ({ value: item.id, label: item.name }))]} />
        <Select aria-label="模块筛选" style={{ width: 150 }} value={module} onChange={setModule} options={[{ value: '', label: '全部模块' }, { value: 'experiments', label: '实验' }, { value: 'evaluations', label: '评测' }]} />
      </Space>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Row gutter={[16, 16]}><Col xs={24} md={8}><Card><Statistic title="筛选范围总成本" value={Number(report?.totalUsd || 0)} precision={6} prefix="$" loading={loading} /></Card></Col><Col xs={24} md={16}><Card title="每日费用趋势">{report?.trend.length ? <div style={{ height: 240 }}><canvas ref={canvas} aria-label="每日模型成本趋势折线图" role="img" /></div> : <Empty description="暂无成本数据" />}</Card></Col></Row>
      <Table style={{ marginTop: 20 }} rowKey="key" loading={loading} dataSource={report?.breakdown || []} pagination={{ pageSize: 10 }} columns={[{ title: '名称', dataIndex: 'name' }, { title: '费用 USD', dataIndex: 'costUsd', render: value => `$${value}` }, { title: '计费部分数', dataIndex: 'runParts' }]} />
    </Card>
  </Space>;
}
