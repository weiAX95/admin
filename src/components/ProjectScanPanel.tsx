import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { getProjectScan, getProjectScanFile, listProjectScans, startProjectScan, type ProjectRepository, type ProjectScan, type ProjectScanChange, type ProjectScanFile } from '../api/projectRepositories';
import ProjectReportPanel from './ProjectReportPanel';

const statusLabels: Record<ProjectScan['status'], string> = { queued: '排队中', scanning: '扫描中', completed: '覆盖完成', partial: '部分覆盖', failed: '扫描失败' };
const reasonLabels: Record<string, string> = { dependency_or_build: '依赖或构建产物', sensitive_path: '敏感路径', sensitive_content: '疑似密钥内容', non_regular_file: '非普通文件', binary_type: '二进制类型', file_size: '超出单文件限制', scan_budget: '旧记录：扫描预算用尽', file_budget: '文件数预算用尽', byte_budget: '读取字节预算不足', github_rate_limit: 'GitHub 限流', blob_unavailable_or_invalid: '内容不可读取或格式无效' };
const changeLabels: Record<ProjectScanChange['kind'], string> = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名' };

export default function ProjectScanPanel({ repository, onAnalysisCompleted }: { repository: ProjectRepository; onAnalysisCompleted: () => void }) {
  const { message } = App.useApp();
  const [items, setItems] = useState<ProjectScan[]>([]);
  const [detail, setDetail] = useState<(ProjectScan & { files: ProjectScanFile[]; changes: ProjectScanChange[] }) | null>(null);
  const [starting, setStarting] = useState(false);
  const [budgetFileLimit, setBudgetFileLimit] = useState(200);
  const [budgetByteLimit, setBudgetByteLimit] = useState(5 * 1024 * 1024);
  const [forceFull, setForceFull] = useState(false);
  const [source, setSource] = useState<{ path: string; content: string } | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await listProjectScans(repository.id);
        if (!cancelled) { setItems(result.items); setError(''); }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : '扫描记录读取失败'); }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [repository.id]);

  const start = async () => {
    setStarting(true);
    try { const scan = await startProjectScan(repository.id, { budgetFileLimit, budgetByteLimit, forceFull }); setItems(current => [scan, ...current.filter(item => item.id !== scan.id)]); message.success('扫描任务已提交'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '扫描提交失败'); }
    finally { setStarting(false); }
  };
  const show = async (id: string) => {
    try { setDetail(await getProjectScan(repository.id,id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '扫描详情读取失败'); }
  };
  const showSource = async (path: string) => {
    if (!detail) return;
    setSourceLoading(true);
    try { setSource(await getProjectScanFile(repository.id, detail.id, path)); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '文件正文读取失败'); }
    finally { setSourceLoading(false); }
  };
  const unreadFiles = detail?.files.filter(file => file.status === 'unscanned') || [];
  const fileBudgetGaps = unreadFiles.filter(file => file.reason === 'file_budget').length;
  const byteBudgetGaps = unreadFiles.filter(file => file.reason === 'byte_budget').length;
  const legacyBudgetGaps = unreadFiles.filter(file => file.reason === 'scan_budget').length;
  const unindexed = Math.max(0,(detail?.unscannedCount || 0) - unreadFiles.length);

  return <Card title={`${repository.fullName} · 扫描记录`}>
    <Typography.Paragraph type="secondary">每次扫描固定提交时的 commit SHA。目录和文件读取预算有限；“部分覆盖”表示仍有失败或未扫描范围，不能据此认定项目已完整分析。已读取的文本正文保存在服务端，仅仓库所属账号可按需查看。</Typography.Paragraph>
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="扫描文件上限" value={budgetFileLimit} onChange={setBudgetFileLimit} style={{ width: 170 }} options={[50,100,200,500].map(value => ({ value, label: `最多 ${value} 个文件` }))} />
      <Select aria-label="扫描读取总量上限" value={budgetByteLimit} onChange={setBudgetByteLimit} style={{ width: 170 }} options={[1,5,10].map(value => ({ value: value * 1024 * 1024, label: `最多读取 ${value} MiB` }))} />
      <Checkbox checked={forceFull} onChange={event => setForceFull(event.target.checked)}>全量重扫（不复用缓存）</Checkbox>
      <Button type="primary" loading={starting} disabled={items.some(item => item.status === 'queued' || item.status === 'scanning')} onClick={() => void start()}>扫描当前 commit</Button>
    </Space>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Table rowKey="id" size="small" dataSource={items} pagination={{ pageSize: 5 }} scroll={{ x: 760 }} columns={[
      { title: '提交时间', dataIndex: 'createdAt', render: value => new Date(value).toLocaleString('zh-CN') },
      { title: 'commit', dataIndex: 'commitSha', render: (value: string) => <code title={value}>{value.slice(0, 10)}</code> },
      { title: '状态', render: (_, item: ProjectScan) => <Tag color={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'partial' ? 'warning' : 'processing'}>{statusLabels[item.status]}</Tag> },
      { title: '限流重试', render: (_, item: ProjectScan) => item.nextAttemptAt ? `第 ${item.retryCount}/3 次 · ${new Date(item.nextAttemptAt).toLocaleString('zh-CN')}` : item.status === 'failed' && item.errorCode === 'GITHUB_RATE_LIMIT' ? '限流重试已达上限' : '—' },
      { title: '覆盖', render: (_, item: ProjectScan) => `${item.readCount} 读取 / ${item.excludedCount} 排除 / ${item.failedCount} 失败 / ${item.unscannedCount} 未扫描` },
      { title: '复用', render: (_, item: ProjectScan) => item.reusedCount ? `${item.reusedCount} 个 blob` : '—' },
      { title: '模式', render: (_, item: ProjectScan) => item.forceFull ? <Tag color="blue">全量重扫</Tag> : '增量' },
      { title: '预算', render: (_, item: ProjectScan) => `${item.budgetFileLimit} 文件 / ${item.budgetByteLimit / 1024 / 1024} MiB` },
      { title: '未扫描目录', dataIndex: 'unscannedSubtrees' },
      { title: '操作', render: (_, item: ProjectScan) => <Button type="link" onClick={() => void show(item.id)}>查看文件</Button> },
    ]} />
    {detail && <Card size="small" title={`文件索引 · ${detail.commitSha.slice(0, 10)}`} extra={<Button type="text" onClick={() => setDetail(null)}>关闭</Button>}>
      <Typography.Paragraph type="secondary">扫描预算：最多 {detail.budgetFileLimit} 个文件、读取 {detail.budgetByteLimit / 1024 / 1024} MiB；实际纳入预算 {detail.attemptedCount} 个文件、{(detail.totalBytes / 1024 / 1024).toFixed(2)} MiB。单文件上限固定为 256 KiB。{detail.reusedCount > 0 && <>其中 {detail.reusedCount} 个文件复用此前扫描的相同 Git blob（来源 commit {detail.cacheSourceCommitSha?.slice(0, 10)}）；本次文件路径和覆盖结论仍按当前 commit 计算。</>}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{detail.forceFull ? '全量重扫：重新读取 GitHub blob，后续分析不复用旧报告输出。' : '增量扫描：相同 Git blob 可复用正文，未变化的目录模块可复用已验证输出。'}{detail.baselineCommitSha && ` 差异基线 commit：${detail.baselineCommitSha.slice(0, 10)}。差异只覆盖两次已索引的文件，部分覆盖时不代表完整仓库差异。`}</Typography.Paragraph>
      {detail.baselineCommitSha && <Table rowKey={change => `${change.kind}:${change.path}`} size="small" dataSource={detail.changes} pagination={{ pageSize: 8 }} scroll={{ x: 600 }} locale={{ emptyText: '已索引文件没有差异' }} columns={[
        { title: '变化', dataIndex: 'kind', render: (value: ProjectScanChange['kind']) => changeLabels[value] },
        { title: '当前路径', dataIndex: 'path' },
        { title: '原路径', dataIndex: 'oldPath', render: (value: string | null) => value || '—' },
      ]} />}
      {detail.status === 'partial' && <Alert type="warning" showIcon message="本次为部分覆盖，不能视作完整分析" description={<Space direction="vertical"><span>未读取：文件数预算 {fileBudgetGaps}、字节预算 {byteBudgetGaps}{legacyBudgetGaps ? `、旧版未区分预算 ${legacyBudgetGaps}` : ''}；索引外或无效目录项 {unindexed}；未展开目录 {detail.unscannedSubtrees}；读取失败 {detail.failedCount}。</span>{unreadFiles.length > 0 && <span>未读示例：{unreadFiles.slice(0, 5).map(file => file.path).join('、')}{unreadFiles.length > 5 ? ` 等 ${unreadFiles.length} 个` : ''}。可提高上方预算后重新扫描；原报告不随新扫描改变。</span>}</Space>} style={{ marginBottom: 12 }} />}
      {detail.status === 'failed' && <Alert type="error" showIcon message={detail.errorCode === 'GITHUB_RATE_LIMIT' ? 'GitHub 限流重试已达上限，请稍后新建扫描' : '扫描失败'} description={detail.errorCode || undefined} style={{ marginBottom: 12 }} />}
      {detail.nextAttemptAt && <Alert type="info" showIcon message={`GitHub 限流，预计 ${new Date(detail.nextAttemptAt).toLocaleString('zh-CN')} 后自动重试`} description={`已安排第 ${detail.retryCount}/3 次重试；刷新页面不会丢失等待状态。`} style={{ marginBottom: 12 }} />}
      <Table rowKey="path" size="small" dataSource={detail.files} pagination={{ pageSize: 10 }} scroll={{ x: 680 }} columns={[
        { title: '路径', dataIndex: 'path' },
        { title: '分类', dataIndex: 'category' },
        { title: '状态', render: (_, file: ProjectScanFile) => <Tag color={file.status === 'read' ? 'success' : file.status === 'failed' ? 'error' : file.status === 'unscanned' ? 'warning' : 'default'}>{file.status}</Tag> },
        { title: '原因', dataIndex: 'reason', render: value => value ? reasonLabels[value] || value : '—' },
        { title: '大小', dataIndex: 'size', render: value => value === null ? '—' : `${value} B` },
        { title: '正文', render: (_, file: ProjectScanFile) => file.status === 'read' ? <Button type="link" loading={sourceLoading} onClick={() => void showSource(file.path)}>查看</Button> : '—' },
      ]} />
    </Card>}
    <Modal title={source?.path || '文件正文'} open={Boolean(source)} onCancel={() => setSource(null)} footer={null} width={900} destroyOnClose>
      <pre style={{ maxHeight: '65vh', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source?.content}</pre>
    </Modal>
    <ProjectReportPanel repository={repository} scans={items} onAnalysisCompleted={onAnalysisCompleted} />
  </Card>;
}
