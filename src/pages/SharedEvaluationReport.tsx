import { useEffect, useState } from 'react';
import { Alert, Card, Descriptions, Spin, Table, Tag, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { getSharedEvaluationReport } from '../api/experiment-evaluation';
import type { RegressionReport } from '../api/experiment-evaluation';

function ReportValue({ value, token }: { value: unknown; token: string }) {
  if (value === null || value === undefined || value === '') return <Typography.Text type="secondary">暂无</Typography.Text>;
  if (typeof value === 'object' && value !== null && 'parts' in value && Array.isArray(value.parts)) return <>{value.parts.map((part: { type: string; text?: string; assetId?: string }, index: number) => <div key={index}>{part.type === 'text' ? <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{part.text}</Typography.Paragraph> : part.assetId ? part.type === 'image' ? <img alt="报告媒体" style={{ maxWidth: 240 }} src={`/api/prompt-media/${part.assetId}?share=${encodeURIComponent(token)}`} /> : <a href={`/api/prompt-media/${part.assetId}?share=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">查看 {part.type} 媒体</a> : JSON.stringify(part)}</div>)}</>;
  return <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{typeof value === 'string' ? value : JSON.stringify(value)}</Typography.Paragraph>;
}

export default function SharedEvaluationReport() {
  const { token = '' } = useParams();
  const [report, setReport] = useState<RegressionReport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; void getSharedEvaluationReport(token).then(value => { if (active) setReport(value.report); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '分享不可用'); }); return () => { active = false; }; }, [token]);
  if (error) return <Alert type="warning" showIcon message={error} style={{ maxWidth: 900, margin: '64px auto' }} />;
  if (!report) return <Spin style={{ display: 'block', margin: '64px auto' }} />;
  return <Card title="公开评测报告" extra={<Tag>只读分享</Tag>} style={{ maxWidth: 1200, margin: '32px auto' }}>
    <Descriptions items={[{ key: 'dataset', label: '数据集版本', children: report.datasetVersionId }, { key: 'metric', label: '指标版本', children: report.metricVersionId }, { key: 'status', label: '状态', children: report.status }, { key: 'pass', label: '通过率', children: report.passRate === null ? '暂无数据' : `${(report.passRate * 100).toFixed(1)}%` }]} />
    <Table rowKey={row => `${row.caseKey}-${row.variantId}`} dataSource={report.cases} expandable={{ expandedRowRender: row => <Descriptions column={1} bordered size="small" items={[{ key: 'input', label: '输入', children: <ReportValue value={row.input} token={token} /> }, { key: 'context', label: '上下文', children: <ReportValue value={row.context} token={token} /> }, { key: 'expected', label: '参考答案', children: <ReportValue value={row.expectedOutput} token={token} /> }, { key: 'output', label: '输出', children: <ReportValue value={row.outputParts?.length ? { parts: row.outputParts } : row.output} token={token} /> }, { key: 'metrics', label: '指标详情', children: <ReportValue value={row.metricDetails} token={token} /> }]} /> }} columns={[{ title: '用例', dataIndex: 'caseKey' }, { title: '分类', dataIndex: 'category' }, { title: '评分', dataIndex: 'score', render: value => value ?? '未评分' }, { title: '状态', dataIndex: 'status' }]} pagination={{ pageSize: 50 }} />
  </Card>;
}
