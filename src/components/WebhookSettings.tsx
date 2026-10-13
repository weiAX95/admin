import { useEffect, useState } from 'react';
import { App, Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { createWebhook, deleteWebhook, listWebhookDeliveries, listWebhooks, testWebhookDelivery, updateWebhook, type WebhookConfig, type WebhookDelivery, type WebhookEvent, type WebhookInput } from '../api/outbound-webhooks';

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
type EditorFields = { event: WebhookEvent; url: string; secret: string; headersText: string; enabled: boolean };

export default function WebhookSettings() {
  const { message } = App.useApp();
  const [form] = Form.useForm<EditorFields>();
  const [items, setItems] = useState<WebhookConfig[]>([]);
  const [editing, setEditing] = useState<WebhookConfig | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [logHook, setLogHook] = useState<WebhookConfig | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const refresh = async () => setItems((await listWebhooks()).items);
  useEffect(() => { void refresh().catch(error => message.error(error.message)); }, []);
  const open = (item: WebhookConfig | null) => {
    setEditing(item);
    form.setFieldsValue({ event: item?.event || 'task.completed', url: item?.url || '', secret: '', headersText: '', enabled: item?.enabled ?? true });
  };
  const save = async (values: EditorFields) => {
    let headers: Record<string, string> | undefined;
    try {
      if (values.headersText.trim()) {
        const parsed: unknown = JSON.parse(values.headersText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('自定义请求头须为 JSON 对象');
        headers = parsed as Record<string, string>;
      }
    } catch (error) { message.error(error instanceof Error ? error.message : '请求头格式无效'); return; }
    const data: WebhookInput = { event: values.event, url: values.url.trim(), enabled: values.enabled, confirmExternalFields: true,
      ...(values.secret ? { secret: values.secret } : {}), ...(headers === undefined ? {} : { headers }), ...(editing ? { version: editing.version } : {}) };
    Modal.confirm({
      title: '确认向外部地址发送业务数据？',
      content: <Space direction="vertical"><Typography.Text>事件：{values.event}</Typography.Text><Typography.Text>目标：{values.url}</Typography.Text><Typography.Text>将外发事件 ID、类型、时间与以下业务字段：</Typography.Text><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(sample[values.event], null, 2)}</pre><Typography.Text type="secondary">共享密钥及自定义请求头不会写入事件正文。接收方应按事件 ID 去重。</Typography.Text></Space>,
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
    content: <Space direction="vertical"><Typography.Text>{item.url}</Typography.Text><Typography.Text>将发送签名的测试正文及事件 ID；不会包含真实业务数据或密钥。可随后在投递日志中查看状态。</Typography.Text></Space>,
    okText: '发送测试',
    onOk: async () => {
      try { await testWebhookDelivery(item.id); message.success('测试投递已入队，请在日志中查看结果'); await logs(item); }
      catch (error) { message.error(error instanceof Error ? error.message : '测试投递失败'); throw error; }
    },
  });
  return <Card title="出站 Webhook" extra={<Button type="primary" onClick={() => open(null)}>新增 Webhook</Button>}>
    <Typography.Paragraph type="secondary">系统在业务变更提交后发送签名请求；失败后按 1、2、4 分钟重试三次。接收方可使用 X-Webhook-Timestamp 和原始请求体校验 HMAC-SHA256，按 X-Webhook-Id 去重。</Typography.Paragraph>
    <Table rowKey="id" size="small" dataSource={items} pagination={{ pageSize: 5 }} columns={[
      { title: '事件', dataIndex: 'event' },
      { title: '目标地址', dataIndex: 'url', ellipsis: true },
      { title: '密钥', dataIndex: 'secretMask' },
      { title: '状态', render: (_, item) => <Tag color={item.deletedAt ? 'default' : item.enabled ? 'green' : 'orange'}>{item.deletedAt ? '已删除' : item.enabled ? '启用' : '停用'}</Tag> },
      { title: '操作', render: (_, item) => <Space>{!item.deletedAt && <Button size="small" onClick={() => open(item)}>编辑</Button>}{!item.deletedAt && item.enabled && <Button size="small" onClick={() => testDelivery(item)}>测试投递</Button>}<Button size="small" onClick={() => void logs(item)}>日志</Button>{!item.deletedAt && <Button size="small" danger onClick={() => remove(item)}>删除</Button>}</Space> },
    ]} />
    <Modal title={editing ? '编辑 Webhook' : '新增 Webhook'} open={editing !== undefined} onCancel={() => { setEditing(undefined); form.resetFields(); }} footer={null} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={values => void save(values)}>
        <Form.Item name="event" label="事件" rules={[{ required: true }]}><Select options={eventOptions} /></Form.Item>
        <Form.Item name="url" label="公网 HTTPS 地址" rules={[{ required: true, type: 'url' }]}><Input placeholder="https://example.com/webhook" /></Form.Item>
        <Form.Item name="secret" label={editing ? '新共享密钥（留空则不更换）' : '共享密钥'} rules={editing ? [] : [{ required: true, min: 16 }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item name="headersText" label="自定义 X- 请求头（JSON；编辑时留空保持原样）"><Input.TextArea rows={3} placeholder={'{"X-Project": "admin"}'} /></Form.Item>
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
