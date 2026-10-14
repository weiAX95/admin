import { useCallback, useEffect, useState } from 'react';
import { App, Button, Card, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { accountActivity, type AccountActivityItem } from '../api/accountActivity';
import { updateAccount } from '../api/accounts';
import { getStoredUser } from '../api/client';
import type { AuthUser } from '../types';

const moduleLabels: Record<string, string> = {
  dashboard: '学习仪表盘', tasks: '学习任务', sessions: '会话记录', notes: '学习笔记',
  experiments: '实验', evaluation: '评测', prompts: '提示词库', 'project-analysis': '项目分析',
  accounts: '账号管理', 'account-audit': '操作审计', settings: '系统设置', 'model-costs': '模型成本',
  'model-call-audit': '模型调用审计', 'model-health': '模型健康', alerts: '告警', other: '其他',
};
const displayTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无记录';

export default function AccountActivity() {
  const { message } = App.useApp();
  const me = getStoredUser<AuthUser>();
  const [rows, setRows] = useState<AccountActivityItem[]>([]);
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { const result = await accountActivity(); setRows(result.items); setTimezone(result.timezone); }
    catch (error) { message.error(error instanceof Error ? error.message : '读取活跃度失败'); }
    finally { setLoading(false); }
  }, [message]);
  useEffect(() => { void load(); }, [load]);
  const disable = async (item: AccountActivityItem) => {
    try { await updateAccount(item.id, { status: 'disabled' }); message.success(`已停用 ${item.username}`); await load(); }
    catch (error) { message.error(error instanceof Error ? error.message : '停用失败'); }
  };
  return <Card title="账号活跃度" extra={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}>
    <Typography.Paragraph type="secondary">近 30 个{timezone}日历日。排名分数＝页面访问次数＋操作次数＋登录天数 × 2；“最常访问”只统计接入此功能后的页面访问。连续 30 天未成功登录会标记为不活跃，不自动停用。</Typography.Paragraph>
    <Table rowKey="id" loading={loading} dataSource={rows} scroll={{ x: 1250 }} pagination={{ pageSize: 20 }} columns={[
      { title: '排名', dataIndex: 'rank', width: 70 },
      { title: '账号', dataIndex: 'username', width: 140 },
      { title: '状态', width: 145, render: (_, item: AccountActivityItem) => <Space size={4}><Tag color={item.status === 'active' ? 'green' : 'default'}>{item.status === 'active' ? '启用' : item.status === 'pending' ? '待激活' : '停用'}</Tag>{item.inactiveSince && <Tag color="orange">不活跃</Tag>}</Space> },
      { title: '最后活跃', dataIndex: 'lastActiveAt', width: 185, render: displayTime },
      { title: '最后登录', dataIndex: 'lastLoginAt', width: 185, render: displayTime },
      { title: '登录天数', dataIndex: 'loginDays', width: 95 },
      { title: '操作次数', dataIndex: 'operationCount', width: 95 },
      { title: '页面访问', dataIndex: 'pageViews', width: 95 },
      { title: '最常访问', dataIndex: 'mostVisitedModule', width: 130, render: value => value ? moduleLabels[value as string] || value : '暂无记录' },
      { title: '活跃分数', dataIndex: 'activityScore', width: 100 },
      { title: '操作', width: 100, render: (_, item: AccountActivityItem) => item.inactiveSince && item.status === 'active' && item.id !== me?.id
        ? <Popconfirm title={`停用不活跃账号 ${item.username}？`} onConfirm={() => void disable(item)}><Button type="link" danger>停用</Button></Popconfirm> : null },
    ]} />
  </Card>;
}
