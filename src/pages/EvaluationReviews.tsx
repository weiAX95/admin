import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Empty, Form, InputNumber, Modal, Select, Space, Table, Tag, Typography, theme } from 'antd';
import { listAccounts } from '../api/accounts';
import { assignAdjudicator, createReviewTask, getReviewInbox, getReviewReport, listReviewableBatches, listReviewTasks, saveReviewScore } from '../api/evaluationReviews';
import type { ReviewInbox, ReviewReport, ReviewTask } from '../api/evaluationReviews';
import type { Account } from '../types';
import { getStoredUser } from '../api/client';

const dimensions = [{ key: 'accuracy', label: '准确性' }, { key: 'completeness', label: '完整性' }, { key: 'brevity', label: '简洁性' }, { key: 'safety', label: '安全性' }] as const;
type Score = { accuracy: number; completeness: number; brevity: number; safety: number; tags: string[] };
const initialScore: Score = { accuracy: 5, completeness: 5, brevity: 5, safety: 5, tags: [] };

export default function EvaluationReviews() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const admin = getStoredUser<Account>()?.role === 'admin';
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [batches, setBatches] = useState<{ id: string; title: string; dataset_version_id: string }[]>([]);
  const [selected, setSelected] = useState<string>();
  const [inbox, setInbox] = useState<ReviewInbox>();
  const [report, setReport] = useState<ReviewReport>();
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [batchId, setBatchId] = useState<string>();
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [rubricTags, setRubricTags] = useState<string[]>([]);
  const [score, setScore] = useState<Score>(initialScore);
  const [busy, setBusy] = useState(false);
  const [adjudicatorId, setAdjudicatorId] = useState<string>();
  const load = useCallback(() => listReviewTasks().then(value => { setTasks(value.items); setError(''); }).catch(cause => setError(cause.message)), []);
  useEffect(() => { void load(); if (admin) void Promise.all([listAccounts(), listReviewableBatches()]).then(([users, available]) => { setAccounts(users.items); setBatches(available.items); }).catch(cause => setError(cause.message)); }, [admin, load]);
  const openTask = async (id: string) => {
    setSelected(id); setInbox(undefined); setReport(undefined);
    try { const result = await getReviewInbox(id); setInbox(result); } catch (cause) { if (!admin) setError(cause instanceof Error ? cause.message : '加载任务失败'); }
    if (admin) try { setReport(await getReviewReport(id)); } catch { /* Only assigned administrators can also score. */ }
  };
  const refreshTask = async (id: string) => {
    try { setInbox(await getReviewInbox(id)); } catch { if (!admin) throw new Error('加载待评条目失败'); }
    if (admin) setReport(await getReviewReport(id));
  };
  const submit = async () => {
    if (!selected || !inbox?.items[0]) return;
    setBusy(true);
    try { await saveReviewScore(selected, inbox.items[0].run_id, score); message.success('评分已保存'); setScore(initialScore); await refreshTask(selected); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '评分失败'); }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (!batchId || reviewerIds.length !== 2) return;
    setBusy(true);
    try { await createReviewTask(batchId, reviewerIds, rubricTags); message.success('评测任务已创建'); setCreating(false); await load(); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '创建失败'); }
    finally { setBusy(false); }
  };
  const current = inbox?.items[0];
  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    <Card title="双盲人工评测" extra={admin && <Button type="primary" onClick={() => setCreating(true)}>创建评测任务</Button>}>
      <Typography.Paragraph type="secondary">两位评测员独立提交四维 0–10 分；任一维度相差至少 3 分的用例等待第三人仲裁。评测员只看到自己尚未评分的条目。</Typography.Paragraph>
      {error && <Alert showIcon type="error" message={error} closable onClose={() => setError('')} />}
      <Table rowKey="id" dataSource={tasks} pagination={{ pageSize: 10 }} columns={[{ title: '实验', dataIndex: 'experiment_title' }, { title: '批次状态', render: (_, task) => <Tag>{task.batch_status}</Tag> }, { title: '创建时间', render: (_, task) => new Date(task.created_at).toLocaleString() }, { title: '操作', render: (_, task) => <Button type="link" onClick={() => void openTask(task.id)}>打开任务</Button> }]} />
    </Card>
    {selected && <Card title="我的待评条目" extra={<Button onClick={() => void refreshTask(selected)}>刷新</Button>}>
      {!inbox ? <Typography.Text>{admin && report ? '你未作为评测员参与此任务，可查看下方一致性报告。' : '正在读取任务…'}</Typography.Text> : !current ? <Empty description="当前没有待评分条目" /> : <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text>用例 {current.case_key} · 尚余 {inbox.items.length} 条 · {inbox.role === 'adjudicator' ? '仲裁员' : '评测员'}</Typography.Text>
        <Card size="small" title="输入">{current.input_payload?.parts.map((part, index) => <Typography.Paragraph key={index}>{part.type === 'text' ? part.text : `[${part.type} 附件]`}</Typography.Paragraph>) || '旧版输入见实验运行记录'}</Card>
        <Card size="small" title="参考答案">{current.expected_payload?.parts?.map((part, index) => <Typography.Paragraph key={index}>{part.type === 'text' ? part.text : `[${part.type} 附件]`}</Typography.Paragraph>) || current.reference_answer || '未提供'}</Card>
        <Card size="small" title="模型输出"><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{current.output || '无文本输出，请查看媒体或工具结果'}</Typography.Paragraph></Card>
        <Space wrap>{dimensions.map(dimension => <Form.Item key={dimension.key} label={`${dimension.label}（0–10）`}><InputNumber min={0} max={10} precision={0} value={score[dimension.key]} onChange={value => setScore(previous => ({ ...previous, [dimension.key]: value ?? 0 }))} /></Form.Item>)}</Space>
        <Select mode="multiple" aria-label="评测标签" placeholder="可选标签" value={score.tags} onChange={tags => setScore(previous => ({ ...previous, tags }))} options={inbox.rubric.tags.map(tag => ({ value: tag, label: tag }))} style={{ width: '100%' }} />
        <Button type="primary" loading={busy} onClick={() => void submit()}>提交并评下一条</Button>
      </Space>}
    </Card>}
    {selected && admin && report && <Card title="管理员一致性报告">
      <Space wrap><Tag>已完成双人评分 {report.reviewedPairs} 条</Tag><Tag color={report.qualityWarning ? 'orange' : 'green'}>总体 Kappa：{report.overallKappa === null ? '暂无数据' : report.overallKappa.toFixed(3)}</Tag><Tag color="orange">待仲裁 {report.disputes.filter(item => !item.adjudicated).length} 条</Tag></Space>
      <Table style={{ marginTop: 16 }} rowKey="dimension" pagination={false} dataSource={dimensions.map(dimension => ({ dimension: dimension.label, value: report.kappa[dimension.key] }))} columns={[{ title: '维度', dataIndex: 'dimension' }, { title: '二次加权 Kappa', render: (_, row) => row.value === null ? '暂无数据' : row.value.toFixed(3) }]} />
      <Typography.Title level={5}>Kappa 分维度分布</Typography.Title>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12}}>{dimensions.map(dimension=>{const value=report.kappa[dimension.key];return <div key={dimension.key} title={`${dimension.label} Kappa：${value===null?'暂无数据':value.toFixed(3)}`}><Typography.Text>{dimension.label} · {value===null?'—':value.toFixed(3)}</Typography.Text><div style={{height:12,marginTop:6,background:token.colorFillSecondary,borderRadius:6}}><div style={{height:'100%',width:`${Math.max(0,Math.min(100,(value??0)*100))}%`,background:value!==null&&value<0.6?token.colorWarning:token.colorPrimary,borderRadius:6}} /></div></div>})}</div>
      <Typography.Title level={5} style={{marginTop:20}}>评分分布</Typography.Title>
      <div style={{display:'grid',gridTemplateColumns:'repeat(11,minmax(0,1fr))',gap:5,alignItems:'end',height:120}}>{report.distribution.map(item=><div key={item.score} title={`${item.score} 分：${item.count} 条`} style={{height:'100%',display:'flex',flexDirection:'column',justifyContent:'end',textAlign:'center'}}><div style={{minHeight:item.count?3:0,height:`${report.reviewedPairs?item.count/report.reviewedPairs*85:0}%`,background:token.colorPrimary,borderRadius:3}}/><Typography.Text style={{fontSize:11}}>{item.score}</Typography.Text></div>)}</div>
      <Typography.Title level={5}>争议条目</Typography.Title><Table size="small" rowKey="runId" pagination={{ pageSize: 10 }} dataSource={report.disputes} columns={[{ title: '运行 ID', dataIndex: 'runId' }, { title: '差异维度', render: (_, item) => item.dimensions.join('、') }, { title: '状态', render: (_, item) => item.adjudicated ? '已仲裁' : '待仲裁' }]} />
      {report.disputes.some(item => !item.adjudicated) && <Space><Select aria-label="选择仲裁员" value={adjudicatorId} onChange={setAdjudicatorId} style={{ width: 240 }} options={accounts.filter(account => account.status === 'active').map(account => ({ value: account.id, label: account.name }))} /><Button disabled={!adjudicatorId} onClick={() => { if (!adjudicatorId) return; void assignAdjudicator(selected, adjudicatorId).then(() => { message.success('仲裁员已指派'); return refreshTask(selected); }).catch(cause => message.error(cause.message)); }}>指派仲裁员</Button></Space>}
    </Card>}
    <Modal title="创建双盲评测任务" open={creating} onCancel={() => setCreating(false)} onOk={() => void create()} okButtonProps={{ disabled: !batchId || reviewerIds.length !== 2, loading: busy }}>
      <Form.Item label="已完成批次"><Select value={batchId} onChange={setBatchId} options={batches.map(batch => ({ value: batch.id, label: `${batch.title} · ${batch.id.slice(0, 8)}` }))} /></Form.Item>
      <Form.Item label="两位评测员"><Select mode="multiple" maxCount={2} value={reviewerIds} onChange={setReviewerIds} options={accounts.filter(account => account.status === 'active').map(account => ({ value: account.id, label: account.name }))} /></Form.Item>
      <Form.Item label="可选标签"><Select mode="tags" value={rubricTags} onChange={setRubricTags} /></Form.Item>
      <Typography.Text type="secondary">维度：准确性、完整性、简洁性、安全性。双方提交前不会向评测员展示对方评分。</Typography.Text>
    </Modal>
  </Space>;
}
