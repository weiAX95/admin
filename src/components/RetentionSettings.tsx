import { useEffect, useState } from 'react';
import { App, Button, Card, Form, Input, InputNumber, Modal, Space, Table, Typography } from 'antd';
import { getRetentionPolicy, listRetentionRuns, listRecycleBin, purgeRecycleItem, restoreRecycleItem, saveRetentionPolicy, type CleanupRun, type RecycleItem, type RetentionPolicy } from '../api/retention';

export default function RetentionSettings() {
  const { message } = App.useApp();
  const [form] = Form.useForm<RetentionPolicy>();
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
  const [runs, setRuns] = useState<CleanupRun[]>([]);
  const [recycled, setRecycled] = useState<RecycleItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const refresh = async () => {
    const [settings, history, bin] = await Promise.all([getRetentionPolicy(), listRetentionRuns(), listRecycleBin()]);
    setPolicy(settings); form.setFieldsValue(settings); setRuns(history.items); setRecycled(bin.items);
  };
  useEffect(() => { void refresh().catch(error => message.error(error.message)); }, []);
  const save = async (value: RetentionPolicy) => {
    if (!policy) return;
    setSaving(true);
    try { const next = await saveRetentionPolicy({ ...policy, ...value }); setPolicy(next); form.setFieldsValue(next); message.success('保留策略已保存'); }
    catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  };
  const restore = async (item: RecycleItem) => {
    setBusyId(item.id);
    try { await restoreRecycleItem(item); await refresh(); message.success('已恢复'); }
    catch (error) { message.error(error instanceof Error ? error.message : '恢复失败'); }
    finally { setBusyId(null); }
  };
  const purge = (item: RecycleItem) => Modal.confirm({
    title: `永久删除「${item.title}」？`,
    content: '此操作无法撤销，关联子记录也可能被删除。', okText: '永久删除', okType: 'danger', cancelText: '取消',
    onOk: async () => { setBusyId(item.id); try { await purgeRecycleItem(item); await refresh(); message.success('已永久删除'); } catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); } finally { setBusyId(null); } },
  });
  return <Card title="数据保留策略" loading={!policy}>
    <Typography.Paragraph type="secondary">清理时间按系统默认时区计算；服务启动后补做当天错过的清理。任务、笔记、实验及提示词删除后进入回收站；保留天数设为 0 时立即永久删除。恢复实验不会自动重新启用调度或分享。</Typography.Paragraph>
    <Form form={form} layout="inline" onFinish={save} style={{ rowGap: 12, marginBottom: 20 }}>
      <Form.Item name="auditDays" label="安全审计保留天数" rules={[{ required: true }]}><InputNumber min={30} max={365} /></Form.Item>
      <Form.Item name="sessionDays" label="会话保留天数" rules={[{ required: true }]}><InputNumber min={7} max={730} /></Form.Item>
      <Form.Item name="recycleDays" label="回收站天数" rules={[{ required: true }]}><InputNumber min={0} max={90} /></Form.Item>
      <Form.Item name="cleanupLocalTime" label="每日清理时间" rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ }]}><Input placeholder="03:00" /></Form.Item>
      <Form.Item><Button type="primary" htmlType="submit" loading={saving}>保存策略</Button></Form.Item>
    </Form>
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text strong>最近清理记录</Typography.Text>
      <Table rowKey="local_date" size="small" dataSource={runs} pagination={{ pageSize: 5 }} columns={[
        { title: '日期', dataIndex: 'local_date' },
        { title: '安全审计', dataIndex: 'audit_deleted' },
        { title: '会话', dataIndex: 'sessions_deleted' },
        { title: '未审核候选', dataIndex: 'candidates_deleted' },
        { title: '回收站清理', render: (_, row) => (row.tasks_deleted || 0) + (row.notes_deleted || 0) + (row.experiments_deleted || 0) + (row.prompts_deleted || 0) },
        { title: '清理失败', render: (_, row) => row.purge_failures?.length || 0 },
      ]} />
      <Typography.Text strong>回收站</Typography.Text>
      <Table rowKey={item => `${item.type}:${item.id}`} size="small" dataSource={recycled} pagination={{ pageSize: 5 }} locale={{ emptyText: '回收站为空' }} columns={[
        { title: '类型', dataIndex: 'type', render: type => ({ task: '任务', note: '笔记', experiment: '实验', prompt: '提示词' })[type as RecycleItem['type']] },
        { title: '名称', dataIndex: 'title' },
        { title: '删除时间', dataIndex: 'deletedAt', render: value => new Date(value as string).toLocaleString() },
        { title: '操作', render: (_, item) => <Space><Button size="small" loading={busyId === item.id} onClick={() => void restore(item)}>恢复</Button><Button size="small" danger disabled={busyId !== null} onClick={() => purge(item)}>永久删除</Button></Space> },
      ]} />
    </Space>
  </Card>;
}
