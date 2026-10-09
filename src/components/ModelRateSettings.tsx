import { useEffect, useState } from 'react';
import { App, Button, Card, Form, InputNumber, Popconfirm, Progress, Select, Space, Table, Typography } from 'antd';
import { getPlatformConfig } from '../api/experiment-platform';
import { deleteModelRateLimit, getModelRateStatus, listModelRateLimits, saveModelRateLimit, type ModelRateLimit, type ModelRateStatus } from '../api/model-rate-limits';

export default function ModelRateSettings() {
  const { message } = App.useApp();
  const [form] = Form.useForm<Pick<ModelRateLimit, 'modelId' | 'rpm' | 'tpm'>>();
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  const [limits, setLimits] = useState<ModelRateLimit[]>([]);
  const [status, setStatus] = useState<ModelRateStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = async () => { const [catalog, rules, usage] = await Promise.all([getPlatformConfig(), listModelRateLimits(), getModelRateStatus()]); setModels(catalog.models); setLimits(rules.items); setStatus(usage.items); };
  useEffect(() => { let active = true; void refresh().catch(error => { if (active) message.error(error instanceof Error ? error.message : '限流配置加载失败'); }); const timer = window.setInterval(() => { if (!document.hidden) void getModelRateStatus().then(value => { if (active) setStatus(value.items); }).catch(() => undefined); }, 5000); return () => { active = false; window.clearInterval(timer); }; }, []);
  const save = async (value: Pick<ModelRateLimit, 'modelId' | 'rpm' | 'tpm'>) => { setBusy(true); try { await saveModelRateLimit(value); await refresh(); message.success('速率限制已保存'); } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); } finally { setBusy(false); } };
  const remove = async (modelId: string) => { setBusy(true); try { await deleteModelRateLimit(modelId); await refresh(); message.success('速率限制已删除'); } catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); } finally { setBusy(false); } };
  return <Card size="small" title="模型分钟速率限制" style={{ marginTop: 16 }}>
    <Typography.Paragraph type="secondary">按 UTC 自然分钟统计入队批次的保守请求数与 token 上限；超过 RPM 或 TPM 时返回 429 和下一分钟的 Retry-After。实际调用审计与失败后的预留释放仍在 9.5 完善。</Typography.Paragraph>
    <Form form={form} layout="inline" onFinish={save} style={{ rowGap: 8, marginBottom: 16 }}>
      <Form.Item name="modelId" label="模型" rules={[{ required: true }]}><Select style={{ width: 160 }} options={models.map(item => ({ value: item.id, label: item.displayName }))} /></Form.Item>
      <Form.Item name="rpm" label="RPM" rules={[{ required: true }]}><InputNumber min={1} max={1_000_000} precision={0} /></Form.Item>
      <Form.Item name="tpm" label="TPM" rules={[{ required: true }]}><InputNumber min={1} max={1_000_000_000} precision={0} /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>保存</Button>
    </Form>
    <Table size="small" rowKey="modelId" dataSource={limits} pagination={{ pageSize: 5 }} columns={[{ title: '模型', dataIndex: 'modelName' }, { title: 'RPM', dataIndex: 'rpm' }, { title: 'TPM', dataIndex: 'tpm' }, { title: '当前分钟', render: (_, item) => { const usage = status.find(value => value.modelId === item.modelId); return <Space direction="vertical" size={0} style={{ minWidth: 180 }}><Typography.Text>{usage?.usedRequests || 0}/{item.rpm} 次 · {usage?.usedTokens || 0}/{item.tpm} token</Typography.Text><Progress percent={Math.min(100, Math.max((usage?.usedRequests || 0) / item.rpm, (usage?.usedTokens || 0) / item.tpm) * 100)} showInfo={false} status={usage && (usage.remainingRequests === 0 || usage.remainingTokens === 0) ? 'exception' : 'active'} /></Space>; } }, { title: '操作', render: (_, item) => <Popconfirm title="删除该速率限制？" onConfirm={() => void remove(item.modelId)}><Button size="small" danger disabled={busy}>删除</Button></Popconfirm> }]} />
  </Card>;
}
