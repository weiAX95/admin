import { useEffect, useState } from 'react';
import { App, Button, Card, Form, Input, InputNumber, Space, Table, Typography } from 'antd';
import { getRetentionPolicy, listRetentionRuns, saveRetentionPolicy, type CleanupRun, type RetentionPolicy } from '../api/retention';

export default function RetentionSettings() {
  const { message } = App.useApp();
  const [form] = Form.useForm<RetentionPolicy>();
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
  const [runs, setRuns] = useState<CleanupRun[]>([]);
  const [saving, setSaving] = useState(false);
  const refresh = async () => {
    const [settings, history] = await Promise.all([getRetentionPolicy(), listRetentionRuns()]);
    setPolicy(settings); form.setFieldsValue(settings); setRuns(history.items);
  };
  useEffect(() => { void refresh().catch(error => message.error(error.message)); }, []);
  const save = async (value: RetentionPolicy) => {
    if (!policy) return;
    setSaving(true);
    try { const next = await saveRetentionPolicy({ ...policy, ...value }); setPolicy(next); form.setFieldsValue(next); message.success('保留策略已保存'); }
    catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  };
  return <Card title="数据保留策略" loading={!policy}>
    <Typography.Paragraph type="secondary">清理时间按系统默认时区计算；服务启动后补做当天错过的清理。审计日志和会话记录可自动清理；核心内容回收站仍在建设中，当前回收天数暂不影响任务、笔记和实验的删除行为。</Typography.Paragraph>
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
      ]} />
    </Space>
  </Card>;
}
