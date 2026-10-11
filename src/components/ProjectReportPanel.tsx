import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Empty, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { getPlatformConfig, type ModelConfig } from '../api/experiment-platform';
import { cancelProjectAnalysis, getProjectAnalysis, listProjectAnalyses, retryProjectAnalysis, startProjectAnalysis, type ProjectAnalysisJob, type ProjectAnalysisReport, type ProjectRepository, type ProjectScan } from '../api/projectRepositories';

const states: Record<ProjectAnalysisJob['status'], string> = { queued: '排队中', analyzing: '分析中', completed: '已完成', failed: '失败', canceled: '已取消' };
const findingStates: Record<ProjectAnalysisReport['findings'][number]['status'], string> = { implemented: '已实现线索', partial: '部分实现线索', not_found: '扫描范围内未发现', unverified: '待验证' };
const errors: Record<string, string> = { INVALID_REPORT: '模型输出或证据未通过校验', NO_EVIDENCE: '没有可分析的文本', SCAN_MISSING: '原始扫描已删除', INVALID_USAGE: '模型用量无效', MODEL_LIMIT: '模型限流或配额不足', MODEL_TIMEOUT: '模型调用超时', MODEL_FAILED: '模型调用失败' };

export default function ProjectReportPanel({ repository, scans }: { repository: ProjectRepository; scans: ProjectScan[] }) {
  const { message } = App.useApp();
  const [items, setItems] = useState<ProjectAnalysisJob[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [scanId, setScanId] = useState('');
  const [modelId, setModelId] = useState('');
  const [report, setReport] = useState<ProjectAnalysisReport | null>(null);
  const [starting, setStarting] = useState(false);
  const [actingId, setActingId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setScanId(current => scans.some(scan => scan.id === current && ['completed', 'partial'].includes(scan.status)) ? current : scans.find(scan => ['completed', 'partial'].includes(scan.status))?.id || '');
  }, [scans]);
  useEffect(() => {
    let cancelled = false;
    void getPlatformConfig().then(config => { if (!cancelled) setModels(config.models.filter(model => model.active && model.status === 'active' && model.adapterReady && model.configured && model.capabilities.output.includes('text'))); }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '模型目录读取失败'); });
    const load = async () => {
      try { const result = await listProjectAnalyses(repository.id); if (!cancelled) { setItems(result.items); setError(''); } }
      catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : '分析记录读取失败'); }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [repository.id]);

  const start = async () => {
    if (!scanId || !modelId) return;
    setStarting(true);
    try {
      const job = await startProjectAnalysis(repository.id, scanId, modelId);
      setItems(current => [job, ...current.filter(item => item.id !== job.id)]);
      message.success('分析任务已提交');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分析提交失败'); }
    finally { setStarting(false); }
  };
  const show = async (id: string) => {
    try { setReport(await getProjectAnalysis(repository.id, id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '报告读取失败'); }
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

  return <Card title="项目分析报告">
    <Typography.Paragraph type="secondary">选择已完成或部分覆盖的扫描及可用模型。分析固定该次 commit、项目目标和需求基线；模型费用计入已配置的每日预算。静态代码证据不能证明功能在运行环境中通过。</Typography.Paragraph>
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="扫描记录" placeholder="选择扫描记录" value={scanId || undefined} onChange={setScanId} style={{ minWidth: 230 }} options={scans.filter(scan => ['completed', 'partial'].includes(scan.status)).map(scan => ({ value: scan.id, label: `${scan.commitSha.slice(0, 10)} · ${scan.status === 'partial' ? '部分覆盖' : '完整覆盖'}` }))} />
      <Select aria-label="分析模型" placeholder="选择分析模型" value={modelId || undefined} onChange={setModelId} style={{ minWidth: 200 }} options={models.map(model => ({ value: model.id, label: model.displayName }))} />
      <Button type="primary" disabled={!scanId || !modelId || items.some(item => item.scanId === scanId && item.modelId === modelId && ['queued', 'analyzing'].includes(item.status))} loading={starting} onClick={() => void start()}>生成报告</Button>
    </Space>
    {!models.length && <Alert type="info" showIcon message="暂无可用的文本模型；请先在模型中心配置模型、连接和预算" style={{ marginBottom: 16 }} />}
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Table rowKey="id" size="small" dataSource={items} pagination={{ pageSize: 5 }} scroll={{ x: 720 }} columns={[
      { title: '创建时间', dataIndex: 'createdAt', render: value => new Date(value).toLocaleString('zh-CN') },
      { title: 'commit', dataIndex: 'commitSha', render: (value: string) => <code>{value.slice(0, 10)}</code> },
      { title: '模型', dataIndex: 'model' },
      { title: '状态', render: (_, item: ProjectAnalysisJob) => <Space><Tag color={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'canceled' ? 'default' : 'processing'}>{states[item.status]}</Tag><Typography.Text type="secondary">{item.attempts}/{item.maxAttempts} 次</Typography.Text></Space> },
      { title: '覆盖', render: (_, item: ProjectAnalysisJob) => item.status === 'completed' ? `${item.selectedFileCount}/${item.availableFileCount} 文件` : '—' },
      { title: '说明', render: (_, item: ProjectAnalysisJob) => item.errorCode ? errors[item.errorCode] || item.errorCode : '—' },
      { title: '操作', render: (_, item: ProjectAnalysisJob) => <Space size="small">
        {item.status === 'completed' && <Button type="link" onClick={() => void show(item.id)}>查看报告</Button>}
        {['queued','analyzing'].includes(item.status) && <Popconfirm title="确定取消这次分析？" onConfirm={() => void act(item,'cancel')}><Button type="link" danger loading={actingId === item.id}>取消</Button></Popconfirm>}
        {item.status === 'failed' && item.attempts < item.maxAttempts && <Button type="link" loading={actingId === item.id} onClick={() => void act(item,'retry')}>重试</Button>}
      </Space> },
    ]} />
    {report && <Card size="small" title={`报告 · ${report.commitSha.slice(0, 10)}`} extra={<Button type="text" onClick={() => setReport(null)}>关闭</Button>}>
      {!report.analysisCoverageComplete && <Alert type="warning" showIcon message="本次报告只覆盖部分已扫描内容；未发现实现不代表整个仓库没有实现" style={{ marginBottom: 12 }} />}
      <Typography.Paragraph><strong>项目目标：</strong>{report.goal}</Typography.Paragraph>
      <Typography.Paragraph><strong>需求基线：</strong>{report.requirementBaseline || '未指定'}</Typography.Paragraph>
      <Typography.Paragraph>{report.summary}</Typography.Paragraph>
      <Typography.Title level={5}>模块覆盖</Typography.Title>
      {report.modules.length ? <Table rowKey="moduleKey" size="small" pagination={false} dataSource={report.modules} scroll={{ x: 650 }} columns={[
        { title: '模块', dataIndex: 'moduleKey' },
        { title: '已索引', dataIndex: 'indexedCount' },
        { title: '已读取', dataIndex: 'readCount' },
        { title: '进入模型', dataIndex: 'selectedCount' },
        { title: '截断', dataIndex: 'truncatedCount' },
        { title: '排除 / 失败 / 未扫描', render: (_, item: ProjectAnalysisReport['modules'][number]) => `${item.excludedCount} / ${item.failedCount} / ${item.unscannedCount}` },
      ]} style={{ marginBottom: 16 }} /> : <Typography.Paragraph type="secondary">此报告创建时尚未记录模块覆盖信息</Typography.Paragraph>}
      <Typography.Title level={5}>进度判断与证据</Typography.Title>
      {report.findings.length ? report.findings.map(finding => <Card key={finding.id} size="small" style={{ marginBottom: 8 }} title={<Space>{finding.title}<Tag>{findingStates[finding.status]}</Tag></Space>}>
        <Typography.Paragraph>{finding.detail}</Typography.Paragraph>
        {finding.evidence && <Typography.Paragraph type="secondary">{finding.evidence.type === 'test' ? '测试证据' : finding.evidence.type === 'document' ? '文档线索' : '代码证据'}：<a href={sourceLink(finding.evidence.path, finding.evidence.line)} target="_blank" rel="noopener noreferrer">{finding.evidence.path}:{finding.evidence.line}</a><br /><code>{finding.evidence.excerpt}</code></Typography.Paragraph>}
      </Card>) : <Empty description="暂无结论" />}
      <Typography.Title level={5}>学习建议</Typography.Title>
      {report.suggestions.length ? report.suggestions.map(suggestion => <Card key={suggestion.id} size="small" style={{ marginBottom: 8 }} title={suggestion.topic}>
        <Typography.Paragraph>{suggestion.reason}</Typography.Paragraph>
        <Typography.Paragraph><strong>实践：</strong>{suggestion.practice}</Typography.Paragraph>
        <Typography.Paragraph><strong>验收：</strong>{suggestion.acceptance}</Typography.Paragraph>
      </Card>) : <Empty description="暂无建议" />}
    </Card>}
  </Card>;
}
