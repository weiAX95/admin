import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, Space, Table, Tag, Typography } from 'antd';
import { createProjectRepository, listProjectRepositories, refreshProjectRepository, type ProjectRepository } from '../api/projectRepositories';

type FormValues = { url: string; branch?: string; goal: string; requirementBaseline?: string };

export default function ProjectAnalysis() {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [items, setItems] = useState<ProjectRepository[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try { setItems((await listProjectRepositories()).items); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '项目读取失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const create = async (values: FormValues) => {
    setSaving(true);
    try { await createProjectRepository(values); form.resetFields(); await load(); message.success('公开仓库已接入'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '仓库接入失败'); }
    finally { setSaving(false); }
  };
  const refresh = async (id: string) => {
    setRefreshing(id);
    try { await refreshProjectRepository(id); await load(); message.success('分支 commit 已更新'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '读取分支失败'); }
    finally { setRefreshing(''); }
  };

  return <Space direction="vertical" size={20} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="第一阶段：公开仓库只读接入" description="当前只读取公开仓库和指定分支的最新 commit；文件扫描、进度报告与学习建议将在后续阶段接入。" />
    <Card title="接入公开 GitHub 仓库">
      <Form form={form} layout="vertical" onFinish={values => void create(values)}>
        <Form.Item name="url" label="仓库地址" rules={[{ required: true, message: '请输入 https://github.com/所有者/仓库' }]}><Input placeholder="https://github.com/owner/repo" /></Form.Item>
        <Form.Item name="branch" label="分支（留空使用默认分支）"><Input placeholder="main" /></Form.Item>
        <Form.Item name="goal" label="项目目标" rules={[{ required: true, message: '请填写项目目标' }, { max: 2000 }]}><Input.TextArea rows={3} placeholder="希望这个项目实现什么？" /></Form.Item>
        <Form.Item name="requirementBaseline" label="需求基线版本（可选）" rules={[{ max: 200 }]}><Input placeholder="例如：需求文档 v1.0" /></Form.Item>
        <Button type="primary" htmlType="submit" loading={saving}>接入仓库</Button>
      </Form>
    </Card>
    <Card title="已接入项目">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Table rowKey="id" loading={loading} dataSource={items} scroll={{ x: 800 }} pagination={{ pageSize: 10 }} columns={[
        { title: '仓库', render: (_, item: ProjectRepository) => <a href={item.url} target="_blank" rel="noopener noreferrer">{item.fullName}</a> },
        { title: '分支', dataIndex: 'branch', render: value => <Tag>{value}</Tag> },
        { title: '当前 commit', dataIndex: 'commitSha', render: (value: string, item: ProjectRepository) => <a href={`${item.url}/commit/${value}`} target="_blank" rel="noopener noreferrer" title={value}><code>{value.slice(0, 10)}</code></a> },
        { title: '需求基线', dataIndex: 'requirementBaseline', render: value => value || '未指定' },
        { title: '最近读取', dataIndex: 'lastCheckedAt', render: value => new Date(value).toLocaleString('zh-CN') },
        { title: '分析状态', render: () => <Typography.Text type="secondary">尚未分析</Typography.Text> },
        { title: '操作', render: (_, item: ProjectRepository) => <Button type="link" loading={refreshing === item.id} onClick={() => void refresh(item.id)}>更新 commit</Button> },
      ]} />
    </Card>
  </Space>;
}
