import { useEffect, useState } from 'react';
import { App, Button, Card, Form, Select, Space, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { getDatasetVersions, listBaselines, listDatasets, listMetricVersions, runDataset, runRegression } from '../api/experiment-evaluation';
import type { Dataset, MetricVersion } from '../api/experiment-evaluation';
import type { ExperimentDefinition } from '../api/experiment-platform';
import { estimateDefinition } from '../api/experiment-platform';

export default function ExperimentRegressionPanel({ definition, onStarted }: { definition: ExperimentDefinition; onStarted: () => void }) {
  const { message, modal } = App.useApp();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [metrics, setMetrics] = useState<MetricVersion[]>([]);
  const [datasetId, setDatasetId] = useState<string>();
  const [versionId, setVersionId] = useState<string>();
  const [versions, setVersions] = useState<{ id: string; version: number }[]>([]);
  const [metricId, setMetricId] = useState('default-v1');
  const [baselineId, setBaselineId] = useState<string>();
  const [baselines, setBaselines] = useState<{ id: string; experiment_title: string; created_at: string }[]>([]);
  const [variantId, setVariantId] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { void Promise.all([listDatasets(), listMetricVersions()]).then(([a,b]) => { setDatasets(a.items); setMetrics(b.items); }).catch(() => undefined); }, []);
  useEffect(() => { if (!datasetId) { setVersions([]); return; } void getDatasetVersions(datasetId).then(value => { setVersions(value.items); setVersionId(value.items[0]?.id); }); }, [datasetId]);
  useEffect(() => { if (!versionId || !metricId) return; void listBaselines(versionId, metricId).then(value => setBaselines(value.items)).catch(() => setBaselines([])); }, [versionId, metricId]);
  const run = async (regression: boolean) => {
    if (!versionId || !variantId) { message.warning('请选择数据集版本和变体'); return; }
    if (regression && !baselineId) { message.warning('请选择可比的固定 baseline'); return; }
    setBusy(true);
    try {
      const payload = { datasetVersionId: versionId, metricVersionId: metricId, variantIds: [variantId] };
      const quote = await estimateDefinition(definition.id, { ...payload, kind: regression ? 'regression' : 'dataset', ...(regression ? { baselineBatchId: baselineId } : {}) });
      const confirmed = await new Promise<boolean>(resolve => modal.confirm({ title: `确认提交 ${quote.runCount} 次评测调用？`, content: `调用上限估算 $${quote.estimatedMaxCostUsd.toFixed(6)}；剩余额度 $${quote.remainingBudgetUsd.toFixed(6)}。`, onOk: () => resolve(true), onCancel: () => resolve(false) }));
      if (!confirmed) return;
      const result = regression ? await runRegression(definition.id, { ...payload, baselineBatchId: baselineId! }) : await runDataset(definition.id, payload);
      message.success(`已创建评测批次 ${result.batchId}`); onStarted();
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '执行失败'); }
    finally { setBusy(false); }
  };
  return <Card title="版本化数据集评测与回归" extra={<Link to="/experiments/datasets">管理数据集</Link>}>
    <Typography.Paragraph type="secondary">先运行一次数据集评测作为 baseline，再选同版本数据集、指标和固定 baseline 执行回归。每个 baseline 用例只允许一条有效评分。</Typography.Paragraph>
    <Space wrap size={12}>
      <Form.Item label="数据集"><Select style={{ width: 180 }} value={datasetId} onChange={value => { setDatasetId(value); setBaselineId(undefined); }} options={datasets.map(item => ({ value: item.id, label: item.name }))} /></Form.Item>
      <Form.Item label="版本"><Select style={{ width: 120 }} value={versionId} onChange={value => { setVersionId(value); setBaselineId(undefined); }} options={versions.map(item => ({ value: item.id, label: `v${item.version}` }))} /></Form.Item>
      <Form.Item label="指标版本"><Select style={{ width: 180 }} value={metricId} onChange={value => { setMetricId(value); setBaselineId(undefined); }} options={metrics.map(item => ({ value: item.id, label: `${item.name} v${item.version}` }))} /></Form.Item>
      <Form.Item label="变体"><Select style={{ width: 180 }} value={variantId} onChange={setVariantId} options={definition.variants.map(item => ({ value: item.id!, label: item.label }))} /></Form.Item>
    </Space>
    <div><Button loading={busy} disabled={!versionId || !variantId} onClick={() => void run(false)}>建立 baseline 运行</Button></div>
    <Space wrap style={{ marginTop: 14 }}><Select style={{ width: 340 }} placeholder="固定 baseline" value={baselineId} onChange={setBaselineId} options={baselines.map(item => ({ value: item.id, label: `${item.experiment_title} · ${new Date(item.created_at).toLocaleString('zh-CN')}` }))} /><Button type="primary" loading={busy} disabled={!baselineId || !variantId} onClick={() => void run(true)}>执行回归</Button></Space>
  </Card>;
}
