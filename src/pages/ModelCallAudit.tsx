import { useEffect, useState } from 'react';
import { Alert, Card, DatePicker, Select, Space, Table, Tag, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { listAccounts } from '../api/accounts';
import { getPlatformConfig } from '../api/experiment-platform';
import { listModelCallAudit, type ModelCallAuditItem } from '../api/model-call-audit';

export default function ModelCallAudit() {
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [modelId, setModelId] = useState('');
  const [userId, setUserId] = useState('');
  const [module, setModule] = useState('');
  const [page, setPage] = useState(1);
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; username: string }[]>([]);
  const [items, setItems] = useState<ModelCallAuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void Promise.all([getPlatformConfig(), listAccounts()]).then(([catalog, accounts]) => { setModels(catalog.models); setUsers(accounts.items); }).catch(cause => setError(cause.message)); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void listModelCallAudit({ start: range[0]?.format('YYYY-MM-DD'), end: range[1]?.format('YYYY-MM-DD'), modelId, userId, module, page }).then(value => { if (active) { setItems(value.items); setTotal(value.total); setError(''); } }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range, modelId, userId, module, page]);
  return <Card title="模型调用审计">
    <Typography.Paragraph type="secondary">记录经过本服务的实验与评测主模型、Judge 实际调用。预览仅保留脱敏后的前 200 字；聊天端会话尚未上报模型调用事实。</Typography.Paragraph>
    <Space wrap style={{ marginBottom: 16 }}>
      <DatePicker.RangePicker value={range} onChange={value => { setRange(value || [null, null]); setPage(1); }} />
      <Select aria-label="筛选模型" value={modelId} onChange={value => { setModelId(value); setPage(1); }} style={{ width: 180 }} options={[{ value: '', label: '全部模型' }, ...models.map(item => ({ value: item.id, label: item.displayName }))]} />
      <Select aria-label="筛选账号" value={userId} onChange={value => { setUserId(value); setPage(1); }} style={{ width: 160 }} options={[{ value: '', label: '全部账号' }, ...users.map(item => ({ value: item.id, label: item.username }))]} />
      <Select aria-label="筛选模块" value={module} onChange={value => { setModule(value); setPage(1); }} style={{ width: 150 }} options={[{ value: '', label: '全部模块' }, { value: 'experiments', label: '实验' }, { value: 'evaluations', label: '评测' }, { value: 'project_analysis', label: '项目分析' }]} />
    </Space>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Table rowKey="requestId" loading={loading} dataSource={items} scroll={{ x: 1050 }} pagination={{ current: page, pageSize: 100, total, showSizeChanger: false, onChange: setPage }} columns={[
      { title: '时间', dataIndex: 'createdAt', width: 165, render: value => new Date(value).toLocaleString('zh-CN') },
      { title: '请求 ID', dataIndex: 'requestId', width: 155, ellipsis: true },
      { title: '模型 / 环节', width: 170, render: (_, item) => <Space><span>{item.modelName}</span><Tag>{item.phase === 'judge' ? 'Judge' : '主模型'}</Tag></Space> },
      { title: '账号', dataIndex: 'userName', width: 100 },
      { title: '模块', dataIndex: 'module', width: 80, render: value => value === 'evaluations' ? '评测' : value === 'project_analysis' ? '项目分析' : '实验' },
      { title: '提示词预览', dataIndex: 'promptPreview', width: 220, ellipsis: true },
      { title: 'Token', width: 100, render: (_, item) => item.promptTokens === null ? '—' : `${item.promptTokens} / ${item.completionTokens}` },
      { title: '耗时', dataIndex: 'latencyMs', width: 90, render: value => `${value} ms` },
      { title: '状态', width: 95, render: (_, item) => <Tag color={item.succeeded ? 'success' : 'error'}>{item.statusCode || item.errorCode || '失败'}</Tag> },
    ]} />
  </Card>;
}
