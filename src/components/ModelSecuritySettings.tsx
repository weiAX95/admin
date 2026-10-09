import { useEffect, useState } from 'react';
import { Alert, App, Button, Input, Select, Space, Spin, Switch, Table, Typography } from 'antd';
import type { ModelConfig } from '../api/experiment-platform';
import { getModelSecurityPolicy, saveModelSecurityPolicy, listModelSecurityEvents, type ModelSecurityEvent, type ModelSecurityPolicy } from '../api/model-security';

const splitTerms = (value: string) => value.split(/[,，\n]/).map(part => part.trim()).filter(Boolean);
export default function ModelSecuritySettings({ models }: { models: ModelConfig[] }) {
  const { message } = App.useApp();
  const [modelId, setModelId] = useState('');
  const [policy, setPolicy] = useState<ModelSecurityPolicy | null>(null);
  const [sensitiveText, setSensitiveText] = useState('');
  const [brandText, setBrandText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<ModelSecurityEvent[]>([]);
  useEffect(() => { void listModelSecurityEvents().then(value => setEvents(value.items)).catch(() => undefined); }, []);
  useEffect(() => {
    if (!modelId) return;
    let active = true;
    setLoading(true);
    void getModelSecurityPolicy(modelId).then(value => { if (active) { setPolicy(value); setSensitiveText(value.sensitiveWords.join('\n')); setBrandText(value.brandTerms.join('\n')); setError(''); } }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [modelId]);
  const update = (change: Partial<ModelSecurityPolicy>) => setPolicy(current => current ? { ...current, ...change } : null);
  const save = async () => {
    if (!policy) return;
    setSaving(true);
    try { const value = await saveModelSecurityPolicy({ ...policy, sensitiveWords: splitTerms(sensitiveText), brandTerms: splitTerms(brandText) }); setPolicy(value); setError(''); message.success('安全策略已保存'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setSaving(false); }
  };
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Typography.Paragraph type="secondary">规则只作用于本服务执行的实验与评测模型调用；默认关闭。输入命中时阻断，输出命中时替换。检测仅覆盖已配置模式，媒体内容不会被文本规则扫描。</Typography.Paragraph>
    <Select aria-label="安全策略模型" placeholder="选择模型" style={{ width: 280 }} value={modelId || undefined} onChange={value => { setModelId(value); setPolicy(null); }} options={models.map(item => ({ value: item.id, label: item.displayName }))} />
    {error && <Alert type="error" showIcon message={error} />}
    {loading && <Spin />}
    {policy && <>
      <Space wrap><Switch checked={policy.inputPii} onChange={value => update({ inputPii: value })} aria-label="输入 PII 检测" />输入 PII 检测 <Switch checked={policy.inputJailbreak} onChange={value => update({ inputJailbreak: value })} aria-label="输入越狱检测" />输入越狱检测 <Switch checked={policy.outputPii} onChange={value => update({ outputPii: value })} aria-label="输出 PII 检测" />输出 PII 检测</Space>
      <Input.TextArea aria-label="输入敏感词" placeholder="输入敏感词，每行一个" rows={3} value={sensitiveText} onChange={event => setSensitiveText(event.target.value)} />
      <Input.TextArea aria-label="输出品牌风险词" placeholder="输出品牌风险词，每行一个" rows={3} value={brandText} onChange={event => setBrandText(event.target.value)} />
      <Button type="primary" loading={saving} onClick={() => void save()}>保存安全策略</Button>
    </>}
    <Typography.Title level={5}>最近安全事件</Typography.Title>
    <Table rowKey="id" size="small" dataSource={events} pagination={{ pageSize: 5 }} scroll={{ x: 650 }} columns={[
      { title: '时间', dataIndex: 'createdAt', render: value => new Date(value).toLocaleString('zh-CN') },
      { title: '模型', dataIndex: 'modelName' },
      { title: '阶段', dataIndex: 'phase', render: value => value === 'judge' ? 'Judge' : '主模型' },
      { title: '方向', dataIndex: 'direction', render: value => value === 'input' ? '输入' : '输出' },
      { title: '规则', dataIndex: 'rule' },
      { title: '动作', dataIndex: 'action', render: value => value === 'blocked' ? '阻断' : '替换' },
    ]} />
  </Space>;
}
