import { useCallback, useEffect, useState } from 'react';
import { App, Alert, Button, Card, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { createDataset, createDatasetVersion, getDatasetVersions, listDatasets } from '../api/experiment-evaluation';
import type { Dataset, DatasetCase } from '../api/experiment-evaluation';

const example = JSON.stringify([{ caseKey: 'case-1', variables: { question: '解释 ReAct' }, referenceAnswer: 'ReAct 将思考与行动交替进行', difficulty: '基础', category: 'Agent' }], null, 2);
export default function ExperimentDatasets() {
  const { message } = App.useApp();
  const [items, setItems] = useState<Dataset[]>([]);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Dataset | 'new' | null>(null);
  const [name, setName] = useState('');
  const [casesText, setCasesText] = useState(example);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<Record<string, { id: string; version: number }[]>>({});
  const load = useCallback(() => listDatasets().then(value => { setItems(value.items); setError(''); }).catch(cause => setError(cause instanceof Error ? cause.message : '加载失败')), []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setBusy(true);
    try {
      const cases = JSON.parse(casesText) as DatasetCase[];
      if (!Array.isArray(cases)) throw new Error('用例须为 JSON 数组');
      if (target === 'new') await createDataset(name, cases);
      else if (target) await createDatasetVersion(target.id, cases);
      message.success('数据集版本已保存'); setTarget(null); await load();
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  };
  return <Card title="版本化评测数据集" extra={<Space><Link to="/experiments">返回实验</Link><Button type="primary" onClick={() => { setName(''); setCasesText(example); setTarget('new'); }}>新建数据集</Button></Space>}>
    <Typography.Paragraph type="secondary">每个版本保存不可变的用例 ID、变量、参考答案、难度和分类。评测运行与 baseline 必须使用相同的数据集和指标版本。</Typography.Paragraph>
    {error && <Alert type="error" message={error} showIcon />}
    <Table rowKey="id" dataSource={items} columns={[{ title: '名称', dataIndex: 'name' }, { title: '最新版本', render: (_, item) => <Tag>v{item.latest_version}</Tag> }, { title: '操作', render: (_, item) => <Space><Button type="link" onClick={() => { void getDatasetVersions(item.id).then(value => setVersions(current => ({ ...current, [item.id]: value.items }))); }}>查看版本</Button><Button type="link" onClick={() => { setTarget(item); setCasesText(example); }}>新增版本</Button></Space> }]} expandable={{ rowExpandable: row => Boolean(versions[row.id]), expandedRowRender: row => <Space wrap>{versions[row.id]?.map(version => <Tag key={version.id}>v{version.version} · {version.id}</Tag>)}</Space> }} />
    <Modal title={target === 'new' ? '新建评测数据集' : '新增不可变版本'} open={Boolean(target)} onCancel={() => setTarget(null)} onOk={() => void save()} okButtonProps={{ loading: busy }} width={720}>
      {target === 'new' && <Form.Item label="数据集名称"><Input value={name} onChange={event => setName(event.target.value)} /></Form.Item>}
      <Form.Item label="用例 JSON"><Input.TextArea rows={14} value={casesText} onChange={event => setCasesText(event.target.value)} /></Form.Item>
      <Typography.Text type="secondary">字段：caseKey、variables、referenceAnswer、difficulty、category。保存后版本不可修改。</Typography.Text>
    </Modal>
  </Card>;
}
