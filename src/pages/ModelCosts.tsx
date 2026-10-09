import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Empty, InputNumber, Progress, Row, Select, Space, Statistic, Table, Typography } from 'antd';
import { Chart, registerables } from 'chart.js';
import dayjs from 'dayjs';
import { getModelCosts, getModelCostBudget, saveModelCostBudget, type CostDimension, type ModelCostBudget, type ModelCostsReport } from '../api/model-costs';
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
  const [budget, setBudget] = useState<ModelCostBudget | null>(null);
  const [budgetInput, setBudgetInput] = useState(0);
  const [savingBudget, setSavingBudget] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    void getModelCostBudget().then(value => { if (active) { setBudget(value); setBudgetInput(Number(value.monthlyBudgetUsd)); } }).catch(cause => { if (active) setError(cause.message); });
    const timer = window.setInterval(() => { if (!document.hidden) void getModelCostBudget().then(value => { if (active) setBudget(value); }).catch(() => undefined); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
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
  const saveBudget = () => {
    if (!budget) return;
    setSavingBudget(true);
    void saveModelCostBudget(budgetInput, budget.version).then(value => { setBudget(value); setError(''); }).catch(cause => setError(cause.message)).finally(() => setSavingBudget(false));
  };
  const exportPdf = () => {
    if (!report) return;
    setExportingPdf(true);
    void import('../utils/modelCostPdf').then(module => module.makeModelCostPdf(report)).then(blob => { downloadBlob(blob, `模型成本-${range[0]}-${range[1]}.pdf`); setError(''); }).catch(cause => setError(cause.message)).finally(() => setExportingPdf(false));
  };
  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    <Card title={`月度预算 · ${budget?.month || ''}`}>
      <Space wrap align="center"><Typography.Text>预算 USD</Typography.Text><InputNumber aria-label="模型月预算（美元）" min={0} max={1000000000} precision={6} value={budgetInput} onChange={value => setBudgetInput(value ?? 0)} /><Button type="primary" loading={savingBudget} onClick={saveBudget}>保存预算</Button><Typography.Text>已使用 ${Number(budget?.spentUsd || 0).toFixed(6)}</Typography.Text></Space>
      {budget?.percentage !== null && budget?.percentage !== undefined && <Progress style={{ marginTop: 16 }} percent={Math.min(100, Number(budget.percentage.toFixed(1)))} status={budget.percentage >= 100 ? 'exception' : 'active'} format={() => `${budget.percentage?.toFixed(1)}%`} />}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>预算为 0 时关闭预警；达到 80%、100%、120% 时通知管理员。日成本超过前七日均值三倍时另发异常通知。</Typography.Paragraph>
    </Card>
    <Card title="成本中心" extra={<Space><Button disabled={!report?.breakdown.length} onClick={exportCsv}>导出 CSV</Button><Button disabled={!report} loading={exportingPdf} onClick={exportPdf}>导出 PDF</Button></Space>}>
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
