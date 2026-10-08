import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, InputNumber, Select, Space, Table, Typography } from 'antd';
import { getDatasetVersions, getEvaluationLeaderboard, listDatasets, listMetricVersions } from '../api/experiment-evaluation';
import type { Dataset, MetricVersion, RankedModel } from '../api/experiment-evaluation';
import { downloadBlob } from '../utils/noteExport';

const csvCell = (value: unknown) => { const text = String(value ?? ''); const safe = /^[=+@-]/.test(text) ? `'${text}` : text; return `"${safe.replaceAll('"','""')}"`; };
export default function EvaluationLeaderboard() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [versions, setVersions] = useState<{ id: string; version: number }[]>([]);
  const [metrics, setMetrics] = useState<MetricVersion[]>([]);
  const [datasetId, setDatasetId] = useState<string>();
  const [versionId, setVersionId] = useState<string>();
  const [metricId, setMetricId] = useState('default-v1');
  const [weights, setWeights] = useState({ accuracy: 40, latency: 30, tokens: 30 });
  const [items, setItems] = useState<RankedModel[]>([]);
  const [excluded, setExcluded] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => { void Promise.all([listDatasets(),listMetricVersions()]).then(([a,b]) => { setDatasets(a.items); setMetrics(b.items); }).catch(cause => setError(cause.message)); }, []);
  useEffect(() => { if (!datasetId) { setVersions([]); return; } void getDatasetVersions(datasetId).then(result => { setVersions(result.items); setVersionId(result.items[0]?.id); }).catch(cause => setError(cause.message)); }, [datasetId]);
  useEffect(() => {
    if (!versionId || !metricId) return;
    let active = true;
    const refresh = () => void getEvaluationLeaderboard(versionId,metricId,weights).then(result => { if (active) { setItems(result.items); setExcluded(result.excluded); setError(''); } }).catch(cause => { if (active) setError(cause.message); });
    refresh(); const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [versionId,metricId,weights]);
  const exportCsv = () => {
    const rows = [['排名','模型','综合分','运行数','平均自动评分','平均延迟 ms','平均输出 token'], ...items.map((item,index) => [index+1,item.apiModel,item.score.toFixed(4),item.runCount,item.averageAccuracy.toFixed(3),item.averageLatencyMs.toFixed(1),item.averageOutputTokens.toFixed(1)])];
    downloadBlob(new Blob([`\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), '评测模型排行榜.csv');
  };
  return <Card title="模型排行榜" extra={<Button disabled={!items.length} onClick={exportCsv}>导出 CSV</Button>}>
    <Typography.Paragraph type="secondary">仅比较相同数据集版本与指标版本；综合分使用指标版本保存的固定目标区间，不随参与模型重新缩放。</Typography.Paragraph>
    {error && <Alert type="error" showIcon message={error} />}
    <Space wrap><Form.Item label="数据集"><Select style={{ width: 180 }} value={datasetId} onChange={setDatasetId} options={datasets.map(item => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item label="版本"><Select style={{ width: 110 }} value={versionId} onChange={setVersionId} options={versions.map(item => ({ value: item.id, label: `v${item.version}` }))} /></Form.Item><Form.Item label="指标版本"><Select style={{ width: 180 }} value={metricId} onChange={setMetricId} options={metrics.map(item => ({ value: item.id, label: `${item.name} v${item.version}` }))} /></Form.Item></Space>
    <Space wrap>{([{ key: 'accuracy', label: '准确率' }, { key: 'latency', label: '延迟' }, { key: 'tokens', label: 'token 效率' }] as const).map(item => <Form.Item key={item.key} label={`${item.label}权重`}><InputNumber min={0} max={100} value={weights[item.key]} onChange={value => setWeights(previous => ({ ...previous, [item.key]: value ?? 0 }))} /></Form.Item>)}</Space>
    {excluded > 0 && <Alert type="info" showIcon message={`${excluded} 条运行缺少所选指标，未进入排名`} />}
    <Table rowKey="modelId" dataSource={items} columns={[{ title: '排名', render: (_, _item, index) => index + 1 }, { title: '模型', dataIndex: 'apiModel' }, { title: '综合分', render: (_, item) => item.score.toFixed(3) }, { title: '运行数', dataIndex: 'runCount' }, { title: '平均自动评分', render: (_, item) => item.averageAccuracy.toFixed(2) }, { title: '平均延迟', render: (_, item) => `${item.averageLatencyMs.toFixed(0)} ms` }, { title: '平均输出 token', render: (_, item) => item.averageOutputTokens.toFixed(0) }]} />
  </Card>;
}
