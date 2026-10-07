import { useCallback, useEffect, useState } from 'react';
import { App, Alert, Button, Card, Col, Descriptions, Form, Input, Progress, Row, Space, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { getDefinition, retryBatch, runBatch, runDefinition } from '../api/experiment-platform';
import type { ExperimentBatch, ExperimentDefinition, ExperimentRun } from '../api/experiment-platform';
import { getStoredUser } from '../api/client';
import type { AuthUser } from '../types';
import MarkdownContent from './MarkdownContent';

const variableNames = (text: string) => [...new Set([...text.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)].map(match => match[1]))];
export default function ExperimentDefinitionDetail({ id }: { id: string }) {
  const { message } = App.useApp();
  const [definition, setDefinition] = useState<ExperimentDefinition | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [batchInputs, setBatchInputs] = useState('[]');
  const load = useCallback(() => getDefinition(id).then(value => { setDefinition(value); setVariables(current => Object.keys(current).length ? current : value.variables); setError(''); }).catch(cause => setError(cause instanceof Error ? cause.message : '加载失败')), [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!definition?.batches.some(batch => ['queued', 'running'].includes(batch.status))) return;
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 1500);
    return () => window.clearInterval(timer);
  }, [definition, load]);
  if (error) return <Alert type="error" showIcon message={error} action={<Button onClick={() => void load()}>重试</Button>} />;
  if (!definition) return <Card loading />;
  const user = getStoredUser<AuthUser>();
  const canManage = user?.role === 'admin' || user?.id === definition.ownerId;
  const needed = variableNames(`${definition.systemPrompt}\n${definition.userPrompt}`);
  const run = async () => { setBusy(true); try { const result = await runDefinition(id, variables); message.success(`已排队 ${result.runCount} 次运行，估计上限 $${result.estimatedMaxCostUsd.toFixed(6)}`); await load(); } catch (cause) { message.error(cause instanceof Error ? cause.message : '执行失败'); } finally { setBusy(false); } };
  const submitBatch = async () => { setBusy(true); try { const parsed = JSON.parse(batchInputs); if (!Array.isArray(parsed)) throw new Error('请输入变量对象数组'); const result = await runBatch(id, parsed); message.success(`已排队 ${result.runCount} 次运行`); await load(); } catch (cause) { message.error(cause instanceof Error ? cause.message : '批量执行失败'); } finally { setBusy(false); } };
  return <Space direction="vertical" size={20} style={{ width: '100%' }}>
    <Card title={definition.title} extra={<Link to="/experiments">返回实验列表</Link>}>
      <Descriptions column={{ xs: 1, md: 2 }} items={[{ key: 'task', label: '关联任务', children: definition.taskId ? <Link to={`/tasks/${definition.taskId}`}>打开任务</Link> : '无' }, { key: 'owner', label: '创建者', children: definition.ownerId }, { key: 'variants', label: '变体数', children: definition.variants.length }, { key: 'date', label: '创建时间', children: new Date(definition.createdAt).toLocaleString('zh-CN') }]} />
      <div className="task-detail-section"><h4>System Prompt</h4><MarkdownContent content={definition.systemPrompt || '无'} /></div>
      <div className="task-detail-section"><h4>User Prompt</h4><MarkdownContent content={definition.userPrompt || '无'} /></div>
      <Table size="small" rowKey="id" pagination={false} dataSource={definition.variants} columns={[{ title: '变体', dataIndex: 'label' }, { title: '模型 ID', dataIndex: 'modelId' }, { title: '参数', render: (_, row) => <Typography.Text code>{JSON.stringify(row.parameters)}</Typography.Text> }]} />
      {canManage && <><Typography.Title level={5} style={{ marginTop: 24 }}>运行输入</Typography.Title><Row gutter={12}>{needed.map(name => <Col span={12} key={name}><Form.Item label={name}><Input value={variables[name] || ''} onChange={event => setVariables(current => ({ ...current, [name]: event.target.value }))} /></Form.Item></Col>)}</Row><Button type="primary" loading={busy} disabled={needed.some(name => !variables[name]?.trim())} onClick={() => void run()}>运行全部变体</Button></>}
    </Card>
    {canManage && <Card title="A/B 批量输入"><Typography.Paragraph type="secondary">填写 JSON 数组，每个元素是一组变量。所有变体对每组输入各运行一次。</Typography.Paragraph><Input.TextArea rows={4} value={batchInputs} onChange={event => setBatchInputs(event.target.value)} /><Button style={{ marginTop: 12 }} loading={busy} onClick={() => void submitBatch()}>批量执行</Button></Card>}
    {definition.batches.map(batch => <BatchCard key={batch.id} batch={batch} canManage={canManage} onRetry={async () => { try { const result = await retryBatch(batch.id); message.success(`已重试 ${result.queued} 项`); await load(); } catch (cause) { message.error(cause instanceof Error ? cause.message : '重试失败'); } }} />)}
  </Space>;
}

function BatchCard({ batch, canManage, onRetry }: { batch: ExperimentBatch; canManage: boolean; onRetry: () => Promise<void> }) {
  const completed = batch.runs.filter(run => ['completed', 'failed'].includes(run.status)).length;
  return <Card title={`${batch.kind === 'ab' ? 'A/B 批次' : '运行批次'} · ${new Date(batch.createdAt).toLocaleString('zh-CN')}`} extra={<Space><Tag>{batch.status}</Tag>{canManage && batch.runs.some(run => run.status === 'failed') && <Button onClick={() => void onRetry()}>仅重试失败项</Button>}</Space>}>
    <Progress percent={batch.runs.length ? Math.round(completed / batch.runs.length * 100) : 0} format={() => `${completed}/${batch.runs.length}`} />
    {batch.kind === 'ab' && <Typography.Paragraph type="secondary">有效输入组 {batch.winRates.included}，排除失败或缺分组 {batch.winRates.excluded}；同分共享胜利。</Typography.Paragraph>}
    <Table rowKey="id" size="small" dataSource={batch.runs} scroll={{ x: 900 }} pagination={{ pageSize: 10 }} columns={[{ title: '输入组', dataIndex: 'inputIndex', render: value => value + 1 }, { title: '模型', dataIndex: 'apiModel' }, { title: '状态', dataIndex: 'status', render: value => <Tag color={value === 'completed' ? 'success' : value === 'failed' ? 'error' : 'processing'}>{value}</Tag> }, { title: '输出', render: (_, run: ExperimentRun) => run.output ? <div style={{ maxWidth: 500, maxHeight: 250, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{run.output}</div> : run.error || '等待运行' }, { title: '自动评分', dataIndex: 'autoScore', render: value => value === null ? '暂无数据' : value }, { title: 'Token', render: (_, run: ExperimentRun) => run.promptTokens === null ? '暂无数据' : `${run.promptTokens} / ${run.completionTokens}` }, { title: '延迟', dataIndex: 'latencyMs', render: value => value === null ? '暂无数据' : `${value} ms` }, { title: '成本', dataIndex: 'costUsd', render: value => value === null ? '暂无数据' : `$${Number(value).toFixed(6)}` }]} />
  </Card>;
}
