import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { listExperiments } from '../api/experiments';
import type { Experiment } from '../types';
import { getDefinition } from '../api/experiment-platform';
import type { ExperimentDefinition } from '../api/experiment-platform';
import { getDatasetVersions, listDatasets, listMetricVersions } from '../api/experiment-evaluation';
import type { Dataset, MetricVersion } from '../api/experiment-evaluation';
import { createEvaluationSchedule, deleteEvaluationSchedule, listEvaluationSchedules, runEvaluationScheduleNow, setEvaluationScheduleActive } from '../api/evaluationSchedules';
import type { EvaluationSchedule } from '../api/evaluationSchedules';

export default function EvaluationSchedules() {
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<EvaluationSchedule[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [definition, setDefinition] = useState<ExperimentDefinition>();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [versions, setVersions] = useState<{ id: string; version: number }[]>([]);
  const [metrics, setMetrics] = useState<MetricVersion[]>([]);
  const [experimentId, setExperimentId] = useState<string>();
  const [variantId, setVariantId] = useState<string>();
  const [datasetId, setDatasetId] = useState<string>();
  const [versionId, setVersionId] = useState<string>();
  const [metricId, setMetricId] = useState('default-v1');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [weekday, setWeekday] = useState(1);
  const [localTime, setLocalTime] = useState('09:00');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => listEvaluationSchedules().then(value => { setItems(value.items); setError(''); }).catch(cause => setError(cause.message)), []);
  useEffect(() => { void load(); void Promise.all([listExperiments(),listDatasets(),listMetricVersions()]).then(([a,b,c]) => { setExperiments(a.items.filter(item => item.recordKind === 'definition')); setDatasets(b.items); setMetrics(c.items); }).catch(cause => setError(cause.message)); }, [load]);
  useEffect(() => { if (!experimentId) return; void getDefinition(experimentId).then(value => { setDefinition(value); setVariantId(value.variants[0]?.id); }).catch(cause => setError(cause.message)); }, [experimentId]);
  useEffect(() => { if (!datasetId) return; void getDatasetVersions(datasetId).then(value => { setVersions(value.items); setVersionId(value.items[0]?.id); }).catch(cause => setError(cause.message)); }, [datasetId]);
  const save = async () => {
    if (!experimentId || !variantId || !versionId) return;
    setBusy(true);
    try { await createEvaluationSchedule({ experimentId,variantId,datasetVersionId:versionId,metricVersionId:metricId,frequency,localTime,...(frequency === 'weekly' ? { weekday } : {}) }); message.success('定时评测已创建'); setOpen(false); await load(); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '创建失败'); }
    finally { setBusy(false); }
  };
  const changeActive = async (item: EvaluationSchedule) => { try { await setEvaluationScheduleActive(item.id,!item.active); await load(); } catch (cause) { message.error(cause instanceof Error ? cause.message : '修改失败'); } };
  const remove = (item: EvaluationSchedule) => modal.confirm({ title: '删除评测调度？', content: '已生成的评测批次和报告会保留。', onOk: async () => { await deleteEvaluationSchedule(item.id); await load(); } });
  const runNow = async (item: EvaluationSchedule) => { try { const result = await runEvaluationScheduleNow(item.id); message.success(`已提交批次 ${result.batchId}`); } catch (cause) { message.error(cause instanceof Error ? cause.message : '提交失败'); } };
  return <Card title="定时评测调度" extra={<Space><Link to="/evaluation/leaderboard">排行榜</Link><Button type="primary" onClick={() => setOpen(true)}>新增调度</Button></Space>}>
    <Typography.Paragraph type="secondary">按账号 IANA 时区在固定日期和时间提交评测；本地服务持续运行时目标偏差小于五分钟，重启后按计划时间补建遗漏周期。</Typography.Paragraph>
    {error && <Alert type="error" showIcon message={error} />}
    <Table rowKey="id" dataSource={items} columns={[{ title: '实验', dataIndex: 'title' }, { title: '计划', render: (_, item) => `${item.frequency === 'daily' ? '每天' : `每周${['日','一','二','三','四','五','六'][item.weekday || 0]}`} ${item.local_time} (${item.time_zone})` }, { title: '下一次', render: (_, item) => new Date(item.next_run_at).toLocaleString() }, { title: '状态', render: (_, item) => <Tag color={item.active ? 'green' : 'default'}>{item.active ? '运行中' : '已暂停'}</Tag> }, { title: '操作', render: (_, item) => <Space wrap><Button type="link" onClick={() => void runNow(item)}>立即执行</Button><Button type="link" onClick={() => void changeActive(item)}>{item.active ? '暂停' : '恢复'}</Button><Button type="link" danger onClick={() => remove(item)}>删除</Button></Space> }]} />
    <Modal title="创建定时评测" open={open} onCancel={() => setOpen(false)} onOk={() => void save()} okButtonProps={{ loading: busy, disabled: !experimentId || !variantId || !versionId }}>
      <Form.Item label="实验"><Select value={experimentId} onChange={setExperimentId} options={experiments.map(item => ({ value: item.id, label: item.title }))} /></Form.Item>
      <Form.Item label="模型变体"><Select value={variantId} onChange={setVariantId} options={definition?.variants.map(item => ({ value: item.id!, label: item.label }))} /></Form.Item>
      <Form.Item label="数据集"><Select value={datasetId} onChange={setDatasetId} options={datasets.map(item => ({ value: item.id, label: item.name }))} /></Form.Item>
      <Form.Item label="数据集版本"><Select value={versionId} onChange={setVersionId} options={versions.map(item => ({ value: item.id, label: `v${item.version}` }))} /></Form.Item>
      <Form.Item label="指标版本"><Select value={metricId} onChange={setMetricId} options={metrics.map(item => ({ value: item.id, label: `${item.name} v${item.version}` }))} /></Form.Item>
      <Space><Form.Item label="频率"><Select value={frequency} onChange={setFrequency} style={{ width: 110 }} options={[{ value: 'daily', label: '每天' }, { value: 'weekly', label: '每周' }]} /></Form.Item>{frequency === 'weekly' && <Form.Item label="星期"><Select value={weekday} onChange={setWeekday} style={{ width: 100 }} options={['日','一','二','三','四','五','六'].map((label,value) => ({ value,label }))} /></Form.Item>}<Form.Item label="本地时间"><Input type="time" value={localTime} onChange={event => setLocalTime(event.target.value)} /></Form.Item></Space>
    </Modal>
  </Card>;
}
