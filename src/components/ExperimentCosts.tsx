import { useEffect, useRef, useState } from 'react';
import { Card, Col, Empty, Row, Table, Typography } from 'antd';
import Chart from 'chart.js/auto';
import { Link } from 'react-router-dom';
import { getExperimentCosts } from '../api/experiment-evaluation';

type Costs = Awaited<ReturnType<typeof getExperimentCosts>>;
export default function ExperimentCosts() {
  const [costs, setCosts] = useState<Costs | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { let alive = true; void getExperimentCosts().then(value => { if (alive) setCosts(value); }).catch(() => undefined); return () => { alive = false; }; }, []);
  useEffect(() => {
    if (!canvas.current || !costs?.byModel.length) return;
    const chart = new Chart(canvas.current, { type: 'pie', data: { labels: costs.byModel.map(item => item.api_model), datasets: [{ data: costs.byModel.map(item => item.cost), backgroundColor: ['#9582ff','#67c7d5','#e6bb77','#ec929f','#7dcca4','#b0a4e9'] }] }, options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#cbd1e3' } }, tooltip: { callbacks: { label: context => `${context.label}: $${Number(context.parsed).toFixed(6)}` } } } } });
    return () => chart.destroy();
  }, [costs]);
  return <Card title="实验成本概览" style={{ marginBottom: 20 }}><Row gutter={[24, 16]}><Col xs={24} md={7}><Typography.Text type="secondary">本月总成本</Typography.Text><Typography.Title level={2}>${Number(costs?.monthTotalUsd || 0).toFixed(6)}</Typography.Title><Typography.Text type="secondary">按上海日历月份统计，历史手工记录不计入。</Typography.Text></Col><Col xs={24} md={7}>{costs?.byModel.length ? <div style={{ maxWidth: 240, margin: 'auto' }}><canvas ref={canvas} role="img" aria-label="各模型实验成本占比饼图" /></div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无模型成本" />}</Col><Col xs={24} md={10}><Table title={() => 'Top 10 最昂贵实验'} size="small" rowKey="id" pagination={false} dataSource={costs?.top || []} columns={[{ title: '实验', dataIndex: 'title', render: (value, row) => <Link to={`/experiments/${row.id}`}>{value}</Link> }, { title: '累计成本', dataIndex: 'cost', render: value => `$${Number(value).toFixed(6)}` }]} /></Col></Row></Card>;
}
