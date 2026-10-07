import { useEffect, useState } from 'react';
import { App, Button, Divider, Drawer, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { addPlatformModel, addPromptVersion, createPromptLibrary, getPlatformConfig, getPromptLibrary, savePlatformConfig, updatePlatformModel } from '../api/experiment-platform';
import type { ModelConfig, PlatformConfig } from '../api/experiment-platform';

export default function ExperimentPlatformSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [prompts, setPrompts] = useState<{ id: string; name: string; version_id: string; version: number; content: string }[]>([]);
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);
  const [versionPrompt, setVersionPrompt] = useState<{ id: string; name: string } | null>(null);
  const [versionContent, setVersionContent] = useState('');
  const [promptName, setPromptName] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [settingsForm] = Form.useForm<{ dailyBudgetUsd: number; concurrencyLimit: number; judgeModelId: string | null }>();
  const [modelForm] = Form.useForm<{ displayName: string; apiModel: string; inputUsdPerMillion: number; outputUsdPerMillion: number }>();
  const [editForm] = Form.useForm<{ displayName: string; inputUsdPerMillion: number; outputUsdPerMillion: number; active: boolean }>();
  const refresh = () => Promise.all([getPlatformConfig(), getPromptLibrary()]).then(([value, library]) => { setConfig(value); settingsForm.setFieldsValue(value); setPrompts(library.items); });
  useEffect(() => { if (open) void refresh().catch(error => message.error(error instanceof Error ? error.message : '加载失败')); }, [open]);
  return <Drawer title="实验模型与预算" open={open} onClose={onClose} width="min(760px, 100vw)">
    <Typography.Paragraph type="secondary">模型调用地址与密钥只从服务端环境变量读取，不会发送到浏览器。价格单位为美元／百万 token。</Typography.Paragraph>
    <Tag color={config?.configured ? 'success' : 'warning'}>{config?.configured ? '模型 API 已配置' : '模型 API 未配置'}</Tag>
    <Form form={settingsForm} layout="inline" onFinish={async values => { try { await savePlatformConfig(values); await refresh(); message.success('配置已保存'); } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); } }} style={{ marginTop: 16, rowGap: 12 }}>
      <Form.Item name="dailyBudgetUsd" label="每日预算 USD" rules={[{ required: true }]}><InputNumber min={0} precision={4} /></Form.Item>
      <Form.Item name="concurrencyLimit" label="并发上限" rules={[{ required: true }]}><InputNumber min={0} max={20} precision={0} /></Form.Item>
      <Form.Item name="judgeModelId" label="LLM Judge" rules={[{ required: true }]}><Select style={{ width: 180 }} options={config?.models.filter(model => model.active).map(model => ({ value: model.id, label: model.displayName })) || []} /></Form.Item>
      <Button type="primary" htmlType="submit">保存限制</Button>
    </Form>
    <Divider>模型目录与价格</Divider>
    <Table size="small" rowKey="id" dataSource={config?.models || []} pagination={false} columns={[{ title: '显示名', dataIndex: 'displayName' }, { title: 'API 模型名', dataIndex: 'apiModel' }, { title: '输入价格', dataIndex: 'inputUsdPerMillion' }, { title: '输出价格', dataIndex: 'outputUsdPerMillion' }, { title: '操作', render: (_, model: ModelConfig) => <Button type="link" onClick={() => { setEditingModel(model); editForm.setFieldsValue(model); }}>调整</Button> }]} />
    <Form form={modelForm} layout="vertical" onFinish={async values => { try { await addPlatformModel(values); modelForm.resetFields(); await refresh(); message.success('模型已添加'); } catch (error) { message.error(error instanceof Error ? error.message : '添加失败'); } }} style={{ marginTop: 20 }}>
      <Space wrap><Form.Item name="displayName" label="显示名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="apiModel" label="API 模型名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="inputUsdPerMillion" label="输入价格" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item><Form.Item name="outputUsdPerMillion" label="输出价格" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item></Space>
      <Button htmlType="submit">添加模型</Button>
    </Form>
    <Divider>提示词版本库</Divider>
    <Typography.Paragraph type="secondary">选择实验时引用固定版本。新版本不会修改旧实验已保存的提示词快照。</Typography.Paragraph>
    <Table size="small" rowKey="version_id" dataSource={prompts} pagination={{ pageSize: 5 }} columns={[{ title: '名称', dataIndex: 'name' }, { title: '版本', dataIndex: 'version', render: value => `v${value}` }, { title: '内容预览', dataIndex: 'content', render: value => <Typography.Text ellipsis style={{ maxWidth: 220 }}>{value}</Typography.Text> }, { title: '操作', render: (_, prompt) => <Button type="link" onClick={() => { setVersionPrompt({ id: prompt.id, name: prompt.name }); setVersionContent(prompt.content); }}>新增版本</Button> }]} />
    <Space direction="vertical" style={{ width: '100%' }}><Input placeholder="新提示词名称" value={promptName} onChange={event => setPromptName(event.target.value)} /><Input.TextArea placeholder="System Prompt 内容" rows={4} value={promptContent} onChange={event => setPromptContent(event.target.value)} /><Button onClick={async () => { try { await createPromptLibrary(promptName, promptContent); setPromptName(''); setPromptContent(''); await refresh(); message.success('提示词已保存'); } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); } }}>创建提示词</Button></Space>
    <Modal title="调整模型与价格" open={Boolean(editingModel)} onCancel={() => setEditingModel(null)} onOk={() => editForm.submit()}><Form form={editForm} layout="vertical" onFinish={async values => { if (!editingModel) return; try { await updatePlatformModel(editingModel.id, values); setEditingModel(null); await refresh(); message.success('配置已更新；已有运行仍保留旧价格快照'); } catch (error) { message.error(error instanceof Error ? error.message : '更新失败'); } }}><Form.Item name="displayName" label="显示名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="inputUsdPerMillion" label="输入 USD／百万 token" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item><Form.Item name="outputUsdPerMillion" label="输出 USD／百万 token" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item><Form.Item name="active" label="启用" valuePropName="checked"><Switch /></Form.Item></Form></Modal>
    <Modal title={`为 ${versionPrompt?.name || ''} 新增版本`} open={Boolean(versionPrompt)} onCancel={() => setVersionPrompt(null)} onOk={async () => { if (!versionPrompt) return; try { await addPromptVersion(versionPrompt.id, versionContent); setVersionPrompt(null); await refresh(); message.success('版本已新增'); } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); } }}><Input.TextArea rows={9} value={versionContent} onChange={event => setVersionContent(event.target.value)} /></Modal>
  </Drawer>;
}
