import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { listDatasets } from '../api/experiment-evaluation';
import type { Dataset } from '../api/experiment-evaluation';
import { listEvaluationCandidates, publishEvaluationCandidates, reviewEvaluationCandidate } from '../api/evaluationCandidates';
import type { EvaluationCandidate } from '../api/evaluationCandidates';

const show = (value: EvaluationCandidate['input_payload']) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const parse = (value: string) => value.trim().startsWith('{') ? JSON.parse(value) as unknown : value;
export default function EvaluationCandidates() {
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<EvaluationCandidate[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [candidate, setCandidate] = useState<EvaluationCandidate>();
  const [targetId, setTargetId] = useState<string>();
  const [input, setInput] = useState('');
  const [expected, setExpected] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => listEvaluationCandidates(status, page).then(result => { setItems(result.items); setError(''); }).catch(cause => setError(cause.message)), [status, page]);
  useEffect(() => { void load(); void listDatasets().then(result => setDatasets(result.items)).catch(cause => setError(cause.message)); }, [load]);
  const open = (item: EvaluationCandidate) => { setCandidate(item); setInput(show(item.input_payload)); setExpected(show(item.expected_payload)); setTargetId(item.target_dataset_id || undefined); };
  const review = async (decision: 'staged' | 'rejected') => {
    if (!candidate) return;
    setBusy(true);
    try {
      await reviewEvaluationCandidate(candidate.id, { status: decision, datasetId: targetId, input: parse(input), expectedOutput: parse(expected) });
      message.success(decision === 'staged' ? '已加入待发布区' : '已拒绝候选'); setCandidate(undefined); await load();
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '审核失败'); }
    finally { setBusy(false); }
  };
  const publish = (datasetId: string) => modal.confirm({ title: '发布待审核用例为新版本？', content: '将该数据集的全部待发布候选追加到最新版本，原版本不会改写。', onOk: async () => { const result = await publishEvaluationCandidates(datasetId); message.success(`已发布 ${result.published} 条，版本 ${result.versionId}`); await load(); } });
  return <Card title="评测候选池" extra={<Space><Link to="/experiments/datasets">管理数据集</Link><Link to="/evaluation/reviews">人工评测</Link></Space>}>
    <Typography.Paragraph type="secondary">会话与实验的 4–5 星反馈进入待审核区。审核后批量发布到选定数据集，生成新的不可变版本。</Typography.Paragraph>
    {error && <Alert type="error" showIcon message={error} />}
    <Space wrap style={{ marginBottom: 16 }}><Select value={status} onChange={value => { setStatus(value); setPage(1); }} style={{ width: 160 }} options={['pending','staged','published','rejected','ineligible'].map(value => ({ value, label: ({ pending: '待审核', staged: '待发布', published: '已发布', rejected: '已拒绝', ineligible: '评分不足' } as Record<string,string>)[value] }))} />{status === 'staged' && datasets.map(dataset => items.some(item => item.target_dataset_id === dataset.id) && <Button key={dataset.id} type="primary" onClick={() => publish(dataset.id)}>发布至 {dataset.name}</Button>)}</Space>
    <Table rowKey="id" dataSource={items} pagination={false} columns={[{ title: '来源', render: (_, item) => <Tag>{item.source_type === 'session' ? '会话' : '实验'}</Tag> }, { title: '评分', render: (_, item) => `${item.rating} 星` }, { title: '输入', render: (_, item) => show(item.input_payload).slice(0, 120) }, { title: '候选答案', render: (_, item) => show(item.expected_payload).slice(0, 120) }, { title: '目标数据集', render: (_, item) => datasets.find(dataset => dataset.id === item.target_dataset_id)?.name || '—' }, { title: '操作', render: (_, item) => item.status === 'pending' ? <Button type="link" onClick={() => open(item)}>审核</Button> : <Tag>{item.status}</Tag> }]} />
    <Space style={{ marginTop: 12 }}><Button disabled={page === 1} onClick={() => setPage(previous => previous - 1)}>上一页</Button><Typography.Text>第 {page} 页</Typography.Text><Button disabled={items.length < 50} onClick={() => setPage(previous => previous + 1)}>下一页</Button></Space>
    <Modal title="审核候选用例" open={Boolean(candidate)} onCancel={() => setCandidate(undefined)} footer={<Space><Button onClick={() => setCandidate(undefined)}>取消</Button><Button danger loading={busy} onClick={() => void review('rejected')}>拒绝</Button><Button type="primary" loading={busy} disabled={!targetId} onClick={() => void review('staged')}>通过并暂存</Button></Space>} width={720}>
      <Typography.Paragraph>原始来源：{candidate?.source_type} · {candidate?.source_entity_id}</Typography.Paragraph>
      <Typography.Text>输入</Typography.Text><Input.TextArea rows={5} value={input} onChange={event => setInput(event.target.value)} />
      <Typography.Text>参考答案</Typography.Text><Input.TextArea rows={5} value={expected} onChange={event => setExpected(event.target.value)} />
      <Typography.Text>目标数据集</Typography.Text><Select style={{ width: '100%' }} value={targetId} onChange={setTargetId} options={datasets.map(dataset => ({ value: dataset.id, label: dataset.name }))} />
    </Modal>
  </Card>;
}
