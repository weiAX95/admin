import { useCallback, useEffect, useState } from 'react';
import { App, Button, Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { listAccountAudit, type AccountAuditItem, type AccountAuditQuery } from '../api/accountAudit';
import { listAccounts } from '../api/accounts';
import { getStoredUser } from '../api/client';
import type { Account, AuthUser } from '../types';
import { downloadBlob } from '../utils/noteExport';

const actionLabels: Record<string, string> = {
  login_success: '登录成功', login_failure: '登录失败', logout: '退出登录',
  create: '创建', update: '修改', delete: '删除', restore: '恢复', permanent: '永久删除',
  activate: '激活', revoke: '撤销', retry: '重试', cancel: '取消', pause: '暂停', resume: '恢复运行', archive: '归档', password_change: '修改密码',
};
const csvCell = (value: unknown) => {
  const raw = String(value ?? '');
  const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

export default function AccountAudit() {
  const { message } = App.useApp();
  const admin = getStoredUser<AuthUser>()?.role === 'admin';
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filters, setFilters] = useState<AccountAuditQuery>({});
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AccountAuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listAccountAudit({ ...filters, page, pageSize: 50 });
      setRows(result.items); setTotal(result.total);
    } catch (error) { message.error(error instanceof Error ? error.message : '读取审计记录失败'); }
    finally { setLoading(false); }
  }, [filters, page, message]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (admin) void listAccounts().then(result => setAccounts(result.items)).catch(() => undefined); }, [admin]);
  const changeFilter = (key: keyof AccountAuditQuery, value: string | undefined) => {
    setPage(1); setFilters(previous => ({ ...previous, [key]: value || undefined }));
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: AccountAuditItem[] = [];
      let next = 1, count = 0;
      do {
        const result = await listAccountAudit({ ...filters, page: next, pageSize: 200 });
        if (!result.items.length && result.total > all.length) throw new Error('导出期间记录发生变化，请重试');
        all.push(...result.items); count = result.total; next++;
      } while (all.length < count);
      const header = ['时间', '账号', '动作', '资源', '资源 ID', 'IP', '设备', '详情'];
      const lines = [header, ...all.map(item => [item.createdAt, String(item.details.actorUsername || item.details.username || item.actorId || ''),
        actionLabels[item.action] || item.action, item.resource, item.resourceId || '', item.details.ipAddress || '', item.details.userAgent || '', JSON.stringify(item.details)])];
      downloadBlob(new Blob([`\uFEFF${lines.map(line => line.map(csvCell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), '账号操作审计.csv');
    } catch (error) { message.error(error instanceof Error ? error.message : '导出审计记录失败'); }
    finally { setExporting(false); }
  };
  return <Space direction="vertical" size={16} style={{ display: 'flex' }}>
    <Card title={admin ? '操作审计' : '我的操作记录'} extra={<Space><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void exportCsv()}>导出 CSV</Button></Space>}>
      <Space wrap style={{ marginBottom: 16 }}>
        {admin && <Select allowClear showSearch optionFilterProp="label" style={{ width: 180 }} placeholder="选择账号" value={filters.actorId} options={accounts.map(account => ({ value: account.id, label: account.username }))} onChange={value => changeFilter('actorId', value)} />}
        <Select allowClear style={{ width: 150 }} placeholder="全部动作" value={filters.action} options={Object.entries(actionLabels).map(([value, label]) => ({ value, label }))} onChange={value => changeFilter('action', value)} />
        <Input style={{ width: 150 }} placeholder="资源类型" value={filters.resource || ''} onChange={event => changeFilter('resource', event.target.value)} />
        <Input type="date" aria-label="开始日期" style={{ width: 160 }} value={filters.from || ''} onChange={event => changeFilter('from', event.target.value)} />
        <Input type="date" aria-label="结束日期" style={{ width: 160 }} value={filters.to || ''} onChange={event => changeFilter('to', event.target.value)} />
      </Space>
      <Table rowKey="id" loading={loading} dataSource={rows} scroll={{ x: 1000 }} pagination={{ current: page, pageSize: 50, total, showSizeChanger: false, onChange: setPage }} columns={[
        { title: '时间', dataIndex: 'createdAt', width: 180, render: value => new Date(value as string).toLocaleString('zh-CN', { hour12: false }) },
        { title: '账号', width: 120, render: (_, item: AccountAuditItem) => String(item.details.actorUsername || item.details.username || item.actorId || '未知账号') },
        { title: '动作', dataIndex: 'action', width: 110, render: value => <Tag>{actionLabels[value as string] || value}</Tag> },
        { title: '资源', dataIndex: 'resource', width: 140 },
        { title: '资源 ID', dataIndex: 'resourceId', ellipsis: true, width: 180 },
        { title: '来源 IP', width: 145, render: (_, item: AccountAuditItem) => String(item.details.ipAddress || '—') },
        { title: '详情', render: (_, item: AccountAuditItem) => <Typography.Text ellipsis={{ tooltip: JSON.stringify(item.details) }} style={{ maxWidth: 260, display: 'inline-block' }}>{item.details.roleChange ? '角色变更 ' : item.details.statusChange ? '状态变更 ' : ''}{String(item.details.path || item.details.reason || '—')}</Typography.Text> },
      ]} />
    </Card>
  </Space>;
}
