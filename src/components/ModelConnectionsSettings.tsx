import { useEffect, useState } from 'react';
import { App, Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { createModelConnection, listModelConnections, testModelConnection, updateModelConnection, type ConnectionDraft, type ModelConnection } from '../api/model-connections';
import { getPlatformConfig, type ModelConfig } from '../api/experiment-platform';

const providers = [{ value: 'legacy', label: '兼容 API' }, { value: 'openai', label: 'OpenAI' }, { value: 'qwen', label: '千问' }, { value: 'gemini', label: 'Gemini' }];
type ConnectionForm = Omit<ConnectionDraft, 'headers'> & { headers?: string };
export default function ModelConnectionsSettings() {
  const { message } = App.useApp();
  const [connections, setConnections] = useState<ModelConnection[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [editing, setEditing] = useState<ModelConnection | 'create' | null>(null);
  const [testing, setTesting] = useState<ModelConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<ConnectionForm>();
  const [modelId, setModelId] = useState<string>();
  const refresh = async () => {
    const [list, config] = await Promise.all([listModelConnections(), getPlatformConfig()]);
    setConnections(list.items); setModels(config.models);
  };
  useEffect(() => { void refresh().catch(error => message.error(error.message)); }, []);
  const open = (value: ModelConnection | 'create') => {
    setEditing(value);
    form.resetFields();
    form.setFieldsValue(value === 'create' ? { provider: 'openai', name: '', active: true, isDefault: false } : {
      provider: value.provider, name: value.name, baseUrl: value.baseUrl,
      active: value.active, isDefault: value.isDefault, version: value.version,
    });
  };
  const save = async (values: ConnectionForm) => {
    setBusy(true);
    try {
      const { headers: headersText, ...draft } = values;
      const headers = headersText?.trim() ? JSON.parse(headersText) as Record<string, string> : undefined;
      const payload: ConnectionDraft = { ...draft, ...(headers ? { headers } : {}) };
      if (editing === 'create') await createModelConnection(payload);
      else if (editing) await updateModelConnection(editing.id, payload);
      await refresh(); setEditing(null); message.success('模型连接已保存');
    } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (!testing || !modelId) return;
    setBusy(true);
    try { await testModelConnection(testing.id, modelId); message.success('连接测试成功'); setTesting(null); }
    catch (error) { message.error(error instanceof Error ? error.message : '连接测试失败'); }
    finally { setBusy(false); }
  };
  return <Card title="模型连接" extra={<Button onClick={() => open('create')}>新增连接</Button>}>
    <Typography.Paragraph type="secondary">支持同一供应商多条连接。模型可显式绑定；未绑定时优先使用该供应商的默认连接，未配置时使用服务端环境变量。API Key 不会回显。连接测试会发送最短模型请求，可能产生少量费用。</Typography.Paragraph>
    <Table rowKey="id" dataSource={connections} pagination={false} scroll={{ x: 690 }} columns={[
      { title: '连接', dataIndex: 'name' }, { title: '供应商', dataIndex: 'provider' },
      { title: '密钥', dataIndex: 'keyMask' },
      { title: '状态', render: (_: unknown, row: ModelConnection) => <Space>{row.isDefault && <Tag color="blue">默认</Tag>}<Tag color={row.active ? 'success' : 'default'}>{row.active ? '启用' : '停用'}</Tag></Space> },
      { title: '操作', render: (_: unknown, row: ModelConnection) => <Space><Button type="link" onClick={() => open(row)}>编辑</Button><Button type="link" disabled={!row.active} onClick={() => { setTesting(row); setModelId(undefined); }}>测试</Button></Space> },
    ]} />
    <Modal title={editing === 'create' ? '新增模型连接' : '编辑模型连接'} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={busy} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="provider" label="供应商" rules={[{ required: true }]}><Select options={providers} disabled={editing !== 'create'} /></Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true, max: 100 }]}><Input /></Form.Item>
        <Form.Item name="apiKey" label={editing === 'create' ? 'API Key' : '替换 API Key（留空则保留）'} rules={editing === 'create' ? [{ required: true }] : []}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item name="baseUrl" label="自定义 API 地址"><Input placeholder="留空使用供应商默认地址；仅支持 HTTPS" /></Form.Item>
        <Form.Item name="isDefault" label="设为供应商默认连接" valuePropName="checked"><Switch /></Form.Item>
        {editing !== 'create' && <Form.Item name="active" label="启用" valuePropName="checked"><Switch /></Form.Item>}
        <Form.Item name="headers" label="自定义 X- 请求头（JSON，可选）"><Input.TextArea rows={3} placeholder={'{"x-project-id":"your-project"}'} /></Form.Item>
        <Typography.Text type="secondary">仅接受 X- 开头的请求头；保存后不会回显。编辑时留空保留原请求头，替换 API Key 且原连接有请求头时须重新填写。</Typography.Text>
      </Form>
    </Modal>
    <Modal title="测试模型连接" open={Boolean(testing)} onCancel={() => setTesting(null)} onOk={() => void test()} okText="发送最小请求" okButtonProps={{ disabled: !modelId }} confirmLoading={busy}>
      <Typography.Paragraph>请选择此供应商下已启用的模型。测试可能产生少量费用。</Typography.Paragraph>
      <Select style={{ width: '100%' }} placeholder="选择模型" value={modelId} onChange={setModelId} options={models.filter(model => model.active && model.status==='active' && model.adapterReady && model.provider === testing?.provider).map(model => ({ value: model.id, label: model.displayName }))} />
    </Modal>
  </Card>;
}
