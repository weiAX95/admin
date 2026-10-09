import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Space, Table, Tag, Typography } from 'antd';
import { createBackup, downloadBackup, listBackups, type BackupJob } from '../api/backups';
import { downloadBlob } from '../utils/noteExport';

const statusText = { queued: '排队中', running: '生成中', completed: '已完成', failed: '失败' };
export default function BackupSettings() {
  const { message } = App.useApp();
  const [items, setItems] = useState<BackupJob[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState('');
  const refresh = () => { void listBackups().then(value => { setItems(value.items); setError(''); }).catch(cause => setError(cause.message)); };
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, []);
  const create = async () => {
    setLoading(true);
    try { await createBackup(); refresh(); message.success('备份任务已启动'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '备份启动失败'); }
    finally { setLoading(false); }
  };
  const download = async (id: string) => {
    setDownloading(id);
    try { downloadBlob(await downloadBackup(id), `backup-${id}.agbackup`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '下载失败'); }
    finally { setDownloading(''); }
  };
  return <Card title="本地加密备份" extra={<Button type="primary" loading={loading} disabled={items.some(item => ['queued','running'].includes(item.status))} onClick={() => void create()}>创建备份</Button>}>
    <Typography.Paragraph type="secondary">后台生成 PostgreSQL 与附件归档，完成后可下载加密文件。恢复向导和自动备份仍在建设中；请将密钥与备份文件分开保管。本地副本无法应对整台服务器故障。</Typography.Paragraph>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Table rowKey="id" size="small" dataSource={items} pagination={{ pageSize: 10 }} scroll={{ x: 650 }} columns={[
      { title: '创建时间', dataIndex: 'createdAt', render: value => new Date(value).toLocaleString('zh-CN') },
      { title: '状态', render: (_, item: BackupJob) => <Space><Tag color={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : 'processing'}>{statusText[item.status]}</Tag>{item.status === 'failed' && <Typography.Text type="danger">{item.errorCode}</Typography.Text>}</Space> },
      { title: '大小', dataIndex: 'fileSize', render: value => value === null ? '—' : `${(value / 1024 / 1024).toFixed(2)} MB` },
      { title: '文件数', dataIndex: 'fileCount', render: value => value ?? '—' },
      { title: '操作', render: (_, item: BackupJob) => <Button type="link" disabled={item.status !== 'completed'} loading={downloading === item.id} onClick={() => void download(item.id)}>下载</Button> },
    ]} />
  </Card>;
}
