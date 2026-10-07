import { useEffect, useMemo, useState } from 'react';
import { App, Alert, Button, Col, Drawer, Form, Input, InputNumber, Row, Select, Slider, Space, Typography } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import type { LearningTask } from '../types';
import MarkdownEditor from './MarkdownEditor';
import { createDefinition, getExperimentTemplates, getPlatformConfig, getPromptLibrary, runDefinition, updateDefinition } from '../api/experiment-platform';
import type { DefinitionPayload, ExperimentDefinition, ExperimentTemplate, ModelConfig } from '../api/experiment-platform';

function names(text: string) { return [...new Set([...text.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)].map(match => match[1]))]; }
function highlighted(text: string) { return text.split(/(\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\})/g).map((part, index) => part.startsWith('{{') ? <mark key={index}>{part}</mark> : part); }

interface Props { open: boolean; initial?: ExperimentDefinition | null; tasks: LearningTask[]; defaultTaskId?: string; onClose: () => void; onSaved: (id: string) => void }
export default function ExperimentDefinitionDrawer({ open, initial, tasks, defaultTaskId, onClose, onSaved }: Props) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<DefinitionPayload>();
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [templates, setTemplates] = useState<ExperimentTemplate[]>([]);
  const [prompts, setPrompts] = useState<{ id: string; name: string; version_id: string; version: number; content: string }[]>([]);
  const [canExecute, setCanExecute] = useState(false);
  const [judgeModelId, setJudgeModelId] = useState<string | null>(null);
  const [saveAction, setSaveAction] = useState<'save' | 'execute'>('save');
  const [saving, setSaving] = useState(false);
  const userPrompt = Form.useWatch('userPrompt', form) || '';
  const systemPrompt = Form.useWatch('systemPrompt', form) || '';
  const variables = Form.useWatch('variables', form) || {};
  const needed = useMemo(() => names(`${systemPrompt}\n${userPrompt}`), [systemPrompt, userPrompt]);
  const missing = needed.filter(name => !variables[name]?.trim());
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(initial ? { ...initial, variants: initial.variants } : { title: '', taskId: defaultTaskId || null, systemPrompt: '', userPrompt: '', promptVersionId: null, variables: {}, variants: [] });
    void Promise.all([getPlatformConfig(), getExperimentTemplates(), getPromptLibrary()]).then(([config, library, promptList]) => {
      setModels(config.models.filter(item => item.active)); setTemplates(library.items); setPrompts(promptList.items);
      setJudgeModelId(config.judgeModelId);
      setCanExecute(config.configured && config.dailyBudgetUsd > 0 && config.concurrencyLimit > 0 && Boolean(config.judgeModelId));
    }).catch(error => message.error(error instanceof Error ? error.message : '无法读取实验配置'));
  }, [open, initial, defaultTaskId, form, message]);

  const applyTemplate = (templateId: string) => {
    const template = templates.find(item => item.id === templateId);
    if (!template) return;
    form.setFieldsValue({ systemPrompt: template.systemPrompt, userPrompt: template.userPrompt, variables: {}, variants: template.variants.map(variant => ({ ...variant, modelId: models[0]?.id || '' })) });
  };
  const submit = async (values: DefinitionPayload) => {
    if (!values.variants?.length) { message.error('请添加至少一个模型变体'); return; }
    if (saveAction === 'execute' && missing.length) { message.error(`请填写变量：${missing.join('、')}`); return; }
    if (saveAction === 'execute') {
      const judge = models.find(model => model.id === judgeModelId);
      const estimate = values.variants.reduce((total, variant) => {
        const model = models.find(item => item.id === variant.modelId);
        if (!model || !judge) return total;
        const user = values.userPrompt.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, name: string) => values.variables[name] || '');
        const tokens = variant.parameters?.max_tokens || 1024;
        const chars = [...values.systemPrompt, ...user].length;
        return total + ((chars * model.inputUsdPerMillion + tokens * model.outputUsdPerMillion + (chars + tokens * 4 + 1000) * judge.inputUsdPerMillion + 300 * judge.outputUsdPerMillion) / 1_000_000);
      }, 0);
      const confirmed = await new Promise<boolean>(resolve => modal.confirm({ title: `确认保存并提交 ${values.variants.length} 次模型调用？`, content: `本地调用上限估算 $${estimate.toFixed(6)}；服务端会按当前预算再次校验。`, onOk: () => resolve(true), onCancel: () => resolve(false) }));
      if (!confirmed) return;
    }
    setSaving(true);
    try {
      const payload = { ...values, variants: values.variants.map(variant => ({ ...variant, parameters: variant.parameters || {} })), execute: !initial && saveAction === 'execute' };
      const saved = initial ? await updateDefinition(initial.id, payload) : await createDefinition(payload);
      if (initial && saveAction === 'execute') {
        await runDefinition(saved.id, values.variables);
      }
      message.success(saveAction === 'execute' ? '实验已保存，运行已排队' : '实验定义已保存');
      onSaved(saved.id);
    } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  };
  const preview = (() => { try { return userPrompt.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, name) => variables[name] || `〔未填写：${name}〕`); } catch { return userPrompt; } })();
  return <Drawer title={initial ? '编辑实验定义' : '新建实验定义'} open={open} onClose={onClose} width="min(1100px, 100vw)" extra={<Space><Button loading={saving} onClick={() => { setSaveAction('save'); form.submit(); }}>仅保存</Button><Button type="primary" disabled={!canExecute || missing.length > 0 || models.length === 0} loading={saving} onClick={() => { setSaveAction('execute'); form.submit(); }}>保存并执行</Button></Space>}>
    {!canExecute && <Alert type="info" showIcon message="真实执行需管理员配置模型、价格、LLM Judge、每日预算、并发上限和服务端 API 密钥；定义仍可保存。" style={{ marginBottom: 16 }} />}
    <Form form={form} layout="vertical" onFinish={submit}>
      <Row gutter={16}><Col span={16}><Form.Item name="title" label="实验标题" rules={[{ required: true, message: '请输入标题' }]}><Input maxLength={200} /></Form.Item></Col><Col span={8}><Form.Item name="taskId" label="关联任务"><Select allowClear options={tasks.map(task => ({ value: task.id, label: task.title }))} /></Form.Item></Col></Row>
      {!initial && <Form.Item label="使用模板"><Select allowClear placeholder="选择后预填，可继续修改" options={templates.map(template => ({ value: template.id, label: template.name }))} onChange={applyTemplate} /></Form.Item>}
      <Form.Item name="promptVersionId" label="提示词库版本"><Select allowClear placeholder="也可手动填写" options={prompts.map(prompt => ({ value: prompt.version_id, label: `${prompt.name} v${prompt.version}` }))} onChange={value => { const prompt = prompts.find(item => item.version_id === value); if (prompt) form.setFieldValue('systemPrompt', prompt.content); }} /></Form.Item>
      <Form.Item name="systemPrompt" label="System Prompt"><MarkdownEditor rows={5} placeholder="系统提示词" /></Form.Item>
      <Form.Item name="userPrompt" label="User Prompt（支持 {{variable}}）"><MarkdownEditor rows={7} placeholder="例如：解释 {{topic}}" /></Form.Item>
      <Typography.Text type="secondary">变量标记：</Typography.Text><div style={{ whiteSpace: 'pre-wrap', padding: 12, border: '1px solid var(--ant-color-border)', borderRadius: 8, marginBottom: 12 }}>{highlighted(userPrompt || '暂无内容')}</div>
      {needed.length > 0 && <Row gutter={12}>{needed.map(name => <Col span={12} key={name}><Form.Item name={['variables', name]} label={`变量 ${name}`}><Input placeholder={`填写 ${name}`} /></Form.Item></Col>)}</Row>}
      <Typography.Text type="secondary">填充预览：</Typography.Text><div style={{ whiteSpace: 'pre-wrap', padding: 12, border: '1px solid var(--ant-color-border)', borderRadius: 8, marginBottom: 18 }}>{preview || '暂无内容'}</div>
      {missing.length > 0 && <Alert type="warning" showIcon message={`缺少变量 ${missing.join('、')}：可以保存定义，暂不能执行`} style={{ marginBottom: 16 }} />}
      <Form.List name="variants">{(fields, { add, remove }) => <><Typography.Title level={5}>模型与参数变体</Typography.Title>{fields.map((field, index) => <div key={field.key} style={{ padding: 16, marginBottom: 12, border: '1px solid var(--ant-color-border)', borderRadius: 10 }}><Space style={{ width: '100%', justifyContent: 'space-between' }}><Typography.Text strong>变体 {index + 1}</Typography.Text><Button danger type="text" icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>移除</Button></Space><Row gutter={12}><Col span={12}><Form.Item name={[field.name, 'label']} label="名称" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name={[field.name, 'modelId']} label="模型" rules={[{ required: true }]}><Select options={models.map(model => ({ value: model.id, label: model.displayName }))} /></Form.Item></Col></Row><Row gutter={12}>{([['temperature', 0, 2, 0.1], ['top_p', 0, 1, 0.05], ['max_tokens', 1, 32768, 1], ['frequency_penalty', -2, 2, 0.1], ['presence_penalty', -2, 2, 0.1]] as const).map(([key, min, max, step]) => <Col span={12} key={key}><Form.Item label={key}><Space style={{ width: '100%' }}><Form.Item noStyle shouldUpdate>{() => { const path: ['variants', number, 'parameters', typeof key] = ['variants', field.name, 'parameters', key]; const value = form.getFieldValue(path) as number | undefined; return <><Slider min={min} max={max} step={step} value={value} onChange={next => form.setFieldValue(path, next)} style={{ width: 150 }} /><InputNumber min={min} max={max} step={step} value={value} onChange={next => form.setFieldValue(path, next)} style={{ width: 105 }} /></>; }}</Form.Item></Space></Form.Item></Col>)}</Row><Form.Item name={[field.name, 'parameters', 'stop_sequences']} label="停止序列（逗号分隔）" getValueFromEvent={event => event.target.value.split(',').map((value: string) => value.trim()).filter(Boolean)} getValueProps={value => ({ value: Array.isArray(value) ? value.join(', ') : '' })}><Input /></Form.Item></div>)}<Button block type="dashed" icon={<PlusOutlined />} onClick={() => add({ label: `变体 ${fields.length + 1}`, modelId: models[0]?.id || '', parameters: { temperature: 0.7, top_p: 1, max_tokens: 1024, frequency_penalty: 0, presence_penalty: 0, stop_sequences: [] } })}>添加变体</Button></>}</Form.List>
    </Form>
  </Drawer>;
}
