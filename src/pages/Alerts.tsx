import { useCallback, useEffect, useState } from 'react';
import { App, Alert, Button, Card, Drawer, Empty, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, Typography, Upload } from 'antd';
import type { AlertImportRow, AlertIncident, AlertMetricSample, AlertRule, AlertRuleArchive, AlertRuleInput } from '../api/alerts';
import { acknowledgeAlertIncident, createAlertRule, deleteAlertRule, importAlertRules, listAlertIncidents, listAlertMetricSamples, listAlertRules, previewAlertRuleImport, updateAlertRule } from '../api/alerts';
import { getPlatformConfig } from '../api/experiment-platform';

const metrics = [
  ['session_daily_tokens','会话日 token 消耗'], ['session_refusal_streak','连续会话拒答数'],
  ['session_negative_rate','近 1 小时负面标注率 %'], ['model_5xx_rate','模型 5xx 错误率 %'],
  ['model_p50_ms','模型 P50 延迟 ms'], ['model_p95_ms','模型 P95 延迟 ms'],
  ['model_p99_ms','模型 P99 延迟 ms'], ['model_qps','模型 QPS'],
  ['evaluation_pass_rate','近 1 小时评测通过率 %'], ['evaluation_average_score','近 1 小时评测均分'],
  ['governance_daily_cost_usd','今日模型成本 USD'], ['governance_budget_used_percent','月预算使用率 %'],
] as const;
const metricOptions = metrics.map(([value,label]) => ({ value, label }));
const metricLabel = (name: string) => metrics.find(([value]) => value === name)?.[1] || name;
const levelColor = { info: 'blue', warning: 'orange', critical: 'red' };

export default function Alerts() {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<AlertRuleInput>();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [incidents, setIncidents] = useState<AlertIncident[]>([]);
  const [samples, setSamples] = useState<AlertMetricSample[]>([]);
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  const [metric, setMetric] = useState<string>('model_5xx_rate');
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([]);
  const [archive, setArchive] = useState<AlertRuleArchive | null>(null);
  const [importRows, setImportRows] = useState<AlertImportRow[]>([]);
  const [importMode, setImportMode] = useState<'skip' | 'replace'>('skip');
  const [importBusy, setImportBusy] = useState(false);
  const selectedMetric = Form.useWatch('metric', form);

  const refresh = useCallback(async () => {
    try {
      const [ruleResult, incidentResult] = await Promise.all([listAlertRules(), listAlertIncidents()]);
      setRules(ruleResult.items); setSelectedIds(current => current.filter(id => ruleResult.items.some(rule => rule.id === id))); setIncidents(incidentResult.items); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '告警信息加载失败'); }
  }, []);
  const refreshSamples = useCallback(async (selected: string) => {
    try { setSamples((await listAlertMetricSamples(selected)).items); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '指标样本加载失败'); }
  }, [message]);
  useEffect(() => { void refresh(); void getPlatformConfig().then(result => setModels(result.models)).catch(() => undefined); }, [refresh]);
  useEffect(() => { void refreshSamples(metric); }, [metric, refreshSamples]);
  const openCreate = () => {
    setEditing('new');
    form.setFieldsValue({ name: '', metric: 'model_5xx_rate', scopeId: '*', operator: '>', threshold: 5, durationSeconds: 0, level: 'warning', channels: ['in_app'], enabled: false });
  };
  const openEdit = (rule: AlertRule) => {
    setEditing(rule);
    form.setFieldsValue({ name: rule.name, metric: rule.metric, scopeId: rule.scope_id, operator: rule.operator, threshold: Number(rule.threshold), durationSeconds: rule.duration_seconds, level: rule.level, channels: rule.channels, enabled: rule.enabled });
  };
  const save = async (input: AlertRuleInput) => {
    setBusy(true);
    try {
      if (editing === 'new') await createAlertRule(input);
      else if (editing) await updateAlertRule(editing.id, editing.version, input);
      setEditing(null); message.success('告警规则已保存'); await refresh();
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const toggle = async (rule: AlertRule, enabled: boolean) => {
    setBusyId(rule.id);
    try { await updateAlertRule(rule.id, rule.version, { enabled }); await refresh(); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '切换失败'); await refresh(); }
    finally { setBusyId(null); }
  };
  const remove = (rule: AlertRule) => modal.confirm({ title: `删除规则「${rule.name}」？`, content: '历史告警会保留，当前告警将结束。', onOk: async () => {
    try { await deleteAlertRule(rule.id, rule.version); await refresh(); message.success('规则已删除'); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '删除失败'); }
  } });
  const acknowledge = async (incident: AlertIncident) => {
    setBusyId(incident.id);
    try { await acknowledgeAlertIncident(incident.id); await refresh(); message.success('已确认告警'); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '确认失败'); }
    finally { setBusyId(null); }
  };
  const exportSelected = () => {
    const selected = rules.filter(rule => selectedIds.includes(rule.id));
    const content: AlertRuleArchive = { schemaVersion: 1, rules: selected.map(rule => ({
      templateKey: rule.template_key, name: rule.name, metric: rule.metric, scopeId: rule.scope_id,
      operator: rule.operator, threshold: Number(rule.threshold), durationSeconds: rule.duration_seconds,
      level: rule.level, channels: rule.channels, enabled: rule.enabled,
    })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'alert-rules.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const previewArchive = async (value: AlertRuleArchive, mode: 'skip' | 'replace') => {
    setImportBusy(true);
    try { setImportRows((await previewAlertRuleImport(value, mode)).rows); setArchive(value); }
    catch (cause) { setImportRows([]); message.error(cause instanceof Error ? cause.message : '规则预览失败'); }
    finally { setImportBusy(false); }
  };
  const selectArchive = async (file: File) => {
    if (file.size > 1024 * 1024) { message.error('规则文件不能超过 1 MB'); return false; }
    try { await previewArchive(JSON.parse(await file.text()) as AlertRuleArchive, importMode); }
    catch { message.error('规则文件不是有效 JSON'); }
    return false;
  };
  const confirmImport = async () => {
    if (!archive || importRows.some(row => row.error)) return;
    setImportBusy(true);
    try {
      const result = await importAlertRules(archive, importMode, importRows);
      message.success(`新增 ${result.created}、更新 ${result.updated}、跳过 ${result.skipped}`);
      setArchive(null); setImportRows([]); setSelectedIds([]); await refresh();
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '导入失败，请重新预览'); }
    finally { setImportBusy(false); }
  };

  return <Card title="告警规则与事件" extra={<Space><Button onClick={() => { void refresh(); void refreshSamples(metric); }}>刷新</Button><Button disabled={!selectedIds.length} onClick={exportSelected}>导出所选</Button><Upload accept=".json,application/json" showUploadList={false} beforeUpload={file => { void selectArchive(file); return false; }}><Button>导入 JSON</Button></Upload><Button type="primary" onClick={openCreate}>创建规则</Button></Space>}>
    <Typography.Paragraph type="secondary">内置规则默认关闭。启用后，服务每分钟从实际数据采样并判断；无数据时不会将比率视为零。告警首次触发后写入事件并通知管理员。</Typography.Paragraph>
    {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} style={{ marginBottom: 16 }} />}
    <Tabs items={[
      { key: 'rules', label: `规则 ${rules.length}`, children: <Table<AlertRule> rowKey="id" dataSource={rules} rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }} pagination={{ pageSize: 10 }} locale={{ emptyText: <Empty description="暂无规则"><Button onClick={openCreate}>创建规则</Button></Empty> }} columns={[
        { title: '名称', dataIndex: 'name', render: (name: string, rule) => <Space><strong>{name}</strong>{rule.template_key && <Tag>内置</Tag>}</Space> },
        { title: '指标', dataIndex: 'metric', render: metricLabel },
        { title: '条件', render: (_, rule) => `${rule.operator} ${rule.threshold}，持续 ${rule.duration_seconds} 秒` },
        { title: '范围', render: (_, rule) => rule.scope_type === 'global' ? '全局' : rule.scope_id === '*' ? '所有模型' : models.find(model => model.id === rule.scope_id)?.displayName || rule.scope_id },
        { title: '级别', dataIndex: 'level', render: (level: AlertRule['level']) => <Tag color={levelColor[level]}>{level}</Tag> },
        { title: '启用', render: (_, rule) => <Switch aria-label={`启用 ${rule.name}`} checked={rule.enabled} loading={busyId === rule.id} onChange={enabled => void toggle(rule, enabled)} /> },
        { title: '操作', render: (_, rule) => <Space><Button type="link" onClick={() => openEdit(rule)}>编辑</Button>{!rule.template_key && <Button type="link" danger onClick={() => remove(rule)}>删除</Button>}</Space> },
      ]} /> },
      { key: 'incidents', label: `告警事件 ${incidents.length}`, children: <Table<AlertIncident> rowKey="id" dataSource={incidents} pagination={{ pageSize: 10 }} locale={{ emptyText: <Empty description="暂无告警事件" /> }} columns={[
        { title: '触发时间', dataIndex: 'opened_at', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
        { title: '规则', dataIndex: 'rule_name' }, { title: '范围', dataIndex: 'scope_id' },
        { title: '级别', dataIndex: 'level', render: (level: AlertIncident['level']) => <Tag color={levelColor[level]}>{level}</Tag> },
        { title: '状态', dataIndex: 'status', render: (value: string) => <Tag>{value}</Tag> },
        { title: '当前值', dataIndex: 'trigger_value' }, { title: '触发次数', dataIndex: 'trigger_count' },
        { title: '操作', render: (_, item) => item.status === 'firing' ? <Button size="small" loading={busyId === item.id} onClick={() => void acknowledge(item)}>确认</Button> : null },
      ]} /> },
      { key: 'metrics', label: '指标样本', children: <><Select aria-label="查看指标" value={metric} options={metricOptions} onChange={setMetric} style={{ minWidth: 270, marginBottom: 16 }} /><Table<AlertMetricSample> rowKey={item => `${item.metric}:${item.scope_id}:${item.sampled_at}`} dataSource={samples} pagination={{ pageSize: 15 }} locale={{ emptyText: <Empty description="暂无采样数据" /> }} columns={[
        { title: '时间', dataIndex: 'sampled_at', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
        { title: '指标', dataIndex: 'metric', render: metricLabel }, { title: '范围', dataIndex: 'scope_id' },
        { title: '值', dataIndex: 'value' }, { title: '来源条数', dataIndex: 'source_count' },
      ]} /></> },
    ]} />
    <Drawer title={editing === 'new' ? '创建告警规则' : '编辑告警规则'} open={Boolean(editing)} width={520} onClose={() => setEditing(null)} extra={<Button type="primary" loading={busy} onClick={() => form.submit()}>保存</Button>}>
      <Form form={form} layout="vertical" onFinish={value => void save(value)}>
        <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="metric" label="指标" rules={[{ required: true }]}><Select options={metricOptions} onChange={() => form.setFieldValue('scopeId', '*')} /></Form.Item>
        {selectedMetric?.startsWith('model_') && <Form.Item name="scopeId" label="模型范围"><Select options={[{ value: '*', label: '所有模型' }, ...models.map(model => ({ value: model.id, label: model.displayName }))]} /></Form.Item>}
        <Space align="start"><Form.Item name="operator" label="比较符"><Select style={{ width: 90 }} options={['>','<','=','>=','<='].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="threshold" label="阈值" rules={[{ required: true }]}><InputNumber style={{ width: 150 }} /></Form.Item><Form.Item name="durationSeconds" label="持续秒数"><InputNumber min={0} max={86400} precision={0} style={{ width: 150 }} /></Form.Item></Space>
        <Form.Item name="level" label="级别"><Select options={[{value:'info',label:'Info · 仅记录'},{value:'warning',label:'Warning · 通知管理员'},{value:'critical',label:'Critical · 高优先级'}]} /></Form.Item>
        <Form.Item name="channels" label="通知渠道"><Select mode="multiple" options={[{value:'in_app',label:'站内通知'},{value:'email',label:'账号已启用的邮件'}]} /></Form.Item>
        <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Drawer>
    <Modal title="预览导入规则" open={Boolean(archive)} onCancel={() => { setArchive(null); setImportRows([]); }} onOk={() => void confirmImport()} okText="确认导入" okButtonProps={{ disabled: importRows.length === 0 || importRows.some(row => row.error), loading: importBusy }} width={760}>
      <Space style={{ marginBottom: 12 }}>同名规则<Select aria-label="同名规则处理" value={importMode} style={{ width: 160 }} options={[{value:'skip',label:'跳过已有'},{value:'replace',label:'覆盖已有'}]} onChange={mode => { setImportMode(mode); if (archive) void previewArchive(archive,mode); }} /></Space>
      <Table<AlertImportRow> rowKey="index" size="small" dataSource={importRows} pagination={{ pageSize: 8 }} columns={[{title:'规则名称',dataIndex:'name'},{title:'处理',dataIndex:'status',render:(value:string)=>value==='error'?<Tag color="red">无效</Tag>:value==='create'?'新增':value==='update'?'覆盖':'跳过'},{title:'原因',dataIndex:'error',render:(value:string|null)=>value||'—'}]} />
    </Modal>
  </Card>;
}
