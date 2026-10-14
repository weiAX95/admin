import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { getPermissionMatrix, type PermissionMatrixResponse } from '../api/permissions';
import { downloadBlob } from '../utils/noteExport';

type RoleRow = { id: string; label: string };
const csvCell = (value: string) => {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
};

export default function PermissionMatrix() {
  const { message } = App.useApp();
  const [matrix, setMatrix] = useState<PermissionMatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setMatrix(await getPermissionMatrix()); }
    catch (cause) { const detail = cause instanceof Error ? cause.message : '读取权限矩阵失败'; setError(detail); message.error(detail); }
    finally { setLoading(false); }
  }, [message]);
  useEffect(() => { void load(); }, [load]);

  const columns: ColumnsType<RoleRow> = matrix ? [
    { title: '角色', dataIndex: 'label', key: 'role', fixed: 'left', width: 135, render: (label: string) => <Typography.Text strong>{label}</Typography.Text> },
    ...matrix.resources.map(resource => ({
      title: <Tooltip title={resource.description}>{resource.label}</Tooltip>, key: resource.id,
      children: matrix.operations.map(operation => ({
        title: operation.label, key: `${resource.id}:${operation.id}`, width: 105, align: 'center' as const,
        render: (_: unknown, role: RoleRow) => {
          const scope = matrix.cells[role.id]?.[resource.id]?.[operation.id] || 'none';
          const detail = matrix.scopes[scope] || scope;
          return <Tooltip title={detail}><Tag color={scope === 'none' ? 'default' : scope === 'all' ? 'success' : 'processing'} aria-label={`${role.label} ${resource.label} ${operation.label}：${detail}`}>{scope === 'none' ? '✘' : '✔'}</Tag></Tooltip>;
        },
      })),
    })),
  ] : [];

  const exportCsv = () => {
    if (!matrix) return;
    const headings = ['角色', ...matrix.resources.flatMap(resource => matrix.operations.map(operation => `${resource.label}·${operation.label}`))];
    const lines = [headings, ...matrix.roles.map(role => [role.label, ...matrix.resources.flatMap(resource => matrix.operations.map(operation => {
      const scope = matrix.cells[role.id]?.[resource.id]?.[operation.id] || 'none';
      return `${scope === 'none' ? '✘' : '✔'} ${matrix.scopes[scope] || scope}`;
    }))])];
    downloadBlob(new Blob([`\uFEFF${lines.map(line => line.map(csvCell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), '权限矩阵.csv');
  };

  return <Card title="权限矩阵" extra={<Space><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Button icon={<DownloadOutlined />} disabled={!matrix} onClick={exportCsv}>导出 CSV</Button></Space>}>
    <Typography.Paragraph type="secondary">此表来自后端正在执行的权限配置。蓝色勾号表示有归属或可见范围限制；具体账号和记录仍由接口核查。未纳入统一规则的模块会逐项补充。</Typography.Paragraph>
    {error && <Alert type="error" showIcon message="读取权限配置失败" description={error} style={{ marginBottom: 16 }} />}
    <Table<RoleRow> rowKey="id" loading={loading} dataSource={matrix?.roles || []} columns={columns} pagination={false} scroll={{ x: Math.max(900, 135 + (matrix?.resources.length || 0) * (matrix?.operations.length || 0) * 105) }} />
  </Card>;
}
