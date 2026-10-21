import { useEffect, useState } from 'react';
import { App, Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { createWebhook, deleteWebhook, listWebhookDeliveries, listWebhooks, testWebhookDelivery, updateWebhook, type WebhookConfig, type WebhookDelivery, type WebhookEvent, type WebhookInput, type WebhookProvider } from '../api/outbound-webhooks';

const eventOptions: { value: WebhookEvent; label: string }[] = [
  { value: 'task.completed', label: '任务完成' },
  { value: 'experiment.finished', label: '实验结束' },
  { value: 'evaluation.completed', label: '评测结束' },
  { value: 'alert.firing', label: '告警（评测／模型／调度）' },
  { value: 'note.updated', label: '笔记更新' },
];
const sample: Record<WebhookEvent, Record<string, string | number>> = {
  'task.completed': { taskId: '任务 ID', title: '任务标题', status: 'done', completedAt: 'ISO 时间', description: '任务描述', category: '分类', phase: '阶段', priority: '优先级', dueDate: '截止时间', plannedStartDate: '计划开始', progress: 100, notes: '任务备注', ownerId: '归属账号 ID' },
  'experiment.finished': { batchId: '批次 ID', experimentId: '实验 ID', status: 'completed / partial / failed', kind: '批次类型', completedAt: 'ISO 时间', runCount: 3, completedRuns: 2, failedRuns: 1, promptTokens: 100, completionTokens: 200, costUsd: 0.001 },
  'evaluation.completed': { batchId: '批次 ID', experimentId: '实验 ID', status: 'completed / partial / failed', kind: 'dataset / regression', completedAt: 'ISO 时间', runCount: 10, completedRuns: 9, failedRuns: 1, promptTokens: 100, completionTokens: 200, costUsd: 0.001 },
  'alert.firing': { alertId: '评测告警 ID（评测退化时）', batchId: '评测批次 ID（评测退化时）', affectedCount: 3, details: '退化明细（评测退化时）', alertKind: '模型／成本／调度等通知类型', sourceEntityId: '告警来源业务 ID', title: '告警标题', body: '告警正文', targetUrl: '站内详情路径', userId: '配额告警账号 ID', createdAt: 'ISO 时间' },
  'note.updated': { noteId: '笔记 ID', title: '笔记标题', updatedAt: 'ISO 时间', content: '笔记正文', taskId: '任务 ID', categoryId: '分类 ID', sourceSessionId: '来源会话 ID' },
};
const providers: { value: WebhookProvider; label: string }[] = [
  { value: 'generic', label: '通用 JSON' }, { value: 'wecom', label: '企业微信机器人' },
  { value: 'feishu', label: '飞书机器人' }, { value: 'dingtalk', label: '钉钉机器人' },
];
type EditorFields = { event: WebhookEvent; provider: WebhookProvider; url: string; secret: string; headersText: string; enabled: boolean };

export default function WebhookSettings() {
  const { message } = App.useApp();
  const [form] = Form.useForm<EditorFields>();
  const selectedProvider = Form.useWatch('provider', form);
  const [items, setItems] = useState<WebhookConfig[]>([]);
  const [editing, setEditing] = useState<WebhookConfig | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [logHook, setLogHook] = useState<WebhookConfig | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const refresh = async () => setItems((await listWebhooks()).items);
  useEffect(() => { void refresh().catch(error => message.error(error.message)); }, []);
  const open = (item: WebhookConfig | null) => {
    setEditing(item);
    form.setFieldsValue({ event: item?.event || 'task.completed', provider: item?.provider || 'generic',
      url: item?.provider && item.provider !== 'generic' ? '' : item?.url || '', secret: '', headersText: '', enabled: item?.enabled ?? true });
  };
  const save = async (values: EditorFields) => {
    let headers: Record<string, string> | undefined;
    try {
      if (values.provider === 'generic' && values.headersText?.trim()) {
        const parsed: unknown = JSON.parse(values.headersText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('自定义请求头须为 JSON 对象');
        headers = parsed as Record<string, string>;
      }
    } catch (error) { message.error(error instanceof Error ? error.message : '请求头格式无效'); return; }
    const data: WebhookInput = { event: values.event, provider: values.provider, enabled: values.enabled, confirmExternalFields: true,
      ...(values.url?.trim() ? { url: values.url.trim() } : {}),
      ...(values.secret ? { secret: values.secret } : {}), ...(headers === undefined ? {} : { headers }), ...(editing ? { version: editing.version } : {}) };
    Modal.confirm({
      title: '确认向外部地址发送业务数据？',
      content: <Space direction="vertical"><Typography.Text>事件：{values.event}</Typography.Text><Typography.Text>渠道：{providers.find(item => item.value === values.provider)?.label}</Typography.Text><Typography.Text>目标：{values.provider === 'generic' ? values.url || editing?.url : '机器人地址由服务端加密保存，页面不回显凭据'}</Typography.Text><Typography.Text>将外发以下业务字段：</Typography.Text><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(values.provider === 'generic' ? sample[values.event] : { title: '告警标题', body: '告警正文；若无正文则组合 metric、scopeId、triggerValue', eventId: '事件 ID' }, null, 2)}</pre><Typography.Text type="secondary">机器人渠道使用平台的文本消息协议，不发送本系统的 HMAC 签名或自定义请求头。</Typography.Text></Space>,
      okText: '确认保存', cancelText: '取消',
      onOk: async () => {
        setSaving(true);
        try {
          if (editing) await updateWebhook(editing.id, data);
          else await createWebhook(data);
          setEditing(undefined); form.resetFields(); await refresh(); message.success('Webhook 已保存');
        } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); throw error; }
        finally { setSaving(false); }
      },
    });
  };
  const remove = (item: WebhookConfig) => Modal.confirm({
    title: `删除 ${item.event} Webhook？`, content: '待投递的消息将取消；既有投递记录仍可查询。', okText: '删除', okType: 'danger',
    onOk: async () => { try { await deleteWebhook(item.id,item.version); await refresh(); message.success('已删除'); } catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); throw error; } },
  });
  const logs = async (item: WebhookConfig) => {
    setLogHook(item);
    try { setDeliveries((await listWebhookDeliveries(item.id)).items); }
    catch (error) { message.error(error instanceof Error ? error.message : '获取投递记录失败'); }
  };
  const testDelivery = (item: WebhookConfig) => Modal.confirm({
    title: '向此地址发送测试事件？',
    content: <Space direction="vertical"><Typography.Text>{item.url}</Typography.Text><Typography.Text>{item.provider === 'generic' ? '将发送带 HMAC 签名的测试正文及事件 ID。' : '将按机器人平台的文本消息格式发送测试正文及事件 ID。'}不会包含真实业务数据或密钥。可随后在投递日志中查看状态。</Typography.Text></Space>,
    okText: '发送测试',
    onOk: async () => {
      try { await testWebhookDelivery(item.id); message.success('测试投递已入队，请在日志中查看结果'); await logs(item); }
      catch (error) { message.error(error instanceof Error ? error.message : '测试投递失败'); throw error; }
    },
  });
  return <Card title="出站 Webhook" extra={<Button type="primary" onClick={() => open(null)}>新增 Webhook</Button>}>
    <Typography.Paragraph type="secondary">通用 JSON Webhook 发送 HMAC 签名；企业机器人使用各平台的文本消息协议。失败后按 1、2、4 分钟重试三次。机器人地址中的凭据加密保存且不回显。</Typography.Paragraph>
    <Table rowKey="id" size="small" dataSource={items} pagination={{ pageSize: 5 }} columns={[
      { title: '事件', dataIndex: 'event' },
      { title: '渠道', dataIndex: 'provider', render: (value: WebhookProvider) => providers.find(item => item.value === value)?.label || value },
      { title: '编号', dataIndex: 'id', render: (value: string) => value.slice(0, 8) },
      { title: '目标地址', dataIndex: 'url', ellipsis: true },
      { title: '密钥', dataIndex: 'secretMask' },
      { title: '状态', render: (_, item) => <Tag color={item.deletedAt ? 'default' : item.enabled ? 'green' : 'orange'}>{item.deletedAt ? '已删除' : item.enabled ? '启用' : '停用'}</Tag> },
      { title: '操作', render: (_, item) => <Space>{!item.deletedAt && <Button size="small" onClick={() => open(item)}>编辑</Button>}{!item.deletedAt && item.enabled && <Button size="small" onClick={() => testDelivery(item)}>测试投递</Button>}<Button size="small" onClick={() => void logs(item)}>日志</Button>{!item.deletedAt && <Button size="small" danger onClick={() => remove(item)}>删除</Button>}</Space> },
    ]} />
    <Modal title={editing ? '编辑 Webhook' : '新增 Webhook'} open={editing !== undefined} onCancel={() => { setEditing(undefined); form.resetFields(); }} footer={null} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={values => void save(values)}>
        <Form.Item name="provider" label="渠道" extra={editing ? '更换渠道请新建配置。' : undefined} rules={[{ required: true }]}><Select options={providers} disabled={Boolean(editing)} onChange={value => { if (value !== 'generic') form.setFieldValue('event','alert.firing'); form.setFieldValue('url',''); form.setFieldValue('headersText',''); }} /></Form.Item>
        <Form.Item name="event" label="事件" rules={[{ required: true }]}><Select disabled={selectedProvider !== 'generic'} options={eventOptions} /></Form.Item>
        <Form.Item name="url" label="公网 HTTPS 地址" extra={editing && selectedProvider !== 'generic' ? '留空保留原地址；更换地址时填写完整机器人地址。' : selectedProvider !== 'generic' ? '完整机器人地址只在保存时提交，之后不回显。钉钉请使用关键词安全模式。' : undefined}
          rules={[{ required: !editing || selectedProvider !== editing.provider, message: '请填写完整地址' }, { type: 'url' }]}>{selectedProvider === 'generic' ? <Input placeholder="https://example.com/webhook" /> : <Input.Password autoComplete="off" placeholder="https://机器人平台提供的完整地址" />}</Form.Item>
        {selectedProvider === 'generic' && <Form.Item name="secret" preserve={false} label={editing?.provider === 'generic' ? '新共享密钥（留空则不更换）' : '共享密钥'} rules={editing?.provider === 'generic' ? [] : [{ required: true, min: 16 }]}><Input.Password autoComplete="new-password" /></Form.Item>}
        {selectedProvider === 'generic' && <Form.Item name="headersText" preserve={false} label="自定义 X- 请求头（JSON；编辑时留空保持原样）"><Input.TextArea rows={3} placeholder={'{"X-Project": "admin"}'} /></Form.Item>}
        <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
        <Button type="primary" htmlType="submit" loading={saving}>预览外发字段并保存</Button>
      </Form>
    </Modal>
    <Modal title={`投递日志 · ${logHook?.event || ''}`} open={Boolean(logHook)} width={900} onCancel={() => setLogHook(null)} footer={<Button onClick={() => logHook && void logs(logHook)}>刷新</Button>}>
      <Table rowKey="id" size="small" dataSource={deliveries} pagination={{ pageSize: 8 }} expandable={{ expandedRowRender: row => <Space direction="vertical" style={{ width: '100%' }}>{row.attempts.map(attempt => <Typography.Text key={attempt.attempt_number}>第 {attempt.attempt_number} 次 · {new Date(attempt.attempted_at).toLocaleString()} · HTTP {attempt.status_code ?? '—'} · {attempt.error || attempt.response_body || '成功'}</Typography.Text>)}</Space> }} columns={[
        { title: '事件', dataIndex: 'event_type' }, { title: '时间', dataIndex: 'created_at', render: value => new Date(value as string).toLocaleString() },
        { title: '状态', dataIndex: 'status' }, { title: '次数', dataIndex: 'attempt_count' },
        { title: '最近错误', dataIndex: 'last_error', ellipsis: true },
      ]} />
    </Modal>
  </Card>;
}
