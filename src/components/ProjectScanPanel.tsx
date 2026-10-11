import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Modal, Table, Tag, Typography } from 'antd';
import { getProjectScan, getProjectScanFile, listProjectScans, startProjectScan, type ProjectRepository, type ProjectScan, type ProjectScanFile } from '../api/projectRepositories';
import ProjectReportPanel from './ProjectReportPanel';

const statusLabels: Record<ProjectScan['status'], string> = { queued: '排队中', scanning: '扫描中', completed: '覆盖完成', partial: '部分覆盖', failed: '扫描失败' };
const reasonLabels: Record<string, string> = { dependency_or_build: '依赖或构建产物', sensitive_path: '敏感路径', sensitive_content: '疑似密钥内容', non_regular_file: '非普通文件', binary_type: '二进制类型', file_size: '超出单文件限制', scan_budget: '扫描预算用尽', github_rate_limit: 'GitHub 限流', blob_unavailable_or_invalid: '内容不可读取或格式无效' };

export default function ProjectScanPanel({ repository }: { repository: ProjectRepository }) {
  const { message } = App.useApp();
  const [items, setItems] = useState<ProjectScan[]>([]);
  const [detail, setDetail] = useState<(ProjectScan & { files: ProjectScanFile[] }) | null>(null);
  const [starting, setStarting] = useState(false);
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
    try { const scan = await startProjectScan(repository.id); setItems(current => [scan, ...current.filter(item => item.id !== scan.id)]); message.success('扫描任务已提交'); }
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

  return <Card title={`${repository.fullName} · 扫描记录`} extra={<Button type="primary" loading={starting} disabled={items.some(item => item.status === 'queued' || item.status === 'scanning')} onClick={() => void start()}>扫描当前 commit</Button>}>
    <Typography.Paragraph type="secondary">每次扫描固定提交时的 commit SHA。目录和文件读取预算有限；“部分覆盖”表示仍有失败或未扫描范围，不能据此认定项目已完整分析。已读取的文本正文保存在服务端，仅仓库所属账号可按需查看。</Typography.Paragraph>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Table rowKey="id" size="small" dataSource={items} pagination={{ pageSize: 5 }} scroll={{ x: 760 }} columns={[
      { title: '提交时间', dataIndex: 'createdAt', render: value => new Date(value).toLocaleString('zh-CN') },
      { title: 'commit', dataIndex: 'commitSha', render: (value: string) => <code title={value}>{value.slice(0, 10)}</code> },
      { title: '状态', render: (_, item: ProjectScan) => <Tag color={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'partial' ? 'warning' : 'processing'}>{statusLabels[item.status]}</Tag> },
      { title: '覆盖', render: (_, item: ProjectScan) => `${item.readCount} 读取 / ${item.excludedCount} 排除 / ${item.failedCount} 失败 / ${item.unscannedCount} 未扫描` },
      { title: '未扫描目录', dataIndex: 'unscannedSubtrees' },
      { title: '操作', render: (_, item: ProjectScan) => <Button type="link" onClick={() => void show(item.id)}>查看文件</Button> },
    ]} />
    {detail && <Card size="small" title={`文件索引 · ${detail.commitSha.slice(0, 10)}`} extra={<Button type="text" onClick={() => setDetail(null)}>关闭</Button>}>
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
    <ProjectReportPanel repository={repository} scans={items} />
  </Card>;
}
