import { useEffect, useRef } from 'react';
import { Card, Col, Empty, Row, Statistic, Table, theme } from 'antd';
import Chart from 'chart.js/auto';
import type { AlertAnalytics as AlertAnalyticsData } from '../api/alerts';

export default function AlertAnalytics({ data }: { data: AlertAnalyticsData | null }) {
  const { token } = theme.useToken();
  const trendRef = useRef<HTMLCanvasElement>(null);
  const moduleRef = useRef<HTMLCanvasElement>(null);
  const typeRef = useRef<HTMLCanvasElement>(null);
  const trendChartRef = useRef<Chart<'line'> | null>(null);
  const moduleChartRef = useRef<Chart<'pie'> | null>(null);
  const typeChartRef = useRef<Chart<'pie'> | null>(null);

  useEffect(() => () => {
    trendChartRef.current?.destroy();
    moduleChartRef.current?.destroy();
    typeChartRef.current?.destroy();
    trendChartRef.current = null;
    moduleChartRef.current = null;
    typeChartRef.current = null;
  }, []);

  useEffect(() => {
    const colors = [token.colorInfo, token.colorWarning, token.colorError];
    const common = { responsive: true, maintainAspectRatio: false, animation: false as const };
    const trendOptions = { ...common, plugins: { legend: { labels: { color: token.colorText } } }, scales: {
      x: { ticks: { color: token.colorTextSecondary, maxTicksLimit: 8 } },
      y: { beginAtZero: true, ticks: { color: token.colorTextSecondary, precision: 0 } },
    } };
    if (data?.daily.length && trendRef.current) {
      const labels = data.daily.map(item => item.day);
      const datasets = (['info','warning','critical'] as const).map((level,index) => ({
        label: level, data: data.daily.map(item => item[level]), borderColor: colors[index],
        backgroundColor: colors[index], pointRadius: data.daily.length > 45 ? 0 : 2, tension: 0,
      }));
      const chart = trendChartRef.current;
      if (chart && chart.canvas === trendRef.current) {
        chart.data.labels = labels;
        datasets.forEach((dataset,index) => Object.assign(chart.data.datasets[index],dataset));
        chart.options = trendOptions;
        chart.update('none');
      } else {
        chart?.destroy();
        trendChartRef.current = new Chart(trendRef.current,{ type: 'line', data: { labels, datasets }, options: trendOptions });
      }
    } else {
      trendChartRef.current?.destroy();
      trendChartRef.current = null;
    }

    const pieOptions = { ...common, plugins: { legend: { position: 'bottom' as const, labels: { color: token.colorText } } } };
    const pieColors = [token.colorPrimary,token.colorInfo,token.colorSuccess,token.colorWarning,token.colorError,token.colorTextTertiary];
    const syncPie = (canvas: HTMLCanvasElement | null, chartRef: { current: Chart<'pie'> | null }, items: { name: string; count: number }[]) => {
      if (!canvas || !items.length) {
        chartRef.current?.destroy();
        chartRef.current = null;
        return;
      }
      const labels = items.map(item => item.name);
      const values = items.map(item => item.count);
      const chart = chartRef.current;
      if (chart && chart.canvas === canvas) {
        const visibleByName = new Map(chart.data.labels?.map((label,index) => [String(label),chart.getDataVisibility(index)]));
        chart.data.labels = labels;
        chart.data.datasets[0].data = values;
        chart.data.datasets[0].backgroundColor = pieColors;
        labels.forEach((label,index) => {
          if (chart.getDataVisibility(index) !== (visibleByName.get(label) ?? true)) chart.toggleDataVisibility(index);
        });
        chart.options = pieOptions;
        chart.update('none');
      } else {
        chart?.destroy();
        chartRef.current = new Chart(canvas,{ type: 'pie', data: { labels, datasets: [{ data: values, backgroundColor: pieColors }] }, options: pieOptions });
      }
    };
    syncPie(moduleRef.current,moduleChartRef,data?.byModule || []);
    syncPie(typeRef.current,typeChartRef,data?.byType || []);
  }, [data,token.colorInfo,token.colorWarning,token.colorError,token.colorText,token.colorTextSecondary,token.colorPrimary,token.colorSuccess,token.colorTextTertiary]);

  if (!data) return <Empty description="暂无告警分析数据" />;
  const formatMinutes = (value: string | null) => value === null ? '暂无数据' : `${Number(value).toFixed(1)} 分钟`;
  return <>
    <Row gutter={[12,12]}><Col span={8}><Card><Statistic title="告警总数" value={data.totals.total} /></Card></Col><Col span={8}><Card><Statistic title="平均确认时间 MTTA" value={formatMinutes(data.totals.mtta_minutes)} /></Card></Col><Col span={8}><Card><Statistic title="平均解决时间 MTTR" value={formatMinutes(data.totals.mttr_minutes)} /></Card></Col></Row>
    <Card title="每日告警趋势" style={{ marginTop: 12 }}>{data.daily.length ? <div style={{ height: 260 }}><canvas ref={trendRef} role="img" aria-label="每日告警数，按级别分层" /></div> : <Empty description="该时段暂无告警" />}</Card>
    <Row gutter={[12,12]} style={{ marginTop: 12 }}><Col xs={24} md={12}><Card title="按模块分布">{data.byModule.length ? <div style={{ height: 260 }}><canvas ref={moduleRef} role="img" aria-label="告警模块分布" /></div> : <Empty />}</Card></Col><Col xs={24} md={12}><Card title="按类型分布">{data.byType.length ? <div style={{ height: 260 }}><canvas ref={typeRef} role="img" aria-label="告警类型分布" /></div> : <Empty />}</Card></Col></Row>
    <Card title="按级别响应时间" style={{ marginTop: 12 }}><Table rowKey="level" pagination={false} dataSource={data.byLevel} columns={[
      { title: '级别', dataIndex: 'level' }, { title: '事件数', dataIndex: 'total' },
      { title: 'MTTA', dataIndex: 'mtta_minutes', render: formatMinutes },
      { title: 'MTTR', dataIndex: 'mttr_minutes', render: formatMinutes },
    ]} /></Card>
  </>;
}
