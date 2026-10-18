import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Alert, Button, Card, DatePicker, Drawer, Empty, Form, Input, InputNumber, Modal, Select, Space, Spin, Switch, Table, Tabs, Tag, Typography, Upload } from 'antd';
import type { AlertAnalytics as AlertAnalyticsData, AlertAssignee, AlertGroup, AlertImportRow, AlertIncident, AlertIncidentEvent, AlertIncidentQuery, AlertMetricSample, AlertRule, AlertRuleArchive, AlertRuleInput, AlertRulePreview, AlertSilence, AlertSilenceInput } from '../api/alerts';
import { acknowledgeAlertIncident, addAlertIncidentNote, assignAlertIncident, createAlertRule, createAlertSilence, deleteAlertRule, deleteAlertSilence, getAlertAnalytics, getAlertChannelTest, importAlertRules, listAlertAssignees, listAlertGroupIncidents, listAlertGroups, listAlertIncidentEvents, listAlertIncidents, listAlertMetricSamples, listAlertRules, listAlertSilences, previewAlertRule, previewAlertRuleImport, resolveAlertIncident, sendAlertChannelTest, updateAlertRule, updateAlertSilence } from '../api/alerts';
import { getPlatformConfig } from '../api/experiment-platform';
import { listWebhooks, type WebhookConfig } from '../api/outbound-webhooks';
import AlertAnalytics from '../components/AlertAnalytics';

const metrics = [
  ['session_daily_tokens','会话日 token 消耗'], ['session_refusal_streak','连续会话拒答数'],
  ['session_refusal_rate','近 1 小时会话拒答率 %'],
  ['session_negative_rate','近 1 小时负面标注率 %'], ['model_5xx_rate','模型 5xx 错误率 %'],
  ['model_p50_ms','模型 P50 延迟 ms'], ['model_p95_ms','模型 P95 延迟 ms'],
  ['model_p99_ms','模型 P99 延迟 ms'], ['model_qps','模型 QPS'],
  ['model_rate_rejections_5m','模型近 5 分钟限流拒绝次数'],
  ['evaluation_pass_rate','近 1 小时评测通过率 %'], ['evaluation_average_score','近 1 小时评测均分'],
  ['governance_daily_cost_usd','今日模型成本 USD'], ['governance_budget_used_percent','月预算使用率 %'],
] as const;
const metricOptions = metrics.map(([value,label]) => ({ value, label }));
const metricLabel = (name: string) => metrics.find(([value]) => value === name)?.[1] || name;
const levelColor = { info: 'blue', warning: 'orange', critical: 'red' };
const eventLabel = { opened: '触发', escalated: '升级', acknowledged: '确认', assigned: '指派', note: '备注', resolved: '解决', reminded: '重复提醒' };
const minuteLabel = (value: number) => `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`;
const parseMinute = (value: string) => { const match = /^(\d{2}):(\d{2})$/.exec(value); return match ? Number(match[1]) * 60 + Number(match[2]) : -1; };

export default function Alerts() {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<AlertRuleInput>();
  const [silenceForm] = Form.useForm<AlertSilenceInput & { startTime: string; endTime: string }>();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [silences, setSilences] = useState<AlertSilence[]>([]);
  const [silenceEditing, setSilenceEditing] = useState<AlertSilence | 'new' | null>(null);
  const [incidents, setIncidents] = useState<AlertIncident[]>([]);
  const [groups, setGroups] = useState<AlertGroup[]>([]);
  const [groupTotal, setGroupTotal] = useState(0);
  const [groupPage, setGroupPage] = useState(1);
  const [groupDetails, setGroupDetails] = useState<Record<string,{ items: AlertIncident[]; total: number }>>({});
  const [groupLoading, setGroupLoading] = useState<string | null>(null);
  const [channelTest, setChannelTest] = useState<{ id: string; channel: string; status: string } | null>(null);
  const [incidentTotal, setIncidentTotal] = useState(0);
  const [incidentQuery, setIncidentQuery] = useState<AlertIncidentQuery>({ limit: 20, offset: 0 });
  const [analyticsDays, setAnalyticsDays] = useState<7 | 30 | 90>(30);
  const [analyticsLevel, setAnalyticsLevel] = useState<string | undefined>();
  const [analytics, setAnalytics] = useState<AlertAnalyticsData | null>(null);
  const incidentRequest = useRef(0);
  const analyticsRequest = useRef(0);
  const groupRequest = useRef(0);
  const [samples, setSamples] = useState<AlertMetricSample[]>([]);
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
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
  const [preview, setPreview] = useState<AlertRulePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [channelTestBusy, setChannelTestBusy] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<AlertIncident | null>(null);
  const [incidentEvents, setIncidentEvents] = useState<AlertIncidentEvent[]>([]);
  const [assignees, setAssignees] = useState<AlertAssignee[]>([]);
  const [incidentNote, setIncidentNote] = useState('');
  const selectedMetric = Form.useWatch('metric', form);
  const selectedChannels = Form.useWatch('channels', form);
  const silenceScope = Form.useWatch('scopeType', silenceForm);

  const refresh = useCallback(async () => {
    const request = ++incidentRequest.current;
    try {
      const [ruleResult, incidentResult, silenceResult] = await Promise.all([listAlertRules(), listAlertIncidents(incidentQuery), listAlertSilences()]);
      if (request !== incidentRequest.current) return;
      setRules(ruleResult.items); setSelectedIds(current => current.filter(id => ruleResult.items.some(rule => rule.id === id))); setIncidents(incidentResult.items); setIncidentTotal(incidentResult.total); setSilences(silenceResult.items); setError('');
    } catch (cause) { if (request === incidentRequest.current) setError(cause instanceof Error ? cause.message : '告警信息加载失败'); }
  }, [incidentQuery]);
  const loadAnalytics = useCallback(async () => {
    const request = ++analyticsRequest.current;
    try { const result = await getAlertAnalytics(analyticsDays,analyticsLevel); if (request === analyticsRequest.current) setAnalytics(result); }
    catch (cause) { if (request === analyticsRequest.current) message.error(cause instanceof Error ? cause.message : '告警分析加载失败'); }
  }, [analyticsDays,analyticsLevel,message]);
  const refreshSamples = useCallback(async (selected: string) => {
    try { setSamples((await listAlertMetricSamples(selected)).items); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '指标样本加载失败'); }
  }, [message]);
  const refreshGroups = useCallback(async () => {
    const request = ++groupRequest.current;
    try { const result = await listAlertGroups((groupPage-1)*20); if (request === groupRequest.current) { setGroups(result.items); setGroupTotal(result.total); } }
    catch (cause) { if (request === groupRequest.current) message.error(cause instanceof Error ? cause.message : '聚合告警加载失败'); }
  }, [groupPage,message]);
  const expandGroup = async (expanded: boolean, group: AlertGroup) => {
    if (!expanded) return;
    setGroupLoading(group.id);
    try { const result = await listAlertGroupIncidents(group.id); setGroupDetails(current => ({...current,[group.id]:result})); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '聚合明细加载失败'); }
    finally { setGroupLoading(null); }
  };
  const sendChannelTest = async (channel: 'in_app' | 'email') => {
    setChannelTestBusy(true);
    try { setChannelTest(await sendAlertChannelTest(channel)); message.success(channel === 'email' ? '测试邮件已入队' : '站内测试通知已创建'); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '渠道测试失败'); }
    finally { setChannelTestBusy(false); }
  };
  const refreshChannelTest = async () => {
    if (!channelTest) return;
    try { const latest = await getAlertChannelTest(channelTest.id); setChannelTest({ ...channelTest, status: latest.status }); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '测试状态读取失败'); }
  };
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void getPlatformConfig().then(result => setModels(result.models)).catch(() => undefined); void listWebhooks().then(result => setWebhooks(result.items)).catch(() => undefined); }, []);
  useEffect(() => { void refreshSamples(metric); }, [metric, refreshSamples]);
  useEffect(() => { void refreshGroups(); }, [refreshGroups]);
  useEffect(() => { void loadAnalytics(); }, [loadAnalytics]);
  const openCreate = () => {
    setEditing('new');
    form.setFieldsValue({ name: '', metric: 'model_5xx_rate', scopeId: '*', operator: '>', threshold: 5, durationSeconds: 0, repeatMinutes: 30, aggregateMinutes: 5, level: 'warning', channels: ['in_app'], webhookIds: [], tags: [], enabled: false });
  };
  const openEdit = (rule: AlertRule) => {
    setEditing(rule);
    form.setFieldsValue({ name: rule.name, metric: rule.metric, scopeId: rule.scope_id, operator: rule.operator, threshold: Number(rule.threshold), durationSeconds: rule.duration_seconds, repeatMinutes: rule.repeat_minutes, aggregateMinutes: rule.aggregate_minutes, level: rule.level, channels: rule.channels, webhookIds: rule.webhook_ids, tags: rule.tags, enabled: rule.enabled });
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
    try { await acknowledgeAlertIncident(incident.id); await Promise.all([refresh(),refreshGroups(),loadAnalytics()]); message.success('已确认告警'); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '确认失败'); }
    finally { setBusyId(null); }
  };
  const openIncident = async (incident: AlertIncident) => {
    setSelectedIncident(incident);
    setIncidentEvents([]); setIncidentNote('');
    try {
      const [history, users] = await Promise.all([listAlertIncidentEvents(incident.id), listAlertAssignees()]);
      setIncidentEvents(history.items); setAssignees(users.items.filter(user => user.status === 'active'));
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '处置记录加载失败'); }
  };
  const incidentAction = async (action: 'assign' | 'note' | 'resolve', userId?: string) => {
    if (!selectedIncident) return;
    setBusyId(selectedIncident.id);
    try {
      if (action === 'assign' && userId) await assignAlertIncident(selectedIncident.id, userId);
      else if (action === 'note') await addAlertIncidentNote(selectedIncident.id, incidentNote);
      else if (action === 'resolve') await resolveAlertIncident(selectedIncident.id, incidentNote);
      setIncidentNote('');
      const [history, latest] = await Promise.all([listAlertIncidentEvents(selectedIncident.id), listAlertIncidents(incidentQuery)]);
      setIncidentEvents(history.items); setIncidents(latest.items); setIncidentTotal(latest.total);
      setSelectedIncident(latest.items.find(item => item.id === selectedIncident.id) || null);
      void loadAnalytics(); void refreshGroups();
      message.success(action === 'resolve' ? '告警已解决' : action === 'assign' ? '已指派处理人' : '处置备注已保存');
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '处置失败'); }
    finally { setBusyId(null); }
  };
  const openSilence = (item: AlertSilence | 'new') => {
    setSilenceEditing(item);
    silenceForm.setFieldsValue(item === 'new'
      ? { name: '', scopeType: 'all', scopeValue: null, timezone: 'Asia/Shanghai', startTime: '02:00', endTime: '06:00', enabled: true }
      : { name: item.name, scopeType: item.scope_type, scopeValue: item.scope_value, timezone: item.timezone, startTime: minuteLabel(item.start_minute), endTime: minuteLabel(item.end_minute), enabled: item.enabled });
  };
  const saveSilence = async (value: AlertSilenceInput & { startTime: string; endTime: string }) => {
    const input: AlertSilenceInput = { name: value.name, scopeType: value.scopeType, scopeValue: value.scopeType === 'all' ? null : value.scopeValue,
      timezone: value.timezone, startMinute: parseMinute(value.startTime), endMinute: parseMinute(value.endTime), enabled: value.enabled };
    setBusy(true);
    try {
      if (silenceEditing === 'new') await createAlertSilence(input);
      else if (silenceEditing) await updateAlertSilence(silenceEditing.id,silenceEditing.version,input);
      setSilenceEditing(null); await refresh(); message.success('静默规则已保存');
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '静默规则保存失败'); }
    finally { setBusy(false); }
  };
  const removeSilence = (item: AlertSilence) => modal.confirm({ title: `删除静默规则「${item.name}」？`, onOk: async () => {
    try { await deleteAlertSilence(item.id,item.version); await refresh(); message.success('静默规则已删除'); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '删除失败'); }
  } });
  const exportSelected = () => {
    const selected = rules.filter(rule => selectedIds.includes(rule.id));
    const content: AlertRuleArchive = { schemaVersion: 1, rules: selected.map(rule => ({
      templateKey: rule.template_key, name: rule.name, metric: rule.metric, scopeId: rule.scope_id,
      operator: rule.operator, threshold: Number(rule.threshold), durationSeconds: rule.duration_seconds, repeatMinutes: rule.repeat_minutes, aggregateMinutes: rule.aggregate_minutes,
      level: rule.level, channels: rule.channels, webhookIds: rule.webhook_ids, tags: rule.tags, enabled: rule.enabled,
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
  const previewCurrent = async () => {
    let value: AlertRuleInput;
    try { value = await form.validateFields(); }
    catch { return; }
    setPreviewBusy(true);
    try { setPreview(await previewAlertRule(value)); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '规则预览失败'); }
    finally { setPreviewBusy(false); }
  };

  return <Card title="告警规则与事件" extra={<Space><Button onClick={() => { void refresh(); void refreshGroups(); void refreshSamples(metric); void loadAnalytics(); }}>刷新</Button><Button disabled={!selectedIds.length} onClick={exportSelected}>导出所选</Button><Upload accept=".json,application/json" showUploadList={false} beforeUpload={file => { void selectArchive(file); return false; }}><Button>导入 JSON</Button></Upload><Button type="primary" onClick={openCreate}>创建规则</Button></Space>}>
    <Typography.Paragraph type="secondary">内置规则默认关闭。启用后，服务每分钟从实际数据采样并判断；无数据时不会将比率视为零。告警首次触发后写入事件并通知管理员。</Typography.Paragraph>
    {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} style={{ marginBottom: 16 }} />}
    <Tabs items={[
      { key: 'rules', label: `规则 ${rules.length}`, children: <Table<AlertRule> rowKey="id" dataSource={rules} rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }} pagination={{ pageSize: 10 }} locale={{ emptyText: <Empty description="暂无规则"><Button onClick={openCreate}>创建规则</Button></Empty> }} columns={[
        { title: '名称', dataIndex: 'name', render: (name: string, rule) => <Space><strong>{name}</strong>{rule.template_key && <Tag>内置</Tag>}</Space> },
        { title: '指标', dataIndex: 'metric', render: metricLabel },
        { title: '条件', render: (_, rule) => `${rule.operator} ${rule.threshold}，持续 ${rule.duration_seconds} 秒；${rule.aggregate_minutes} 分钟聚合；每 ${rule.repeat_minutes} 分钟提醒` },
        { title: '范围', render: (_, rule) => rule.scope_type === 'global' ? '全局' : rule.scope_id === '*' ? '所有模型' : models.find(model => model.id === rule.scope_id)?.displayName || rule.scope_id },
        { title: '级别', dataIndex: 'level', render: (level: AlertRule['level']) => <Tag color={levelColor[level]}>{level}</Tag> },
        { title: '启用', render: (_, rule) => <Switch aria-label={`启用 ${rule.name}`} checked={rule.enabled} loading={busyId === rule.id} onChange={enabled => void toggle(rule, enabled)} /> },
        { title: '操作', render: (_, rule) => <Space><Button type="link" onClick={() => openEdit(rule)}>编辑</Button>{!rule.template_key && <Button type="link" danger onClick={() => remove(rule)}>删除</Button>}</Space> },
      ]} /> },
      { key: 'silences', label: `静默 ${silences.length}`, children: <><Button type="primary" style={{ marginBottom: 12 }} onClick={() => openSilence('new')}>创建静默规则</Button><Table<AlertSilence> rowKey="id" dataSource={silences} pagination={{ pageSize: 10 }} locale={{ emptyText: <Empty description="暂无静默规则" /> }} columns={[
        { title: '名称', dataIndex: 'name' },
        { title: '范围', render: (_, item) => item.scope_type === 'all' ? '全部 Warning' : `${item.scope_type === 'module' ? '模块' : '标签'}：${item.scope_value}` },
        { title: '每日时段', render: (_, item) => `${minuteLabel(item.start_minute)}–${minuteLabel(item.end_minute)} (${item.timezone})` },
        { title: '状态', dataIndex: 'enabled', render: (value: boolean) => value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag> },
        { title: '操作', render: (_, item) => <Space><Button type="link" onClick={() => openSilence(item)}>编辑</Button><Button type="link" danger onClick={() => removeSilence(item)}>删除</Button></Space> },
      ]} /></> },
      { key: 'incidents', label: `告警事件 ${incidentTotal}`, children: <><Space wrap style={{ marginBottom: 12 }}>
        <Select aria-label="按状态筛选告警" placeholder="全部状态" allowClear value={incidentQuery.status} style={{ width: 145 }} options={[{value:'firing',label:'触发中'},{value:'acknowledged',label:'已确认'},{value:'resolved',label:'已解决'}]} onChange={status => setIncidentQuery(query => ({...query,status,offset:0}))} />
        <Select aria-label="按级别筛选告警" placeholder="全部级别" allowClear value={incidentQuery.level} style={{ width: 145 }} options={['info','warning','critical'].map(value => ({value,label:value}))} onChange={level => setIncidentQuery(query => ({...query,level,offset:0}))} />
        <DatePicker.RangePicker aria-label="告警时间范围" onChange={dates => setIncidentQuery(query => ({...query,from:dates?.[0]?.startOf('day').toISOString(),to:dates?.[1]?.endOf('day').toISOString(),offset:0}))} />
      </Space><Table<AlertIncident> rowKey="id" dataSource={incidents} pagination={{ current: Math.floor((incidentQuery.offset || 0) / 20) + 1, pageSize: 20, total: incidentTotal, onChange: page => setIncidentQuery(query => ({...query,offset:(page-1)*20})) }} locale={{ emptyText: <Empty description="暂无告警事件" /> }} columns={[
        { title: '触发时间', dataIndex: 'opened_at', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
        { title: '规则', dataIndex: 'rule_name' }, { title: '范围', dataIndex: 'scope_id' },
        { title: '级别', render: (_, item) => <Space><Tag color={levelColor[item.level]}>{item.level}</Tag>{item.escalated_at && <Tag color="red">30 分钟未确认升级</Tag>}</Space> },
        { title: '状态', dataIndex: 'status', render: (value: string) => <Tag>{value}</Tag> },
        { title: '当前值', dataIndex: 'trigger_value' }, { title: '触发次数', dataIndex: 'trigger_count' },
        { title: '操作', render: (_, item) => <Space><Button size="small" onClick={() => void openIncident(item)}>处置记录</Button>{item.status === 'firing' && <Button size="small" loading={busyId === item.id} onClick={() => void acknowledge(item)}>确认</Button>}</Space> },
      ]} /></> },
      { key: 'groups', label: `聚合告警 ${groupTotal}`, children: <Table<AlertGroup> rowKey="id" dataSource={groups} pagination={{ current: groupPage, pageSize: 20, total: groupTotal, onChange: setGroupPage }} expandable={{ onExpand: (expanded, group) => void expandGroup(expanded, group), expandedRowRender: group => {
        const detail = groupDetails[group.id];
        if (!detail) return <Spin spinning={groupLoading === group.id}><div style={{ minHeight: 52 }}>加载聚合明细…</div></Spin>;
        return <><Typography.Paragraph type="secondary">窗口内已触发 {detail.total} 次；{detail.total > detail.items.length ? `显示前 ${detail.items.length} 次。` : '以下保留每次事件的独立处置历史。'}</Typography.Paragraph><Table<AlertIncident> size="small" rowKey="id" pagination={{ pageSize: 10 }} dataSource={detail.items} columns={[
          { title: '触发时间', dataIndex: 'opened_at', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
          { title: '状态', dataIndex: 'status' }, { title: '触发值', dataIndex: 'trigger_value' },
          { title: '操作', render: (_, item) => <Button size="small" onClick={() => void openIncident(item)}>处置记录</Button> },
        ]} /></>;
      } }} columns={[
        { title: '规则', dataIndex: 'rule_name' }, { title: '范围', dataIndex: 'scope_id' },
        { title: '级别', dataIndex: 'level', render: (value: AlertGroup['level']) => <Tag color={levelColor[value]}>{value}</Tag> },
        { title: '状态', dataIndex: 'status' },
        { title: '聚合窗口', render: (_, group) => `${new Date(group.opened_at).toLocaleString('zh-CN')} – ${new Date(group.window_end).toLocaleString('zh-CN')}` },
        { title: '触发', dataIndex: 'incident_count', render: (count: number) => `已触发 ${count} 次` },
      ]} /> },
      { key: 'channels', label: '渠道测试', children: <Card size="small"><Typography.Paragraph>站内测试通知会发送到当前管理员的顶部铃铛。邮件测试只发送到当前账号在个人设置中启用的收件邮箱；SMTP 未配置时会明确拒绝。Webhook 可在系统设置的出站 Webhook 列表中逐条测试并查看投递日志。</Typography.Paragraph><Space wrap><Button loading={channelTestBusy} onClick={() => void sendChannelTest('in_app')}>测试站内通知</Button><Button loading={channelTestBusy} onClick={() => void sendChannelTest('email')}>测试邮件</Button><a href="/settings">管理与测试 Webhook</a></Space>{channelTest && <Typography.Paragraph style={{ marginTop: 16 }}>最近测试：{channelTest.channel === 'email' ? '邮件' : '站内'} · {channelTest.status} <Button type="link" onClick={() => void refreshChannelTest()}>刷新状态</Button></Typography.Paragraph>}</Card> },
      { key: 'analytics', label: '历史分析', children: <><Space style={{ marginBottom: 12 }}><Select aria-label="分析时间窗口" value={analyticsDays} style={{ width: 140 }} options={[{value:7,label:'近 7 天'},{value:30,label:'近 30 天'},{value:90,label:'近 90 天'}]} onChange={setAnalyticsDays} /><Select aria-label="分析告警级别" placeholder="全部级别" allowClear value={analyticsLevel} style={{ width: 145 }} options={['info','warning','critical'].map(value => ({value,label:value}))} onChange={setAnalyticsLevel} /></Space><AlertAnalytics data={analytics} /></> },
      { key: 'metrics', label: '指标样本', children: <><Select aria-label="查看指标" value={metric} options={metricOptions} onChange={setMetric} style={{ minWidth: 270, marginBottom: 16 }} /><Table<AlertMetricSample> rowKey={item => `${item.metric}:${item.scope_id}:${item.sampled_at}`} dataSource={samples} pagination={{ pageSize: 15 }} locale={{ emptyText: <Empty description="暂无采样数据" /> }} columns={[
        { title: '时间', dataIndex: 'sampled_at', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
        { title: '指标', dataIndex: 'metric', render: metricLabel }, { title: '范围', dataIndex: 'scope_id' },
        { title: '值', dataIndex: 'value' }, { title: '来源条数', dataIndex: 'source_count' },
      ]} /></> },
    ]} />
    <Drawer title={editing === 'new' ? '创建告警规则' : '编辑告警规则'} open={Boolean(editing)} width={520} onClose={() => setEditing(null)} extra={<Space><Button loading={previewBusy} onClick={() => void previewCurrent()}>预览近 7 天</Button><Button type="primary" loading={busy} onClick={() => form.submit()}>保存</Button></Space>}>
      <Form form={form} layout="vertical" onFinish={value => void save(value)}>
        <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="metric" label="指标" rules={[{ required: true }]}><Select options={metricOptions} onChange={() => form.setFieldValue('scopeId', '*')} /></Form.Item>
        {selectedMetric?.startsWith('model_') && <Form.Item name="scopeId" label="模型范围"><Select options={[{ value: '*', label: '所有模型' }, ...models.map(model => ({ value: model.id, label: model.displayName }))]} /></Form.Item>}
        <Space align="start"><Form.Item name="operator" label="比较符"><Select style={{ width: 90 }} options={['>','<','=','>=','<='].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="threshold" label="阈值" rules={[{ required: true }]}><InputNumber style={{ width: 150 }} /></Form.Item><Form.Item name="durationSeconds" label="持续秒数"><InputNumber min={0} max={86400} precision={0} style={{ width: 150 }} /></Form.Item></Space>
        <Form.Item name="repeatMinutes" label="未确认时重复提醒间隔（分钟）"><InputNumber min={1} max={1440} precision={0} style={{ width: 150 }} /></Form.Item>
        <Form.Item name="aggregateMinutes" label="再次触发聚合窗口（分钟）"><InputNumber min={1} max={1440} precision={0} style={{ width: 150 }} /></Form.Item>
        <Form.Item name="level" label="级别"><Select options={[{value:'info',label:'Info · 仅记录'},{value:'warning',label:'Warning · 通知管理员'},{value:'critical',label:'Critical · 高优先级'}]} /></Form.Item>
        <Form.Item name="channels" label="通知渠道" extra="Critical 始终通知站内，并向已启用邮箱的管理员发送邮件；所选 Webhook 另行投递。"><Select mode="multiple" options={[{value:'in_app',label:'站内通知'},{value:'email',label:'账号已启用的邮件'},{value:'webhook',label:'已配置的出站 Webhook'}]} onChange={channels => { if (!channels.includes('webhook')) form.setFieldValue('webhookIds',[]); }} /></Form.Item>
        {selectedChannels?.includes('webhook') && <Form.Item name="webhookIds" label="选择告警 Webhook（可多选）" rules={[{required:true,message:'请至少选择一个告警 Webhook'}]}><Select mode="multiple" options={webhooks.filter(hook => hook.event === 'alert.firing' && !hook.deletedAt).map(hook => ({value:hook.id,label:`${hook.url}${hook.enabled?'':'（已停用）'}`}))} /></Form.Item>}
        <Form.Item name="tags" label="规则标签（用于静默）"><Select mode="tags" maxCount={20} placeholder="输入标签后回车" /></Form.Item>
        <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Drawer>
    <Drawer title={silenceEditing === 'new' ? '创建静默规则' : '编辑静默规则'} open={Boolean(silenceEditing)} width={500} onClose={() => setSilenceEditing(null)} extra={<Button type="primary" loading={busy} onClick={() => silenceForm.submit()}>保存</Button>}>
      <Typography.Paragraph type="secondary">静默时仍记录告警，只暂停 Warning 的首次及重复通知；Critical 继续通知。跨午夜时段也适用。</Typography.Paragraph>
      <Form form={silenceForm} layout="vertical" onFinish={value => void saveSilence(value)}>
        <Form.Item name="name" label="名称" rules={[{required:true}]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="scopeType" label="静默范围"><Select options={[{value:'all',label:'全部 Warning'},{value:'module',label:'指定模块'},{value:'tag',label:'指定标签'}]} onChange={() => silenceForm.setFieldValue('scopeValue',null)} /></Form.Item>
        {silenceScope === 'module' && <Form.Item name="scopeValue" label="模块" rules={[{required:true}]}><Select options={['session','model','evaluation','governance'].map(value => ({value,label:value}))} /></Form.Item>}
        {silenceScope === 'tag' && <Form.Item name="scopeValue" label="规则标签" rules={[{required:true}]}><Input maxLength={32} placeholder="与告警规则标签一致" /></Form.Item>}
        <Form.Item name="timezone" label="时区" rules={[{required:true}]}><Input placeholder="Asia/Shanghai" /></Form.Item>
        <Space align="start"><Form.Item name="startTime" label="每日开始" rules={[{required:true}]}><Input type="time" /></Form.Item><Form.Item name="endTime" label="每日结束" rules={[{required:true}]}><Input type="time" /></Form.Item></Space>
        <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Drawer>
    <Drawer title={selectedIncident ? `告警处置 · ${selectedIncident.rule_name}` : '告警处置'} open={Boolean(selectedIncident)} width={560} onClose={() => setSelectedIncident(null)}>
      {selectedIncident && <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space><Tag color={levelColor[selectedIncident.level]}>{selectedIncident.level}</Tag><Tag>{selectedIncident.status}</Tag><span>当前值 {selectedIncident.trigger_value}</span></Space>
        <Space>处理人<Select aria-label="选择告警处理人" disabled={selectedIncident.status === 'resolved'} value={selectedIncident.assigned_to || undefined} placeholder="未指派" style={{ minWidth: 220 }} options={assignees.map(user => ({ value: user.id, label: user.name || user.username }))} onChange={userId => void incidentAction('assign', userId)} /></Space>
        <Input.TextArea aria-label="处置说明" value={incidentNote} onChange={event => setIncidentNote(event.target.value)} maxLength={2000} showCount rows={3} placeholder="记录排查或解决原因" />
        <Space><Button loading={busyId === selectedIncident.id} disabled={!incidentNote.trim()} onClick={() => void incidentAction('note')}>添加备注</Button><Button type="primary" loading={busyId === selectedIncident.id} disabled={selectedIncident.status === 'resolved' || !incidentNote.trim()} onClick={() => void incidentAction('resolve')}>解决告警</Button></Space>
        <Typography.Title level={5}>处置时间线</Typography.Title>
        {incidentEvents.length ? incidentEvents.map(event => <Card size="small" key={event.id}><Space><Tag>{eventLabel[event.event_type]}</Tag><span>{new Date(event.occurred_at).toLocaleString('zh-CN')}</span><span>{event.actor_name || '系统'}</span></Space>{event.detail && <Typography.Paragraph style={{ marginBottom: 0, marginTop: 8 }}>{event.event_type === 'assigned' ? `处理人：${assignees.find(user => user.id === event.detail)?.name || event.detail}` : event.detail}</Typography.Paragraph>}</Card>) : <Empty description="暂无处置记录" />}
      </Space>}
    </Drawer>
    <Modal title="规则历史预览" open={Boolean(preview)} onCancel={() => setPreview(null)} footer={<Button onClick={() => setPreview(null)}>关闭</Button>}>
      <Typography.Paragraph>预计触发 {preview?.triggers ?? 0} 次；首次触发：{preview?.firstTriggerAt ? new Date(preview.firstTriggerAt).toLocaleString('zh-CN') : '无'}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">样本 {preview?.sampleCount ?? 0} 条，范围 {preview?.firstSampleAt ? new Date(preview.firstSampleAt).toLocaleString('zh-CN') : '无'} 至 {preview?.lastSampleAt ? new Date(preview.lastSampleAt).toLocaleString('zh-CN') : '无'}。</Typography.Paragraph>
      {!preview?.historyComplete && <Alert type="info" showIcon message="历史样本不足 7 天，预览结果只代表已有数据" style={{ marginBottom: 12 }} />}
      <Table rowKey="day" size="small" pagination={false} dataSource={preview?.byDay || []} columns={[{title:'日期（上海时间）',dataIndex:'day'},{title:'触发次数',dataIndex:'count'}]} />
    </Modal>
    <Modal title="预览导入规则" open={Boolean(archive)} onCancel={() => { setArchive(null); setImportRows([]); }} onOk={() => void confirmImport()} okText="确认导入" okButtonProps={{ disabled: importRows.length === 0 || importRows.some(row => row.error), loading: importBusy }} width={760}>
      <Space style={{ marginBottom: 12 }}>同名规则<Select aria-label="同名规则处理" value={importMode} style={{ width: 160 }} options={[{value:'skip',label:'跳过已有'},{value:'replace',label:'覆盖已有'}]} onChange={mode => { setImportMode(mode); if (archive) void previewArchive(archive,mode); }} /></Space>
      <Table<AlertImportRow> rowKey="index" size="small" dataSource={importRows} pagination={{ pageSize: 8 }} columns={[{title:'规则名称',dataIndex:'name'},{title:'处理',dataIndex:'status',render:(value:string)=>value==='error'?<Tag color="red">无效</Tag>:value==='create'?'新增':value==='update'?'覆盖':'跳过'},{title:'原因',dataIndex:'error',render:(value:string|null)=>value||'—'}]} />
    </Modal>
  </Card>;
}
