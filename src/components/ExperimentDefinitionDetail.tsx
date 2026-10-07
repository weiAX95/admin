import { useCallback, useEffect, useState } from 'react';
import { App, Alert, Button, Card, Col, Descriptions, Form, Input, Progress, Rate, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { estimateDefinition, getDefinition, retryBatch, runBatch, runDefinition } from '../api/experiment-platform';
import type { ExperimentBatch, ExperimentDefinition, ExperimentRun } from '../api/experiment-platform';
import { getStoredUser, getToken } from '../api/client';
import type { AuthUser } from '../types';
import MarkdownContent from './MarkdownContent';
import { getRunAnnotation, saveRunAnnotation } from '../api/experiment-evaluation';
import ExperimentRegressionPanel from './ExperimentRegressionPanel';
import ExperimentChainLinks from './ExperimentChainLinks';
import ExperimentShareButton from './ExperimentShareButton';

const variableNames = (text: string) => [...new Set([...text.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)].map(match => match[1]))];
function GeneratedImage({assetId}:{assetId:string}) {
  const [url,setUrl]=useState('');
  useEffect(()=>{let active=true,objectUrl='';void fetch(`/api/prompt-media/${assetId}`,{headers:{Authorization:`Bearer ${getToken() || ''}`}}).then(response=>{if(!response.ok)throw new Error('图片读取失败');return response.blob();}).then(blob=>{if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(()=>{if(active)setUrl('');});return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[assetId]);
  return url?<img src={url} alt="模型生成图片" style={{maxWidth:260,maxHeight:220,objectFit:'contain'}} />:<Typography.Text type="secondary">图片加载中或不可用</Typography.Text>;
}
function GeneratedAudio({assetId}:{assetId:string}) {
  const [url,setUrl]=useState('');
  useEffect(()=>{let active=true,objectUrl='';void fetch(`/api/prompt-media/${assetId}`,{headers:{Authorization:`Bearer ${getToken() || ''}`}}).then(response=>{if(!response.ok)throw new Error('音频读取失败');return response.blob();}).then(blob=>{if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(()=>{if(active)setUrl('');});return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[assetId]);
  return url?<audio controls src={url} aria-label="模型生成音频" />:<Typography.Text type="secondary">音频加载中或不可用</Typography.Text>;
}
function RunOutput({run}:{run:ExperimentRun}) {
  const images=run.outputParts?.filter(part=>part.type==='image'&&part.assetId) || [];
  const audios=run.outputParts?.filter(part=>part.type==='audio'&&part.assetId) || [];
  if(!run.output && !images.length && !audios.length) return run.error || '等待运行';
  return <Space direction="vertical" style={{maxWidth:500,maxHeight:300,overflow:'auto'}}>{run.output&&<div style={{whiteSpace:'pre-wrap'}}>{run.output}</div>}{images.map(part=><GeneratedImage key={part.assetId} assetId={part.assetId!} />)}{audios.map(part=><GeneratedAudio key={part.assetId} assetId={part.assetId!} />)}</Space>;
}
export default function ExperimentDefinitionDetail({ id }: { id: string }) {
  const { message, modal } = App.useApp();
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
  const confirmQuote = (runCount: number, cost: number, remaining: number) => new Promise<boolean>(resolve => modal.confirm({ title: `确认提交 ${runCount} 次模型调用？`, content: `调用上限估算 $${cost.toFixed(6)}，当前剩余额度 $${remaining.toFixed(6)}。`, onOk: () => resolve(true), onCancel: () => resolve(false) }));
  const run = async () => { setBusy(true); try { const quote = await estimateDefinition(id, { kind: 'single', variables }); if (!await confirmQuote(quote.runCount, quote.estimatedMaxCostUsd, quote.remainingBudgetUsd)) return; const result = await runDefinition(id, variables); message.success(`已排队 ${result.runCount} 次运行`); await load(); } catch (cause) { message.error(cause instanceof Error ? cause.message : '执行失败'); } finally { setBusy(false); } };
  const submitBatch = async () => { setBusy(true); try { const parsed = JSON.parse(batchInputs); if (!Array.isArray(parsed)) throw new Error('请输入变量对象数组'); const quote = await estimateDefinition(id, { kind: 'ab', inputs: parsed }); if (!await confirmQuote(quote.runCount, quote.estimatedMaxCostUsd, quote.remainingBudgetUsd)) return; const result = await runBatch(id, parsed); message.success(`已排队 ${result.runCount} 次运行`); await load(); } catch (cause) { message.error(cause instanceof Error ? cause.message : '批量执行失败'); } finally { setBusy(false); } };
  return <Space direction="vertical" size={20} style={{ width: '100%' }}>
    <Card title={definition.title} extra={<Space>{canManage && <><ExperimentShareButton id={definition.id}/><Link to={`/experiments/schedules?experimentId=${definition.id}`}>定时执行</Link></>}<Link to="/experiments">返回实验列表</Link></Space>}>
      <Descriptions column={{ xs: 1, md: 2 }} items={[{ key: 'task', label: '关联任务', children: definition.taskId ? <Link to={`/tasks/${definition.taskId}`}>打开任务</Link> : '无' }, { key: 'owner', label: '创建者', children: definition.ownerId }, { key: 'variants', label: '变体数', children: definition.variants.length }, { key: 'date', label: '创建时间', children: new Date(definition.createdAt).toLocaleString('zh-CN') }, { key: 'cost', label: '累计成本', children: `$${Number(definition.cumulativeCostUsd).toFixed(6)}` }]} />
      <div className="task-detail-section"><h4>System Prompt</h4><MarkdownContent content={definition.systemPrompt || '无'} /></div>
      <div className="task-detail-section"><h4>User Prompt</h4><MarkdownContent content={definition.userPrompt || '无'} /></div>
      <Table size="small" rowKey="id" pagination={false} dataSource={definition.variants} columns={[{ title: '变体', dataIndex: 'label' }, { title: '模型 ID', dataIndex: 'modelId' }, { title: '参数', render: (_, row) => <Typography.Text code>{JSON.stringify(row.parameters)}</Typography.Text> }]} />
      {canManage && <><Typography.Title level={5} style={{ marginTop: 24 }}>运行输入</Typography.Title><Row gutter={12}>{needed.map(name => <Col span={12} key={name}><Form.Item label={name}><Input value={variables[name] || ''} onChange={event => setVariables(current => ({ ...current, [name]: event.target.value }))} /></Form.Item></Col>)}</Row><Button type="primary" loading={busy} disabled={needed.some(name => !variables[name]?.trim())} onClick={() => void run()}>运行全部变体</Button></>}
    </Card>
    {canManage && <Card title="A/B 批量输入"><Typography.Paragraph type="secondary">填写 JSON 数组，每个元素是一组变量。所有变体对每组输入各运行一次。</Typography.Paragraph><Input.TextArea rows={4} value={batchInputs} onChange={event => setBatchInputs(event.target.value)} /><Button style={{ marginTop: 12 }} loading={busy} onClick={() => void submitBatch()}>批量执行</Button></Card>}
    {canManage && <ExperimentRegressionPanel definition={definition} onStarted={() => void load()} />}
    <ExperimentChainLinks definition={definition} canManage={canManage} onUpdated={() => void load()} />
    {definition.batches.some(batch => batch.kind === 'regression') && <Card title="回归报告"><Space wrap>{definition.batches.filter(batch => batch.kind === 'regression').map(batch => <Link key={batch.id} to={`/experiments/reports/${batch.id}`}>{new Date(batch.createdAt).toLocaleString('zh-CN')} · {batch.status}</Link>)}</Space></Card>}
    {definition.batches.map(batch => <BatchCard key={batch.id} batch={batch} canManage={canManage} onRetry={async () => { try { const result = await retryBatch(batch.id); message.success(`已重试 ${result.queued} 项`); await load(); } catch (cause) { message.error(cause instanceof Error ? cause.message : '重试失败'); } }} />)}
  </Space>;
}

function BatchCard({ batch, canManage, onRetry }: { batch: ExperimentBatch; canManage: boolean; onRetry: () => Promise<void> }) {
  const completed = batch.runs.filter(run => ['completed', 'failed'].includes(run.status)).length;
  return <Card title={`${batch.kind === 'ab' ? 'A/B 批次' : '运行批次'} · ${new Date(batch.createdAt).toLocaleString('zh-CN')}`} extra={<Space><Tag>{batch.status}</Tag>{canManage && batch.runs.some(run => run.status === 'failed') && <Button onClick={() => void onRetry()}>仅重试失败项</Button>}</Space>}>
    <Progress percent={batch.runs.length ? Math.round(completed / batch.runs.length * 100) : 0} format={() => `${completed}/${batch.runs.length}`} />
    {batch.kind === 'ab' && <Typography.Paragraph type="secondary">有效输入组 {batch.winRates.included}，排除失败或缺分组 {batch.winRates.excluded}；同分共享胜利。{batch.winRates.variants.map(item => ` ${batch.runs.find(run => run.variantId === item.variantId)?.apiModel}: ${(item.rate * 100).toFixed(1)}%`).join('；')}</Typography.Paragraph>}
    <Table rowKey="id" size="small" dataSource={batch.runs} scroll={{ x: 900 }} pagination={{ pageSize: 10 }} expandable={{ expandedRowRender: run => run.status === 'completed' ? <RunAnnotation run={run} /> : null, rowExpandable: run => run.status === 'completed' }} columns={[{ title: '输入组', dataIndex: 'inputIndex', render: value => value + 1 }, { title: '模型', dataIndex: 'apiModel' }, { title: '状态', dataIndex: 'status', render: value => <Tag color={value === 'completed' ? 'success' : value === 'failed' ? 'error' : 'processing'}>{value}</Tag> }, { title: '输出', render: (_, run: ExperimentRun) => <RunOutput run={run} /> }, { title: '自动评分', dataIndex: 'autoScore', render: value => value === null ? '暂无数据' : value }, { title: 'Token', render: (_, run: ExperimentRun) => run.promptTokens === null ? '暂无数据' : `${run.promptTokens} / ${run.completionTokens}` }, { title: '延迟', dataIndex: 'latencyMs', render: value => value === null ? '暂无数据' : `${value} ms` }, { title: '成本', dataIndex: 'costUsd', render: value => value === null ? '暂无数据' : `$${Number(value).toFixed(6)}` }]} />
  </Card>;
}

const annotationTags = ['幻觉','不完整','格式错误','推理错误','完美','偏题','冗余'];
function RunAnnotation({ run }: { run: ExperimentRun }) {
  const { message } = App.useApp();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [summary, setSummary] = useState<{ averageRating: number | null; ratingCount: number; tags: { tag: string; count: number }[] } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void getRunAnnotation(run.id).then(value => { setRating(value.mine?.rating || 0); setTags(value.mine?.tags || []); setSummary(value.summary); }).catch(() => undefined); }, [run.id]);
  const save = async (nextRating: number, nextTags: string[]) => {
    if (!nextRating) { setTags(nextTags); return; }
    const previous = { rating, tags };
    setRating(nextRating); setTags(nextTags); setSaving(true);
    try { await saveRunAnnotation(run.id, nextRating, nextTags); const result = await getRunAnnotation(run.id); setSummary(result.summary); message.success('标注已保存'); }
    catch (error) { setRating(previous.rating); setTags(previous.tags); message.error(error instanceof Error ? error.message : '标注保存失败'); }
    finally { setSaving(false); }
  };
  return <Space direction="vertical" style={{ width: '100%' }}><Typography.Text strong>人工标注（与自动评分独立）</Typography.Text><Space wrap><Rate value={rating} disabled={saving} onChange={value => void save(value, tags)} /><Select mode="multiple" style={{ minWidth: 300 }} disabled={saving} value={tags} options={annotationTags.map(tag => ({ value: tag, label: tag }))} onChange={value => void save(rating, value)} placeholder="选择标签" /></Space><Typography.Text type="secondary">平均 {summary?.averageRating === null || !summary ? '暂无评分' : `${summary.averageRating.toFixed(1)} / 5`} · {summary?.ratingCount || 0} 人</Typography.Text><Space wrap>{summary?.tags.map(item => <Tag key={item.tag}>{item.tag} {item.count}</Tag>)}</Space></Space>;
}
