import { useEffect, useState } from 'react';
import { App, Button, Card, Form, Input, InputNumber, Modal, Space, Table, Tag, Typography } from 'antd';
import { addPlatformModel } from '../api/experiment-platform';
import { getSessionModelPrices, updateSessionModelPrice } from '../api/sessions';
import type { SessionModelPrice } from '../api/sessions';

interface PriceDraft { name: string; displayName: string; inputUsdPer1K: number; outputUsdPer1K: number }

export default function SessionModelPriceSettings() {
  const { message } = App.useApp();
  const [items, setItems] = useState<SessionModelPrice[]>([]);
  const [editing, setEditing] = useState<SessionModelPrice | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [priceForm] = Form.useForm<PriceDraft>();
  const [createForm] = Form.useForm<PriceDraft>();
  const refresh = async () => setItems((await getSessionModelPrices()).items);
  useEffect(() => { void refresh().catch(cause => message.error(cause instanceof Error ? cause.message : '读取模型价格失败')); }, []);
  const savePrice = async (values: PriceDraft) => {
    if (!editing) return;
    setBusy(true);
    try { await updateSessionModelPrice(editing.id, values.inputUsdPer1K, values.outputUsdPer1K); await refresh(); setEditing(null); message.success('价格已更新，按现价重算的历史会话会同步变化'); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '保存价格失败'); }
    finally { setBusy(false); }
  };
  const createPrice = async (values: PriceDraft) => {
    setBusy(true);
    try {
      await addPlatformModel({ name: values.name.trim(), displayName: values.displayName.trim(), apiModel: values.name.trim(), provider: 'custom', capabilities: { input: ['text'], output: ['text'], tools: false }, mediaPricing: {}, inputUsdPerMillion: values.inputUsdPer1K * 1000, outputUsdPerMillion: values.outputUsdPer1K * 1000, active: false });
      await refresh(); setCreating(false); createForm.resetFields(); message.success('外部聊天模型价格已登记');
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '登记模型失败'); }
    finally { setBusy(false); }
  };
  const priceFields = <><Form.Item name="inputUsdPer1K" label="输入 USD／千 token" rules={[{ required: true, type: 'number', min: 0 }]}><InputNumber min={0} precision={6} style={{ width: '100%' }} /></Form.Item><Form.Item name="outputUsdPer1K" label="输出 USD／千 token" rules={[{ required: true, type: 'number', min: 0 }]}><InputNumber min={0} precision={6} style={{ width: '100%' }} /></Form.Item></>;
  return <Card title="会话模型定价" extra={<Button onClick={() => setCreating(true)}>登记外部聊天模型</Button>}>
    <Typography.Paragraph type="secondary">与实验模型共用价格目录。聊天端 `usage.model` 应填写模型唯一标识；未匹配时保留用量但不估算成本。此处登记的外部模型只用于计价，不会启用实验执行。</Typography.Paragraph>
    <Table size="small" rowKey="id" dataSource={items} pagination={{ pageSize: 10 }} columns={[
      { title: '模型', render: (_, row: SessionModelPrice) => <Space>{row.displayName}<Typography.Text type="secondary">{row.name}</Typography.Text>{row.status !== 'active' && <Tag>{row.status}</Tag>}</Space> },
      { title: '输入 USD／千', dataIndex: 'inputUsdPer1K' },
      { title: '输出 USD／千', dataIndex: 'outputUsdPer1K' },
      { title: '操作', render: (_, row: SessionModelPrice) => <Button type="link" onClick={() => { setEditing(row); priceForm.setFieldsValue(row); }}>调整价格</Button> },
    ]} />
    <Modal title={`调整 ${editing?.displayName || ''} 的价格`} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => priceForm.submit()} okButtonProps={{ loading: busy }}><Form form={priceForm} layout="vertical" onFinish={savePrice}>{priceFields}</Form></Modal>
    <Modal title="登记外部聊天模型" open={creating} onCancel={() => setCreating(false)} onOk={() => createForm.submit()} okButtonProps={{ loading: busy }}><Form form={createForm} layout="vertical" onFinish={createPrice}><Form.Item name="name" label="模型唯一标识" rules={[{ required: true, pattern: /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/ }]}><Input placeholder="例如 provider:model-name" /></Form.Item><Form.Item name="displayName" label="显示名称" rules={[{ required: true }]}><Input /></Form.Item>{priceFields}</Form></Modal>
  </Card>;
}
