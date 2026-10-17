import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Empty, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { getPlatformConfig, type ModelConfig } from '../api/experiment-platform';
import { listTasks } from '../api/tasks';
import { addProjectFindingFeedback, cancelProjectAnalysis, compareProjectAnalyses, decideProjectSuggestion, getProjectAnalysis, getProjectRequirementBaseline, listProjectAnalyses, previewPrivateProjectAnalysis, previewProjectSuggestionTask, retryProjectAnalysis, startProjectAnalysis, updateProjectAutoAnalysis, type PrivateProjectDisclosure, type ProjectAnalysisJob, type ProjectAnalysisReport, type ProjectReportComparison as Comparison, type ProjectRepository, type ProjectScan, type ProjectSuggestionTaskPreview } from '../api/projectRepositories';
import ProjectReportComparison from './ProjectReportComparison';
import { getStoredUser } from '../api/client';
import { isAdministrator } from '../utils/roles';
import { orderProjectSuggestions } from '../utils/projectSuggestionOrder';
import type { AuthUser } from '../types';

const states: Record<ProjectAnalysisJob['status'], string> = { queued: '排队中', analyzing: '分析中', completed: '已完成', failed: '失败', canceled: '已取消' };
const findingStates: Record<ProjectAnalysisReport['findings'][number]['status'], string> = { implemented: '已实现线索', partial: '部分实现线索', not_found: '扫描范围内未发现', unverified: '待验证' };
const impactLabels = { high: '高影响', medium: '中影响', low: '低影响' };
const taskStates: Record<string, string> = { todo: '待办', in_progress: '进行中', done: '已完成', blocked: '阻塞' };
const errors: Record<string, string> = { INVALID_REPORT: '模型输出或证据未通过校验', NO_EVIDENCE: '没有可分析的文本', SCAN_MISSING: '原始扫描已删除', INVALID_USAGE: '模型用量无效', MODEL_LIMIT: '模型限流或配额不足', MODEL_TIMEOUT: '模型调用超时', MODEL_FAILED: '模型调用失败', CALL_OUTCOME_UNKNOWN: '上次模型调用结果未知，已停止自动重试；再次执行可能产生费用', SENSITIVE_INPUT: '分析输入包含凭据，已停止模型调用', ANALYSIS_BUDGET_EXCEEDED: '本次分析预算已不足以发起剩余模型调用', MODEL_CONNECTION_CHANGED: '模型连接配置已变化，请新建分析', PRIVATE_CONSENT_REQUIRED: '缺少私有代码发送授权', GITHUB_AUTH_REQUIRED: 'GitHub 私有仓库授权已失效', GITHUB_ACCESS_CHECK_FAILED: '暂时无法核验 GitHub 私有仓库权限', MODEL_DESTINATION_CHANGED: '模型目的地已变化，请重新预览并创建分析' };

export default function ProjectReportPanel({ repository, scans, onAnalysisCompleted, onRepositoryChanged }: { repository: ProjectRepository; scans: ProjectScan[]; onAnalysisCompleted: () => void; onRepositoryChanged: () => void }) {
  const canEditTasks = isAdministrator(getStoredUser<AuthUser>());
  const { message } = App.useApp();
  const [items, setItems] = useState<ProjectAnalysisJob[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [scanId, setScanId] = useState('');
  const [modelId, setModelId] = useState('');
  const [tokenBudget, setTokenBudget] = useState<number | null>(null);
  const [costBudgetUsd, setCostBudgetUsd] = useState<number | null>(null);
  const [autoModelId, setAutoModelId] = useState(repository.autoAnalysisModelId || '');
  const [autoTokenBudget, setAutoTokenBudget] = useState(repository.autoAnalysisTokenBudget || 30000);
  const [autoCostBudgetUsd, setAutoCostBudgetUsd] = useState(repository.autoAnalysisCostBudgetUsd || 0.1);
  const [autoSaving, setAutoSaving] = useState(false);
  const [report, setReport] = useState<ProjectAnalysisReport | null>(null);
  const [scopeJob, setScopeJob] = useState<ProjectAnalysisReport | null>(null);
  const [scopeLoadingId, setScopeLoadingId] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [olderId, setOlderId] = useState('');
  const [newerId, setNewerId] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [privatePreview, setPrivatePreview] = useState<{ disclosure: PrivateProjectDisclosure; scanId: string; modelId: string; tokenBudget: number | null; costBudgetUsd: number | null } | null>(null);
  const [actingId, setActingId] = useState('');
  const [actingSuggestionId, setActingSuggestionId] = useState('');
  const [attachSuggestionId, setAttachSuggestionId] = useState('');
  const [attachOptions, setAttachOptions] = useState<{ value: string; label: string }[]>([]);
  const [attachTaskId, setAttachTaskId] = useState('');
  const [attachPreview, setAttachPreview] = useState<ProjectSuggestionTaskPreview | null>(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachSaving, setAttachSaving] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [feedbackFindingId, setFeedbackFindingId] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState<ProjectAnalysisReport['findings'][number]['status']>('unverified');
  const [feedbackReason, setFeedbackReason] = useState('');
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [requirementContent, setRequirementContent] = useState<string | null>(null);
  const [requirementLoading, setRequirementLoading] = useState(false);
  const [error, setError] = useState('');
  const latestCompletedId = useRef('');
  const loadedMore = useRef(false);

  useEffect(() => {
    setScanId(current => scans.some(scan => scan.id === current && ['completed', 'partial'].includes(scan.status)) ? current : scans.find(scan => ['completed', 'partial'].includes(scan.status))?.id || '');
  }, [scans]);
  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    setReport(null);
    setScopeJob(null);
    setComparison(null);
    setOlderId('');
    setNewerId('');
    setAttachSuggestionId('');
    loadedMore.current = false;
    latestCompletedId.current = '';
    let cancelled = false;
    void getPlatformConfig().then(config => { if (!cancelled) setModels(config.models.filter(model => model.active && model.status === 'active' && model.adapterReady && model.configured && model.capabilities.output.includes('text'))); }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '模型目录读取失败'); });
    const load = async () => {
      try {
        const result = await listProjectAnalyses(repository.id);
        if (!cancelled) {
          setItems(current => {
            const recent = new Set(result.items.map(item => item.id));
            return [...result.items,...current.filter(item => !recent.has(item.id))];
          });
          if (!loadedMore.current) setNextCursor(result.nextCursor);
          setError('');
          const completed = result.items.filter(item => item.status === 'completed').sort((a, b) => new Date(b.finishedAt || 0).getTime() - new Date(a.finishedAt || 0).getTime())[0]?.id || '';
          if (completed && completed !== latestCompletedId.current) { latestCompletedId.current = completed; onAnalysisCompleted(); }
        }
      }
      catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : '分析记录读取失败'); }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [repository.id]);

  useEffect(() => {
    if (!report) return;
    let cancelled = false;
    const analysisId = report.id;
    void getProjectAnalysis(repository.id, analysisId).then(updated => {
      if (!cancelled) setReport(current => current?.id === analysisId ? updated : current);
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : '报告刷新失败');
    });
    return () => { cancelled = true; };
  }, [repository.id, repository.goal, repository.requirementBaseline, repository.baselineVersionId, repository.commitSha]);

  const submit = async (selectedScan: string, selectedModel: string, budget: { tokenBudget: number | null; costBudgetUsd: number | null }, disclosure?: PrivateProjectDisclosure) => {
    setStarting(true);
    try {
      const job = await startProjectAnalysis(repository.id, selectedScan, selectedModel, budget, disclosure ? { disclosureDigest: disclosure.digest } : undefined);
      setItems(current => [job, ...current.filter(item => item.id !== job.id)]);
      setPrivatePreview(null);
      message.success('分析任务已提交');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分析提交失败'); }
    finally { setStarting(false); }
  };
  const setAutoAnalysis = async (enabled: boolean) => {
    if (enabled && !autoModelId) return;
    const save = async () => {
      setAutoSaving(true);
      try {
        await updateProjectAutoAnalysis(repository, { enabled, modelId: autoModelId, tokenBudget: autoTokenBudget, costBudgetUsd: autoCostBudgetUsd, confirmRecurringCost: enabled });
        onRepositoryChanged();
        message.success(enabled ? '提交后自动分析已开启' : '提交后自动分析已关闭');
      } catch (cause) { setError(cause instanceof Error ? cause.message : '自动分析设置失败'); }
      finally { setAutoSaving(false); }
    };
    if (!enabled) return void save();
    Modal.confirm({ title: '确认开启持续模型分析？', content: `公开仓库每次收到对应分支的提交后，将在扫描完成时自动向所选模型发送代码摘录、项目目标和需求文档。每次最多 ${autoTokenBudget.toLocaleString()} token、$${autoCostBudgetUsd.toFixed(2)}；仍受账号每日预算和限流约束，重复提交可能持续产生费用。`, okText: '确认开启', onOk: save });
  };
  const start = async (selectedScan = scanId, selectedModel = modelId) => {
    if (!selectedScan || !selectedModel) return;
    if (!repository.private) return submit(selectedScan,selectedModel,{ tokenBudget,costBudgetUsd });
    setStarting(true);
    try {
      const disclosure = await previewPrivateProjectAnalysis(repository.id,selectedScan,selectedModel);
      setPrivatePreview({ disclosure, scanId: selectedScan, modelId: selectedModel, tokenBudget, costBudgetUsd });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '私有代码范围预览失败'); }
    finally { setStarting(false); }
  };
  const show = async (id: string) => {
    try { setReport(await getProjectAnalysis(repository.id, id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '报告读取失败'); }
  };
  const showScope = async (id: string) => {
    setScopeLoadingId(id);
    try { setScopeJob(await getProjectAnalysis(repository.id, id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '分析范围读取失败'); }
    finally { setScopeLoadingId(''); }
  };
  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await listProjectAnalyses(repository.id,nextCursor);
      loadedMore.current = true;
      setItems(current => {
        const seen = new Set(current.map(item => item.id));
        return [...current,...result.items.filter(item => !seen.has(item.id))];
      });
      setNextCursor(result.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '更早的分析记录读取失败'); }
    finally { setLoadingMore(false); }
  };
  const compareReports = async () => {
    if (!olderId || !newerId || olderId === newerId) return;
    setComparing(true);
    try { setComparison(await compareProjectAnalyses(repository.id,olderId,newerId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '报告对照失败'); }
    finally { setComparing(false); }
  };
  const act = async (item: ProjectAnalysisJob, action: 'cancel' | 'retry') => {
    setActingId(item.id);
    try {
      const updated = action === 'cancel' ? await cancelProjectAnalysis(repository.id,item.id) : await retryProjectAnalysis(repository.id,item.id);
      setItems(current => current.map(row => row.id === updated.id ? updated : row));
      message.success(action === 'cancel' ? '分析已取消' : '已重新排队分析');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setActingId(''); }
  };
  const sourceLink = (path: string, line: number) => `https://github.com/${report?.fullName}/blob/${report?.commitSha}/${path.split('/').map(encodeURIComponent).join('/')}#L${line}`;
  const decide = async (suggestionId: string, action: 'accept' | 'ignore') => {
    if (!report) return;
    setActingSuggestionId(suggestionId);
    try {
      await decideProjectSuggestion(repository.id,report.id,suggestionId,action);
      setReport(await getProjectAnalysis(repository.id,report.id));
      message.success(action === 'accept' ? '已创建学习任务' : '已忽略建议');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '建议处理失败'); }
    finally { setActingSuggestionId(''); }
  };
  const openAttach = async (suggestionId: string) => {
    setAttachSuggestionId(suggestionId);
    setAttachTaskId('');
    setAttachPreview(null);
    setAttachError('');
    setAttachLoading(true);
    try {
      const tasks = await listTasks();
      setAttachOptions(tasks.items.map(task => ({ value: task.id, label: `${task.title} · ${task.status}` })));
    } catch (cause) { setAttachError(cause instanceof Error ? cause.message : '任务列表读取失败'); }
    finally { setAttachLoading(false); }
  };
  const previewAttach = async () => {
    if (!report || !attachTaskId || !attachSuggestionId) return;
    setAttachLoading(true);
    setAttachError('');
    try { setAttachPreview(await previewProjectSuggestionTask(repository.id,report.id,attachSuggestionId,attachTaskId)); }
    catch (cause) { setAttachPreview(null); setAttachError(cause instanceof Error ? cause.message : '变更预览失败'); }
    finally { setAttachLoading(false); }
  };
  const confirmAttach = async () => {
    if (!report || !attachPreview || attachPreview.taskId !== attachTaskId) return;
    setAttachSaving(true);
    setAttachError('');
    try {
      await decideProjectSuggestion(repository.id,report.id,attachSuggestionId,'accept',{ targetTaskId: attachTaskId, expectedTaskVersion: attachPreview.version });
      setReport(await getProjectAnalysis(repository.id,report.id));
      setAttachSuggestionId('');
      setAttachPreview(null);
      message.success('已关联任务并追加建议来源');
    } catch (cause) { setAttachPreview(null); setAttachError(cause instanceof Error ? cause.message : '保存失败，请重新预览'); }
    finally { setAttachSaving(false); }
  };
  const saveFeedback = async () => {
    if (!report || !feedbackFindingId) return;
    setSavingFeedback(true);
    try {
      await addProjectFindingFeedback(repository.id,report.id,feedbackFindingId,feedbackStatus,feedbackReason);
      setReport(await getProjectAnalysis(repository.id,report.id));
      setFeedbackFindingId('');
      setFeedbackReason('');
      message.success('人工校正已记录');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '校正保存失败'); }
    finally { setSavingFeedback(false); }
  };
  const showRequirement = async () => {
    if (!report?.baselineVersionId) return;
    setRequirementLoading(true);
    try { setRequirementContent((await getProjectRequirementBaseline(repository.id,report.baselineVersionId)).content || ''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '需求文档读取失败'); }
    finally { setRequirementLoading(false); }
  };
  const reviewScan = report && scans.find(scan => scan.commitSha === repository.commitSha && ['completed', 'partial'].includes(scan.status));
  const reviewModelAvailable = report && models.some(model => model.id === report.modelId);
  const suggestionOrder = report ? orderProjectSuggestions(report.suggestions) : null;
  const renderSnapshotTask = (task: ProjectAnalysisReport['linkedTasks'][number]) => <Space key={task.id} size="small" wrap><Tag>{taskStates[task.status] || task.status} · {task.progress === null ? '进度未知' : `${Math.round(task.progress)}%`}</Tag>{task.currentlyAvailable ? <Link to={`/tasks/${task.id}`}>{task.title}</Link> : <Typography.Text type="secondary">{task.title}（当前不可访问）</Typography.Text>}</Space>;

  return <Card title="项目分析报告">
    {!repository.private && <Card size="small" title="提交后自动分析" style={{ marginBottom: 16 }}>
      <Space wrap>
        <Select aria-label="自动分析模型" placeholder="选择模型" value={autoModelId || undefined} onChange={setAutoModelId} disabled={repository.autoAnalysisEnabled || autoSaving} style={{ minWidth: 200 }} options={models.map(model => ({ value: model.id, label: model.displayName }))} />
        <Select aria-label="自动分析 token 上限" value={autoTokenBudget} onChange={setAutoTokenBudget} disabled={repository.autoAnalysisEnabled || autoSaving} style={{ minWidth: 170 }} options={[30000,60000,120000].map(value => ({ value, label: `${value.toLocaleString()} token` }))} />
        <Select aria-label="自动分析单次费用上限" value={autoCostBudgetUsd} onChange={setAutoCostBudgetUsd} disabled={repository.autoAnalysisEnabled || autoSaving} style={{ minWidth: 170 }} options={[0.1,0.5,1,5].map(value => ({ value, label: `最多 $${value.toFixed(2)}` }))} />
        <Switch aria-label="提交后自动模型分析" checked={repository.autoAnalysisEnabled} loading={autoSaving} disabled={!repository.autoAnalysisEnabled && (!repository.webhookScanEnabled || !autoModelId)} onChange={value => void setAutoAnalysis(value)} />
        <Typography.Text>{repository.autoAnalysisEnabled ? '已开启' : '未开启'}</Typography.Text>
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>仅公开仓库可用。先开启“提交后扫描”，再单独确认持续模型调用。已开启时如需更换模型或费用上限，请先关闭后重新配置。</Typography.Paragraph>
    </Card>}
    <Typography.Paragraph type="secondary">选择已完成或部分覆盖的扫描及可用模型。分析固定该次 commit、项目目标和需求基线；模型费用计入已配置的每日预算。静态代码证据不能证明功能在运行环境中通过。</Typography.Paragraph>
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="扫描记录" placeholder="选择扫描记录" value={scanId || undefined} onChange={setScanId} style={{ minWidth: 230 }} options={scans.filter(scan => ['completed', 'partial'].includes(scan.status)).map(scan => ({ value: scan.id, label: `${scan.commitSha.slice(0, 10)} · ${scan.status === 'partial' ? '部分覆盖' : '完整覆盖'}${scan.forceFull ? ' · 全量重扫' : ''}` }))} />
      <Select aria-label="分析模型" placeholder="选择分析模型" value={modelId || undefined} onChange={setModelId} style={{ minWidth: 200 }} options={models.map(model => ({ value: model.id, label: model.displayName }))} />
      <Select aria-label="分析 token 上限" value={tokenBudget} onChange={setTokenBudget} style={{ minWidth: 170 }} options={[{ value: null, label: 'token：仅系统配额' }, ...[30000,60000,120000].map(value => ({ value, label: `${value.toLocaleString()} token` }))]} />
      <Select aria-label="单次分析费用上限" value={costBudgetUsd} onChange={setCostBudgetUsd} style={{ minWidth: 170 }} options={[{ value: null, label: '费用：仅每日预算' }, ...[0.1,0.5,1,5].map(value => ({ value, label: `最多 $${value.toFixed(2)}` }))]} />
      <Button type="primary" disabled={!scanId || !modelId || items.some(item => item.scanId === scanId && item.modelId === modelId && ['queued', 'analyzing'].includes(item.status))} loading={starting} onClick={() => void start()}>生成报告</Button>
    </Space>
    <Typography.Paragraph type="secondary">可选上限会固定到分析任务，重试累计计算已用量。提交前按输入字符保守预留 token 和费用；每次继续调用前重新核对，已发出的单次模型调用仍可能产生超出预估的用量。</Typography.Paragraph>
    <Modal title="确认私有代码分析范围" open={Boolean(privatePreview)} onCancel={() => { if (!starting) setPrivatePreview(null); }} footer={<Space><Button disabled={starting} onClick={() => setPrivatePreview(null)}>取消</Button><Button type="primary" loading={starting} onClick={() => { if (privatePreview) void submit(privatePreview.scanId,privatePreview.modelId,{ tokenBudget:privatePreview.tokenBudget,costBudgetUsd:privatePreview.costBudgetUsd },privatePreview.disclosure); }}>确认发送并生成报告</Button></Space>} width={700}>
      {privatePreview && <Space direction="vertical" style={{ width:'100%' }}>
        <Alert type="warning" showIcon message="以下内容将发送给模型提供方" description="本次扫描中选出的代码／文档摘录、项目目标和需求文档会作为模型输入。仓库正文与注释只作为待分析材料，不会执行仓库脚本。" />
        <Typography.Text>提供方：{privatePreview.disclosure.provider} · 模型：{privatePreview.disclosure.model}</Typography.Text>
        <Typography.Text>数据目的地：<code>{privatePreview.disclosure.destination}</code></Typography.Text>
        <Typography.Text>固定 commit：{scans.find(item => item.id === privatePreview.scanId)?.commitSha.slice(0,10)}</Typography.Text>
        <Typography.Text>扫描预算：{privatePreview.disclosure.scanFileLimit} 个文件、{Math.round(privatePreview.disclosure.scanByteLimit / 1024 / 1024)} MiB；本次选中 {privatePreview.disclosure.fileCount} 个文件摘录，{privatePreview.disclosure.truncatedCount} 个摘录已截短。</Typography.Text>
        {!privatePreview.disclosure.scanCoverageComplete && <Alert type="warning" showIcon message="本次扫描为部分覆盖，未读文件不会送入模型" />}
        <div style={{ maxHeight:180,overflow:'auto',background:'rgba(127,127,127,0.06)',borderRadius:6,padding:8 }}>{privatePreview.disclosure.paths.map(path => <div key={path}><code>{path}</code></div>)}</div>
      </Space>}
    </Modal>
    {!models.length && <Alert type="info" showIcon message="暂无可用的文本模型；请先在模型中心配置模型、连接和预算" style={{ marginBottom: 16 }} />}
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Table rowKey="id" size="small" dataSource={items} pagination={{ pageSize: 5 }} scroll={{ x: 720 }} columns={[
      { title: '创建时间', dataIndex: 'createdAt', render: value => new Date(value).toLocaleString('zh-CN') },
      { title: '完成时间', dataIndex: 'finishedAt', render: (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '—' },
      { title: '分支', dataIndex: 'branch' },
      { title: 'commit', dataIndex: 'commitSha', render: (value: string) => <code>{value.slice(0, 10)}</code> },
      { title: '模型', dataIndex: 'model' },
      { title: '来源', render: (_, item: ProjectAnalysisJob) => item.triggerSource === 'webhook' ? <Tag color="blue">提交事件</Tag> : '手动' },
      { title: '状态', render: (_, item: ProjectAnalysisJob) => <Space><Tag color={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'canceled' ? 'default' : 'processing'}>{states[item.status]}</Tag><Typography.Text type="secondary">{item.attempts}/{item.maxAttempts} 次</Typography.Text></Space> },
      { title: '覆盖', render: (_, item: ProjectAnalysisJob) => item.status === 'completed' ? `${item.selectedFileCount}/${item.availableFileCount} 文件` : '—' },
      { title: '复用', render: (_, item: ProjectAnalysisJob) => item.reusedCallCount ? `${item.reusedCallCount} 次调用` : '—' },
      { title: '本次上限', render: (_, item: ProjectAnalysisJob) => `${item.tokenBudget === null ? '系统 token 配额' : `${item.tokenBudget.toLocaleString()} token`} / ${item.costBudgetUsd === null ? '每日费用预算' : `$${item.costBudgetUsd.toFixed(2)}`}` },
      { title: '实际用量', render: (_, item: ProjectAnalysisJob) => `${((item.promptTokens || 0) + (item.completionTokens || 0)).toLocaleString()} token / $${(item.costUsd || 0).toFixed(4)}` },
      { title: '说明', render: (_, item: ProjectAnalysisJob) => item.errorCode ? errors[item.errorCode] || item.errorCode : '—' },
      { title: '操作', render: (_, item: ProjectAnalysisJob) => <Space size="small">
        {item.status === 'completed' && <Button type="link" onClick={() => void show(item.id)}>查看报告</Button>}
        {item.status === 'failed' && <Button type="link" loading={scopeLoadingId === item.id} onClick={() => void showScope(item.id)}>查看未覆盖范围</Button>}
        {['queued','analyzing'].includes(item.status) && <Popconfirm title="确定取消这次分析？" onConfirm={() => void act(item,'cancel')}><Button type="link" danger loading={actingId === item.id}>取消</Button></Popconfirm>}
        {item.status === 'failed' && item.attempts < item.maxAttempts && (item.errorCode === 'CALL_OUTCOME_UNKNOWN'
          ? <Popconfirm title="上次模型调用结果未知" description="再次执行可能产生额外模型费用，确定重试？" onConfirm={() => void act(item,'retry')}><Button type="link" loading={actingId === item.id}>重试</Button></Popconfirm>
          : <Button type="link" loading={actingId === item.id} onClick={() => void act(item,'retry')}>重试</Button>)}
      </Space> },
    ]} />
    {nextCursor && <Button loading={loadingMore} onClick={() => void loadMore()} style={{ marginBottom: 16 }}>加载更早的分析记录</Button>}
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="较早的报告" placeholder="较早的报告" value={olderId || undefined} onChange={value => { setOlderId(value); setComparison(null); }} style={{ minWidth: 260 }} options={items.filter(item => item.status === 'completed').map(item => ({ value: item.id, label: `${new Date(item.finishedAt || item.createdAt).toLocaleString('zh-CN')} · ${item.commitSha.slice(0, 10)}` }))} />
      <Select aria-label="较新的报告" placeholder="较新的报告" value={newerId || undefined} onChange={value => { setNewerId(value); setComparison(null); }} style={{ minWidth: 260 }} options={items.filter(item => item.status === 'completed').map(item => ({ value: item.id, label: `${new Date(item.finishedAt || item.createdAt).toLocaleString('zh-CN')} · ${item.commitSha.slice(0, 10)}` }))} />
      <Button disabled={!olderId || !newerId || olderId === newerId || new Date(items.find(item => item.id === olderId)?.finishedAt || 0).getTime() >= new Date(items.find(item => item.id === newerId)?.finishedAt || 0).getTime()} loading={comparing} onClick={() => void compareReports()}>对照两次报告</Button>
    </Space>
    {comparison && <ProjectReportComparison comparison={comparison} onOpenReport={id => void show(id)} onClose={() => setComparison(null)} />}
    <Modal title="分析实际用量与未覆盖范围" open={Boolean(scopeJob)} onCancel={() => setScopeJob(null)} footer={<Button onClick={() => setScopeJob(null)}>关闭</Button>} width={720}>
      {scopeJob && <>
        <Alert type="warning" showIcon message={scopeJob.errorCode ? errors[scopeJob.errorCode] || scopeJob.errorCode : '本次分析未完成'} style={{ marginBottom: 12 }} />
        <Typography.Paragraph>实际消耗：{((scopeJob.promptTokens || 0) + (scopeJob.completionTokens || 0)).toLocaleString()} token（输入 {(scopeJob.promptTokens || 0).toLocaleString()}，输出 {(scopeJob.completionTokens || 0).toLocaleString()}），费用 ${(scopeJob.costUsd || 0).toFixed(4)}。</Typography.Paragraph>
        <Typography.Paragraph>本次上限：{scopeJob.tokenBudget === null ? '仅系统 token 配额' : `${scopeJob.tokenBudget.toLocaleString()} token`}；{scopeJob.costBudgetUsd === null ? '仅每日费用预算' : `$${scopeJob.costBudgetUsd.toFixed(2)}`}。实际消耗包含本任务先前尝试，重试会沿用原上限。</Typography.Paragraph>
        {scopeJob.executionScope && <>
          <Typography.Paragraph>当前计划从 {scopeJob.executionScope.selectedFileCount} 个可读文件生成 {scopeJob.executionScope.plannedCount} 次模块分析；最近一次尝试完成 {scopeJob.executionScope.completedCount} 次，仍有 {scopeJob.executionScope.remainingModules.length} 次未完成。</Typography.Paragraph>
          {scopeJob.executionScope.remainingModules.length > 0 && <Space wrap style={{ marginBottom: 12 }}>{scopeJob.executionScope.remainingModules.map(moduleKey => <Tag key={moduleKey}>{moduleKey}</Tag>)}</Space>}
        </>}
        <Typography.Paragraph type="secondary">这里的模块计划不等于仓库全部内容。扫描未读和分析文件选择缺口需结合扫描详情查看；完成次数仅统计最近一次尝试，实际费用累计所有尝试。</Typography.Paragraph>
      </>}
    </Modal>
    {report && <Card size="small" title={`报告 · ${report.commitSha.slice(0, 10)}`} extra={<Button type="text" onClick={() => setReport(null)}>关闭</Button>}>
      {report.staleReasons.length > 0 && <Alert type="warning" showIcon message="报告基线已变化，旧建议需重审" description={<Space direction="vertical"><span>{report.staleReasons.join('；')}</span>{reviewScan && reviewModelAvailable ? <Popconfirm title="按当前基线重新分析？" description="会重新调用模型，可能产生费用；旧报告和人工处理记录仍保留。" onConfirm={() => void start(reviewScan.id, report.modelId)}><Button size="small" loading={starting}>重新分析当前扫描</Button></Popconfirm> : <span>{reviewScan ? '原模型当前不可用，请选择其他模型生成报告。' : '请先扫描当前 commit，再生成新报告。'}</span>}</Space>} style={{ marginBottom: 12 }} />}
      {!report.analysisCoverageComplete && <Alert type="warning" showIcon message="本次报告只覆盖部分内容；未发现实现不代表整个仓库没有实现" description={`可读文件中有 ${Math.max(0,report.availableFileCount - report.selectedFileCount)} 个未进入模型，另有 ${report.modules.reduce((sum,module) => sum + module.truncatedCount,0)} 个输入文件被截断；扫描阶段还有文件数预算未读 ${report.scanScope.gaps.fileBudget}、字节预算未读 ${report.scanScope.gaps.byteBudget}、旧版未区分预算未读 ${report.scanScope.gaps.legacyBudget}、读取失败 ${report.scanScope.gaps.failed}、索引外或无效目录项 ${report.scanScope.gaps.unindexed}、未展开目录 ${report.scanScope.gaps.unscannedSubtrees}。`} style={{ marginBottom: 12 }} />}
      <Alert type={report.scanScope.comparisonComplete ? 'info' : 'warning'} showIcon message={report.scanScope.baselineCommitSha ? `扫描基线 ${report.scanScope.baselineCommitSha.slice(0, 10)} → ${report.commitSha.slice(0, 10)}` : `首次扫描 ${report.commitSha.slice(0, 10)}`} description={<Space direction="vertical"><span>范围：{report.selectedFileCount}/{report.availableFileCount} 个可读文件进入分析；{report.scanScope.forceFull ? '全量重扫，未跨报告复用分析输出' : `复用 ${report.reusedCallCount} 次目录模块输出`}。</span>{report.scanScope.baselineCommitSha && <span>已索引文件差异：新增 {report.scanScope.changes.added || 0}、修改 {report.scanScope.changes.modified || 0}、删除 {report.scanScope.changes.deleted || 0}、重命名 {report.scanScope.changes.renamed || 0}。{!report.scanScope.comparisonComplete && '至少一侧扫描为部分覆盖，差异不代表完整仓库。'}</span>}</Space>} style={{ marginBottom: 12 }} />
      {report.reusedCalls.length > 0 && <Alert type="info" showIcon message={`复用 ${report.reusedCalls.length} 次已验证的模块输出`} description={<Space wrap>{report.reusedCalls.map(item => <Tag key={item.moduleKey}>{item.moduleKey.startsWith('@cross-module') ? '跨模块综合' : item.moduleKey} · 来源 commit {item.sourceCommitSha?.slice(0, 10) || '未知'}</Tag>)}</Space>} style={{ marginBottom: 12 }} />}
      <Typography.Paragraph><strong>项目目标：</strong>{report.goal}</Typography.Paragraph>
      <Typography.Paragraph><strong>需求基线：</strong>{report.requirementBaseline || '未指定'}</Typography.Paragraph>
      {report.baselineVersionId && <Button size="small" loading={requirementLoading} onClick={() => void showRequirement()}>查看本报告固定的需求正文</Button>}
      <Typography.Paragraph>{report.summary}</Typography.Paragraph>
      <Typography.Title level={5}>需求逐项对照</Typography.Title>
      <Typography.Paragraph type="secondary">关联任务展示报告完成时的状态快照；任务完成不代表代码已实现，代码判断仍以结论和证据为准。</Typography.Paragraph>
      {report.requirements.length ? <Table rowKey="id" size="small" pagination={false} dataSource={report.requirements} columns={[
        { title: '需求 ID', dataIndex: 'id', width: 150 },
        { title: '需求', dataIndex: 'text' },
        { title: '本报告结论', render: (_, item: ProjectAnalysisReport['requirements'][number]) => { const related = report.findings.filter(finding => finding.requirementId === item.id); return related.length ? <Space wrap>{related.map(finding => <Tag key={finding.id}>{findingStates[finding.status]} · {finding.title}</Tag>)}</Space> : <Tag>待验证（未关联结论）</Tag>; } },
        { title: '关联学习任务（快照）', render: (_, item: ProjectAnalysisReport['requirements'][number]) => { const related = (report.linkedTasks || []).filter(task => task.requirementId === item.id); return related.length ? <Space wrap>{related.map(renderSnapshotTask)}</Space> : '无对应任务'; } },
      ]} style={{ marginBottom: 16 }} /> : <Typography.Paragraph type="secondary">未提供可逐项识别的需求正文；本报告只显示功能线索，不计算总体完成率。</Typography.Paragraph>}
      {(report.linkedTasks || []).some(task => !task.requirementId || !report.requirements.some(item => item.id === task.requirementId)) && <Typography.Paragraph><strong>未对应本报告需求的任务：</strong><Space wrap>{(report.linkedTasks || []).filter(task => !task.requirementId || !report.requirements.some(item => item.id === task.requirementId)).map(renderSnapshotTask)}</Space></Typography.Paragraph>}
      <Typography.Title level={5}>技术栈线索</Typography.Title>
      <Typography.Paragraph type="secondary">以下内容来自该 commit 的依赖清单，不代表运行环境已通过验证。</Typography.Paragraph>
      {report.technologies.length ? <Space wrap style={{ marginBottom: 16 }}>{report.technologies.map(item => <Tag key={item.name}><a href={sourceLink(item.evidence.path,item.evidence.line)} target="_blank" rel="noopener noreferrer">{item.name}</a> <Typography.Text type="secondary">({item.packageName})</Typography.Text></Tag>)}</Space> : <Typography.Paragraph type="secondary">扫描范围内未发现可确认的依赖清单线索</Typography.Paragraph>}
      <Typography.Title level={5}>模块覆盖</Typography.Title>
      {report.modules.length ? <Table rowKey="moduleKey" size="small" pagination={false} dataSource={report.modules} scroll={{ x: 650 }} columns={[
        { title: '模块', dataIndex: 'moduleKey' },
        { title: '已索引', dataIndex: 'indexedCount' },
        { title: '已读取', dataIndex: 'readCount' },
        { title: '进入模型', dataIndex: 'selectedCount' },
        { title: '分析摘要', dataIndex: 'summary', render: (value: string | null) => value || '未分析' },
        { title: '截断', dataIndex: 'truncatedCount' },
        { title: '排除 / 失败 / 未扫描', render: (_, item: ProjectAnalysisReport['modules'][number]) => `${item.excludedCount} / ${item.failedCount} / ${item.unscannedCount}` },
      ]} style={{ marginBottom: 16 }} /> : <Typography.Paragraph type="secondary">此报告创建时尚未记录模块覆盖信息</Typography.Paragraph>}
      <Typography.Title level={5}>核心流程线索</Typography.Title>
      <Typography.Paragraph type="secondary">每个步骤都来自本次固定 commit 的代码或测试行；静态阅读不能证明流程已在运行环境通过。</Typography.Paragraph>
      {report.flows.length ? report.flows.map(flow => <Card key={flow.id} size="small" title={<Space>{flow.title}<Tag color={flow.moduleKey ? undefined : 'purple'}>{flow.moduleKey || '跨模块线索'}</Tag></Space>} style={{ marginBottom: 8 }}>
        <ol style={{ margin: 0, paddingLeft: 20 }}>{flow.steps.map((step,index) => <li key={`${flow.id}-${index}`} style={{ marginBottom: 10 }}>
          <Typography.Text>{step.description}</Typography.Text><br />
          <Typography.Text type="secondary">{step.evidence.type === 'test' ? '测试证据' : '代码证据'}：</Typography.Text>
          <a href={sourceLink(step.evidence.path,step.evidence.line)} target="_blank" rel="noopener noreferrer">{step.evidence.path}:{step.evidence.line}</a><br />
          <code style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{step.evidence.excerpt}</code>
        </li>)}</ol>
      </Card>) : <Typography.Paragraph type="secondary">扫描范围内没有足够的逐步代码证据，暂不列出核心流程。</Typography.Paragraph>}
      <Typography.Title level={5}>进度判断与证据</Typography.Title>
      {report.findings.length ? report.findings.map(finding => <Card key={finding.id} size="small" style={{ marginBottom: 8 }} title={<Space>{finding.title}{finding.requirementId && <Tag color="purple">{finding.requirementId}</Tag>}{finding.moduleKey && <Tag>{finding.moduleKey}</Tag>}<Tag>{findingStates[finding.status]}</Tag></Space>}>
        <Typography.Paragraph>{finding.detail}</Typography.Paragraph>
        {finding.evidence && <Typography.Paragraph type="secondary">{finding.evidence.type === 'test' ? '测试证据' : finding.evidence.type === 'document' ? '文档线索' : '代码证据'}：<a href={sourceLink(finding.evidence.path, finding.evidence.line)} target="_blank" rel="noopener noreferrer">{finding.evidence.path}:{finding.evidence.line}</a><br /><code>{finding.evidence.excerpt}</code></Typography.Paragraph>}
        {finding.feedback.map(entry => <Typography.Paragraph key={entry.id} type="secondary"><Tag color="blue">人工判断：{findingStates[entry.correctedStatus]}</Tag>{entry.reason} · {entry.author} · {new Date(entry.createdAt).toLocaleString('zh-CN')}</Typography.Paragraph>)}
        <Button size="small" onClick={() => { setFeedbackFindingId(finding.id); setFeedbackStatus(finding.feedback[0]?.correctedStatus || finding.status); setFeedbackReason(''); }}>修正判断</Button>
      </Card>) : <Empty description="暂无结论" />}
      <Typography.Title level={5}>学习建议</Typography.Title>
      {suggestionOrder?.hasCycle && <Alert type="warning" showIcon message="学习建议的前置关系存在循环，相关条目仍按影响程度展示，请人工核对" style={{ marginBottom: 12 }} />}
      {suggestionOrder?.items.length ? suggestionOrder.items.map(suggestion => <Card key={suggestion.id} size="small" style={{ marginBottom: 8 }} title={<Space>{suggestion.topic}{suggestion.impact && <Tag color={suggestion.impact === 'high' ? 'red' : suggestion.impact === 'medium' ? 'orange' : 'blue'}>{impactLabels[suggestion.impact]}（模型估计）</Tag>}</Space>}>
        <Typography.Paragraph>{suggestion.reason}</Typography.Paragraph>
        {suggestion.impactReason && <Typography.Paragraph><strong>影响下一步开发：</strong>{suggestion.impactReason}</Typography.Paragraph>}
        <Typography.Paragraph><strong>前置知识：</strong>{suggestion.prerequisites.length ? suggestion.prerequisites.join('、') : '暂无明确前置知识'}</Typography.Paragraph>
        {!!suggestionOrder.dependencies.get(suggestion.id)?.length && <Typography.Paragraph type="secondary">先处理本报告建议：{suggestionOrder.dependencies.get(suggestion.id)!.map(item => item.topic).join('、')}</Typography.Paragraph>}
        <Typography.Paragraph><strong>实践：</strong>{suggestion.practice}</Typography.Paragraph>
        <Typography.Paragraph><strong>验收：</strong>{suggestion.acceptance}</Typography.Paragraph>
        {!suggestion.decision && suggestion.possibleDuplicates.length > 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={suggestion.possibleDuplicates.some(item => item.exact) ? '相同建议已创建任务' : '可能已有相关学习任务，请先核对'} description={<Space wrap>{suggestion.possibleDuplicates.map(item => <Link key={item.taskId} to={`/tasks/${item.taskId}`}>{item.title}</Link>)}</Space>} />}
        {suggestion.decision?.status === 'accepted' && <Space><Tag color="success">{suggestion.decision.targetMode === 'existing' ? '已关联已有任务' : '已创建学习任务'}</Tag>{suggestion.decision.taskId && <Link to={`/tasks/${suggestion.decision.taskId}`}>查看任务</Link>}</Space>}
        {suggestion.decision?.status === 'ignored' && <Tag>已忽略</Tag>}
        {suggestion.status === 'stale' && <Tag color="warning">已失效，需重审</Tag>}
        {!suggestion.decision && <Space>
          {canEditTasks && <Popconfirm title="确认将此建议创建为学习任务？" description={suggestion.possibleDuplicates.length ? '可能已有相关任务；确认它们不同后再创建。' : '任务会保留实践、验收要求与当前报告来源。'} onConfirm={() => void decide(suggestion.id,'accept')}><Button type="primary" size="small" disabled={report.staleReasons.length > 0 || suggestion.possibleDuplicates.some(item => item.exact)} loading={actingSuggestionId === suggestion.id}>加入任务</Button></Popconfirm>}
          {canEditTasks && <Button size="small" disabled={report.staleReasons.length > 0 || suggestion.possibleDuplicates.some(item => item.exact)} onClick={() => void openAttach(suggestion.id)}>关联已有任务</Button>}
          <Popconfirm title="确认忽略此建议？" onConfirm={() => void decide(suggestion.id,'ignore')}><Button size="small" loading={actingSuggestionId === suggestion.id}>忽略</Button></Popconfirm>
        </Space>}
      </Card>) : <Empty description="暂无建议" />}
    </Card>}
    <Modal title="关联建议到已有任务" open={Boolean(attachSuggestionId)} width={900} onCancel={() => { setAttachSuggestionId(''); setAttachPreview(null); }} onOk={() => void confirmAttach()} okText="确认追加并关联" okButtonProps={{ disabled: !attachPreview || attachPreview.taskId !== attachTaskId, loading: attachSaving }}>
      <Typography.Paragraph type="secondary">只在任务描述末尾追加本建议、验收标准和固定 commit 来源；原标题、状态、进度及其他手工字段不会被修改。确认时会检查任务版本，若其他人已修改，须重新预览。</Typography.Paragraph>
      {attachError && <Alert type="error" showIcon message={attachError} style={{ marginBottom: 12 }} />}
      <Space wrap style={{ marginBottom: 12 }}>
        <Select aria-label="选择已有学习任务" showSearch optionFilterProp="label" value={attachTaskId || undefined} onChange={value => { setAttachTaskId(value); setAttachPreview(null); }} options={attachOptions} loading={attachLoading} placeholder="搜索任务" style={{ minWidth: 350 }} />
        <Button disabled={!attachTaskId} loading={attachLoading} onClick={() => void previewAttach()}>预览字段差异</Button>
      </Space>
      {attachPreview && <>
        <Typography.Paragraph><strong>任务：</strong>{attachPreview.title}（版本 {attachPreview.version}）</Typography.Paragraph>
        {attachPreview.changes.map(change => <div key={change.fieldName}>
          <Typography.Title level={5}>描述字段</Typography.Title>
          <Space align="start" style={{ width: '100%' }} wrap>
            <div style={{ flex: '1 1 300px' }}><Typography.Text type="secondary">当前内容</Typography.Text><Input.TextArea aria-label="当前任务描述" value={change.oldValue || '（空）'} readOnly rows={8} /></div>
            <div style={{ flex: '1 1 300px' }}><Typography.Text type="secondary">确认后内容</Typography.Text><Input.TextArea aria-label="确认后任务描述" value={change.newValue} readOnly rows={8} /></div>
          </Space>
          <Typography.Paragraph style={{ marginTop: 12 }}><Tag color="green">新增内容</Tag><Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{change.addedValue}</Typography.Text></Typography.Paragraph>
        </div>)}
      </>}
    </Modal>
    <Modal title="修正报告判断" open={Boolean(feedbackFindingId)} onCancel={() => setFeedbackFindingId('')} onOk={() => void saveFeedback()} okText="保存校正" okButtonProps={{ disabled: feedbackReason.trim().length < 10 || feedbackReason.trim().length > 1000, loading: savingFeedback }}>
      <Typography.Paragraph type="secondary">校正会作为独立记录保存，原始模型结论和证据不变。</Typography.Paragraph>
      <Select aria-label="人工判断" value={feedbackStatus} onChange={setFeedbackStatus} style={{ width: '100%', marginBottom: 12 }} options={Object.entries(findingStates).map(([value,label]) => ({ value,label }))} />
      <Input.TextArea aria-label="校正理由" value={feedbackReason} onChange={event => setFeedbackReason(event.target.value)} rows={4} maxLength={1000} showCount placeholder="请说明判断依据（至少 10 字）" />
    </Modal>
    <Modal title="报告引用的需求文档" open={requirementContent !== null} onCancel={() => setRequirementContent(null)} footer={<Button onClick={() => setRequirementContent(null)}>关闭</Button>} width={720}>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{requirementContent}</Typography.Paragraph>
    </Modal>
  </Card>;
}
