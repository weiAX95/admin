import { useEffect, useState } from 'react';
import { App, Button, Divider, Drawer, Form, Input, InputNumber, Space, Table, Tag, Typography } from 'antd';
import { addPlatformModel, getPlatformConfig, savePlatformConfig } from '../api/experiment-platform';
import type { PlatformConfig } from '../api/experiment-platform';

export default function ExperimentPlatformSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [settingsForm] = Form.useForm<{ dailyBudgetUsd: number; concurrencyLimit: number }>();
  const [modelForm] = Form.useForm<{ displayName: string; apiModel: string; inputUsdPerMillion: number; outputUsdPerMillion: number }>();
  const refresh = () => getPlatformConfig().then(value => { setConfig(value); settingsForm.setFieldsValue(value); });
  useEffect(() => { if (open) void refresh().catch(error => message.error(error instanceof Error ? error.message : '加载失败')); }, [open]);
  return <Drawer title="实验模型与预算" open={open} onClose={onClose} width="min(760px, 100vw)">
    <Typography.Paragraph type="secondary">模型调用地址与密钥只从服务端环境变量读取，不会发送到浏览器。价格单位为美元／百万 token。</Typography.Paragraph>
    <Tag color={config?.configured ? 'success' : 'warning'}>{config?.configured ? '模型 API 已配置' : '模型 API 未配置'}</Tag>
    <Form form={settingsForm} layout="inline" onFinish={async values => { try { await savePlatformConfig(values); await refresh(); message.success('配置已保存'); } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); } }} style={{ marginTop: 16, rowGap: 12 }}>
      <Form.Item name="dailyBudgetUsd" label="每日预算 USD" rules={[{ required: true }]}><InputNumber min={0} precision={4} /></Form.Item>
      <Form.Item name="concurrencyLimit" label="并发上限" rules={[{ required: true }]}><InputNumber min={0} max={20} precision={0} /></Form.Item>
      <Button type="primary" htmlType="submit">保存限制</Button>
    </Form>
    <Divider>模型目录与价格</Divider>
    <Table size="small" rowKey="id" dataSource={config?.models || []} pagination={false} columns={[{ title: '显示名', dataIndex: 'displayName' }, { title: 'API 模型名', dataIndex: 'apiModel' }, { title: '输入价格', dataIndex: 'inputUsdPerMillion' }, { title: '输出价格', dataIndex: 'outputUsdPerMillion' }]} />
    <Form form={modelForm} layout="vertical" onFinish={async values => { try { await addPlatformModel(values); modelForm.resetFields(); await refresh(); message.success('模型已添加'); } catch (error) { message.error(error instanceof Error ? error.message : '添加失败'); } }} style={{ marginTop: 20 }}>
      <Space wrap><Form.Item name="displayName" label="显示名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="apiModel" label="API 模型名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="inputUsdPerMillion" label="输入价格" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item><Form.Item name="outputUsdPerMillion" label="输出价格" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item></Space>
      <Button htmlType="submit">添加模型</Button>
    </Form>
  </Drawer>;
}
