import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { getProjectScan, getProjectScanFile, listProjectScans, startProjectScan, type ProjectRepository, type ProjectScan, type ProjectScanFile } from '../api/projectRepositories';
import ProjectReportPanel from './ProjectReportPanel';

const statusLabels: Record<ProjectScan['status'], string> = { queued: '排队中', scanning: '扫描中', completed: '覆盖完成', partial: '部分覆盖', failed: '扫描失败' };
const reasonLabels: Record<string, string> = { dependency_or_build: '依赖或构建产物', sensitive_path: '敏感路径', sensitive_content: '疑似密钥内容', non_regular_file: '非普通文件', binary_type: '二进制类型', file_size: '超出单文件限制', scan_budget: '扫描预算用尽', github_rate_limit: 'GitHub 限流', blob_unavailable_or_invalid: '内容不可读取或格式无效' };

export default function ProjectScanPanel({ repository, onAnalysisCompleted }: { repository: ProjectRepository; onAnalysisCompleted: () => void }) {
  const { message } = App.useApp();
  const [items, setItems] = useState<ProjectScan[]>([]);
  const [detail, setDetail] = useState<(ProjectScan & { files: ProjectScanFile[] }) | null>(null);
  const [starting, setStarting] = useState(false);
  const [budgetFileLimit, setBudgetFileLimit] = useState(200);
  const [budgetByteLimit, setBudgetByteLimit] = useState(5 * 1024 * 1024);
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
    try { const scan = await startProjectScan(repository.id, { budgetFileLimit, budgetByteLimit }); setItems(current => [scan, ...current.filter(item => item.id !== scan.id)]); message.success('扫描任务已提交'); }
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

  return <Card title={`${repository.fullName} · 扫描记录`}>
    <Typography.Paragraph type="secondary">每次扫描固定提交时的 commit SHA。目录和文件读取预算有限；“部分覆盖”表示仍有失败或未扫描范围，不能据此认定项目已完整分析。已读取的文本正文保存在服务端，仅仓库所属账号可按需查看。</Typography.Paragraph>
    <Space wrap style={{ marginBottom: 16 }}>
      <Select aria-label="扫描文件上限" value={budgetFileLimit} onChange={setBudgetFileLimit} style={{ width: 170 }} options={[50,100,200,500].map(value => ({ value, label: `最多 ${value} 个文件` }))} />
      <Select aria-label="扫描读取总量上限" value={budgetByteLimit} onChange={setBudgetByteLimit} style={{ width: 170 }} options={[1,5,10].map(value => ({ value: value * 1024 * 1024, label: `最多读取 ${value} MiB` }))} />
      <Button type="primary" loading={starting} disabled={items.some(item => item.status === 'queued' || item.status === 'scanning')} onClick={() => void start()}>扫描当前 commit</Button>
    </Space>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Table rowKey="id" size="small" dataSource={items} pagination={{ pageSize: 5 }} scroll={{ x: 760 }} columns={[
      { title: '提交时间', dataIndex: 'createdAt', render: value => new Date(value).toLocaleString('zh-CN') },
      { title: 'commit', dataIndex: 'commitSha', render: (value: string) => <code title={value}>{value.slice(0, 10)}</code> },
      { title: '状态', render: (_, item: ProjectScan) => <Tag color={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'partial' ? 'warning' : 'processing'}>{statusLabels[item.status]}</Tag> },
      { title: '覆盖', render: (_, item: ProjectScan) => `${item.readCount} 读取 / ${item.excludedCount} 排除 / ${item.failedCount} 失败 / ${item.unscannedCount} 未扫描` },
      { title: '预算', render: (_, item: ProjectScan) => `${item.budgetFileLimit} 文件 / ${item.budgetByteLimit / 1024 / 1024} MiB` },
      { title: '未扫描目录', dataIndex: 'unscannedSubtrees' },
      { title: '操作', render: (_, item: ProjectScan) => <Button type="link" onClick={() => void show(item.id)}>查看文件</Button> },
    ]} />
    {detail && <Card size="small" title={`文件索引 · ${detail.commitSha.slice(0, 10)}`} extra={<Button type="text" onClick={() => setDetail(null)}>关闭</Button>}>
      <Typography.Paragraph type="secondary">扫描预算：最多 {detail.budgetFileLimit} 个文件、读取 {detail.budgetByteLimit / 1024 / 1024} MiB；实际尝试 {detail.attemptedCount} 个文件、读取 {(detail.totalBytes / 1024 / 1024).toFixed(2)} MiB。单文件上限固定为 256 KiB。</Typography.Paragraph>
      {!detail.coverageComplete && <Alert type="warning" showIcon message="本次为部分覆盖，不能视作完整分析" description={detail.errorCode || (detail.unscannedSubtrees ? `${detail.unscannedSubtrees} 个目录未展开` : undefined)} style={{ marginBottom: 12 }} />}
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
