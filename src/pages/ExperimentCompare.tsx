import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Col, Empty, Row, Select, Spin, Table, Tag, Typography } from 'antd';
import { diffArrays } from 'diff';
import { Link, useSearchParams } from 'react-router-dom';
import { getDefinition } from '../api/experiment-platform';
import type { ExperimentRun } from '../api/experiment-platform';
import { getExperiment } from '../api/experiments';
import type { Experiment } from '../types';

type ColumnData = { experiment: Experiment; runs: ExperimentRun[]; selectedRunId: string | null };
function paragraphs(output: string) { return output.split(/(\n\s*\n)/).filter(Boolean); }
function marked(base: string, current: string) {
  const changes = diffArrays(paragraphs(base), paragraphs(current));
  return changes.filter(change => !change.removed).flatMap((change, index) => change.value.map((part, partIndex) => <span key={`${index}-${partIndex}`} style={{ background: change.added ? 'rgba(230,187,119,.28)' : undefined, whiteSpace: 'pre-wrap' }}>{part}</span>));
}
export default function ExperimentCompare() {
  const [search] = useSearchParams();
  const ids = useMemo(() => [...new Set((search.get('ids') || '').split(',').filter(Boolean))].slice(0, 5), [search]);
  const [columns, setColumns] = useState<ColumnData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void Promise.all(ids.map(async id => {
      const experiment = await getExperiment(id);
      if (experiment.recordKind !== 'definition') return { experiment, runs: [], selectedRunId: null };
      const detail = await getDefinition(id);
      const runs = detail.batches.flatMap(batch => batch.runs).filter(run => run.status === 'completed');
      return { experiment, runs, selectedRunId: runs[0]?.id || null };
    })).then(value => { if (alive) { setColumns(value); setError(''); } }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : '加载对比失败'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ids]);
  if (ids.length < 2) return <Empty description="请从实验列表选择 2–5 个实验" />;
  if (loading) return <Spin />;
  if (error) return <Alert type="error" showIcon message={error} />;
  const selected = columns.map(column => column.runs.find(run => run.id === column.selectedRunId) || null);
  const output = (column: ColumnData, run: ExperimentRun | null) => run?.output || (column.experiment.recordKind === 'manual' ? column.experiment.result : '暂无已完成运行');
  const baseline = columns[0] ? output(columns[0], selected[0]) : '';
  return <Card title="实验对比" extra={<Link to="/experiments">返回实验列表</Link>}>
    <Typography.Paragraph type="secondary">以第一栏为基准逐段比较；黄色标记该栏不同的段落。可切换每个实验的历史运行。</Typography.Paragraph>
    <Row gutter={[12, 12]} wrap={false} style={{ overflowX: 'auto', paddingBottom: 12 }}>{columns.map((column, index) => {
      const run = selected[index];
      return <Col key={column.experiment.id} flex="0 0 300px"><Card size="small" title={<Link to={`/experiments/${column.experiment.id}`}>{column.experiment.title}</Link>} style={{ height: '100%' }}>
        <Select style={{ width: '100%', marginBottom: 12 }} value={column.selectedRunId} disabled={!column.runs.length} options={column.runs.map(item => ({ value: item.id, label: `${new Date(item.createdAt).toLocaleString('zh-CN')} · ${item.apiModel}` }))} onChange={value => setColumns(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, selectedRunId: value } : item))} placeholder="无运行" />
        <Tag>{run?.apiModel || column.experiment.model || '未填写模型'}</Tag>
        <Typography.Paragraph style={{ marginTop: 12 }}><Typography.Text strong>参数：</Typography.Text>{run ? JSON.stringify(run.parameters) : column.experiment.params || '暂无数据'}</Typography.Paragraph>
        <div style={{ maxHeight: 600, minHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{index === 0 ? baseline : marked(baseline, output(column, run))}</div>
      </Card></Col>;
    })}</Row>
    <Table size="small" pagination={false} rowKey="id" style={{ marginTop: 20 }} dataSource={columns.map((column, index) => ({ id: column.experiment.id, title: column.experiment.title, score: selected[index]?.autoScore ?? (column.experiment.recordKind === 'manual' ? column.experiment.score : null), token: selected[index]?.promptTokens === null || !selected[index] ? null : (selected[index].promptTokens || 0) + (selected[index].completionTokens || 0), latency: selected[index]?.latencyMs ?? null, cost: selected[index]?.costUsd ?? null }))} columns={[{ title: '实验', dataIndex: 'title' }, { title: '评分', dataIndex: 'score', render: value => value ?? '暂无数据' }, { title: 'Token', dataIndex: 'token', render: value => value ?? '暂无数据' }, { title: '延迟', dataIndex: 'latency', render: value => value === null ? '暂无数据' : `${value} ms` }, { title: '成本', dataIndex: 'cost', render: value => value === null ? '暂无数据' : `$${Number(value).toFixed(6)}` }]} />
  </Card>;
}
