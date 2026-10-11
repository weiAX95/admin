import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { createProjectRepository, createProjectRequirementBaseline, getProjectRequirementBaseline, listProjectRepositories, listProjectRequirementBaselines, refreshProjectRepository, type ProjectRepository, type ProjectRequirementBaseline } from '../api/projectRepositories';
import ProjectScanPanel from '../components/ProjectScanPanel';

type FormValues = { url: string; branch?: string; goal: string; requirementBaseline?: string };

export default function ProjectAnalysis() {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [items, setItems] = useState<ProjectRepository[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState('');
  const [selectedRepositoryId, setSelectedRepositoryId] = useState('');
  const [baselineRepositoryId, setBaselineRepositoryId] = useState('');
  const [baselineVersions, setBaselineVersions] = useState<ProjectRequirementBaseline[]>([]);
  const [baselineContent, setBaselineContent] = useState('');
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [baselineSaving, setBaselineSaving] = useState(false);
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
  const openBaseline = async (item: ProjectRepository) => {
    setBaselineRepositoryId(item.id);
    setBaselineLoading(true);
    setBaselineContent('');
    try {
      const versions = await listProjectRequirementBaselines(item.id);
      setBaselineVersions(versions.items);
      if (item.baselineVersionId) setBaselineContent((await getProjectRequirementBaseline(item.id,item.baselineVersionId)).content || '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '需求文档读取失败'); }
    finally { setBaselineLoading(false); }
  };
  const saveBaseline = async () => {
    const current = items.find(item => item.id === baselineRepositoryId);
    if (!current) return;
    setBaselineSaving(true);
    try {
      await createProjectRequirementBaseline(current.id,baselineContent,current.baselineVersionId);
      await load();
      const versions = await listProjectRequirementBaselines(current.id);
      setBaselineVersions(versions.items);
      setBaselineRepositoryId('');
      message.success('需求文档新版本已保存');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '需求文档保存失败'); }
    finally { setBaselineSaving(false); }
  };

  return <Space direction="vertical" size={20} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="公开仓库只读扫描与项目报告" description="先扫描固定 commit，再选择模型生成有文件行证据的报告；结论仍需人工核验，未扫描区域不代表未实现。" />
    <Card title="接入公开 GitHub 仓库">
      <Form form={form} layout="vertical" onFinish={values => void create(values)}>
        <Form.Item name="url" label="仓库地址" rules={[{ required: true, message: '请输入 https://github.com/所有者/仓库' }]}><Input placeholder="https://github.com/owner/repo" /></Form.Item>
        <Form.Item name="branch" label="分支（留空使用默认分支）"><Input placeholder="main" /></Form.Item>
        <Form.Item name="goal" label="项目目标" rules={[{ required: true, message: '请填写项目目标' }, { max: 2000 }]}><Input.TextArea rows={3} placeholder="希望这个项目实现什么？" /></Form.Item>
        <Form.Item name="requirementBaseline" label="需求基线标记（可选）" rules={[{ max: 200 }]}><Input placeholder="接入后可在项目列表添加带正文的版本化需求文档" /></Form.Item>
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
        { title: '操作', render: (_, item: ProjectRepository) => <Space><Button type="link" loading={refreshing === item.id} onClick={() => void refresh(item.id)}>更新 commit</Button><Button type="link" onClick={() => void openBaseline(item)}>需求文档</Button><Button type="link" onClick={() => setSelectedRepositoryId(item.id)}>扫描记录</Button></Space> },
      ]} />
    </Card>
    {items.find(item => item.id === selectedRepositoryId) && <ProjectScanPanel key={selectedRepositoryId} repository={items.find(item => item.id === selectedRepositoryId)!} />}
    <Modal title="版本化需求文档" open={Boolean(baselineRepositoryId)} width={720} onCancel={() => setBaselineRepositoryId('')} onOk={() => void saveBaseline()} okText="保存为新版本" okButtonProps={{ loading: baselineSaving, disabled: baselineLoading || !baselineContent.trim() || baselineContent.length > 5000 }}>
      <Typography.Paragraph type="secondary">每次保存都会创建不可改写的新版本，分析任务固定所选版本。正文将作为模型分析输入，请勿包含密钥或不愿发给模型的信息。</Typography.Paragraph>
      {baselineVersions.length > 0 && <Space wrap style={{ marginBottom: 12 }}>{baselineVersions.map(version => <Button key={version.id} size="small" onClick={() => { void getProjectRequirementBaseline(baselineRepositoryId,version.id).then(item => setBaselineContent(item.content || '')).catch(cause => setError(cause instanceof Error ? cause.message : '需求版本读取失败')); }}>查看 v{version.version}</Button>)}</Space>}
      <Input.TextArea aria-label="需求文档正文" value={baselineContent} onChange={event => setBaselineContent(event.target.value)} rows={12} maxLength={5000} showCount placeholder="逐条描述项目需求；建议每条单独成行，便于后续报告对照。" disabled={baselineLoading} />
    </Modal>
  </Space>;
}
