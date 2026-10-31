import { isAdministrator } from '../utils/roles';
import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Form, Input, Modal, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { ApiError, getStoredUser } from '../api/client';
import { listTasks } from '../api/tasks';
import { confirmProjectGithubIdentity, createProjectRepository, createProjectRequirementBaseline, disconnectProjectGithub, getProjectGithubConnection, getProjectRequirementBaseline, linkProjectTask, listGithubAvailableRepositories, listProjectLinkedTasks, listProjectRepositories, listProjectRequirementBaselines, previewProjectGithubIdentity, refreshProjectRepository, startProjectGithubConnection, unlinkProjectTask, updateProjectLinkedTaskRequirement, updateProjectRepository, updateProjectWebhookScan, type GithubAvailableRepository, type ProjectGithubConnection, type ProjectGithubIdentityPreview, type ProjectLinkedTask, type ProjectRepository, type ProjectRequirementBaseline } from '../api/projectRepositories';
import type { AuthUser, LearningTask } from '../types';
import ProjectScanPanel from '../components/ProjectScanPanel';

type FormValues = { url: string; branch?: string; goal: string; externalContext?: string; requirementBaseline?: string; useGithubApp?: boolean };
type EditValues = { goal: string; externalContext: string; requirementBaseline: string };

export default function ProjectAnalysis() {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [editForm] = Form.useForm<EditValues>();
  const [items, setItems] = useState<ProjectRepository[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ProjectRepository | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [refreshing, setRefreshing] = useState('');
  const [identityLoading, setIdentityLoading] = useState('');
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityPreview, setIdentityPreview] = useState<{ item: ProjectRepository; preview: ProjectGithubIdentityPreview } | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [webhookSaving, setWebhookSaving] = useState('');
  const [selectedRepositoryId, setSelectedRepositoryId] = useState(() => new URLSearchParams(window.location.search).get('repositoryId') || '');
  const [baselineRepositoryId, setBaselineRepositoryId] = useState('');
  const [baselineVersions, setBaselineVersions] = useState<ProjectRequirementBaseline[]>([]);
  const [baselineContent, setBaselineContent] = useState('');
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [baselineSaving, setBaselineSaving] = useState(false);
  const [error, setError] = useState('');
  const [taskRepositoryId, setTaskRepositoryId] = useState('');
  const [linkedTasks, setLinkedTasks] = useState<ProjectLinkedTask[]>([]);
  const [taskRequirements, setTaskRequirements] = useState<{ id: string; text: string }[]>([]);
  const [taskBaselineVersionId, setTaskBaselineVersionId] = useState<string | null>(null);
  const [taskCandidates, setTaskCandidates] = useState<LearningTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [selectedRequirementId, setSelectedRequirementId] = useState('');
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [githubConnection, setGithubConnection] = useState<ProjectGithubConnection | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubRepositories, setGithubRepositories] = useState<GithubAvailableRepository[]>([]);
  const [githubRepositoriesLoading, setGithubRepositoriesLoading] = useState(false);
  const [githubRepositoriesCursor, setGithubRepositoriesCursor] = useState<string | null>(null);
  const [selectedGithubRepository, setSelectedGithubRepository] = useState<string>();
  const githubRepositoryLoadId = useRef(0);

  const loadGithubConnection = async () => {
    try {
      const connection = await getProjectGithubConnection();
      setGithubConnection(connection);
      if (!connection.connected) {
        githubRepositoryLoadId.current += 1;
        setGithubRepositories([]);
        setGithubRepositoriesCursor(null);
        setSelectedGithubRepository(undefined);
        setGithubRepositoriesLoading(false);
      }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'GitHub 授权状态读取失败'); }
  };
  useEffect(() => {
    void loadGithubConnection();
    const result = new URLSearchParams(window.location.search).get('github');
    if (result === 'failed') setError('GitHub 授权未完成或已过期，请重新连接');
    if (result === 'connected') message.success('GitHub 账号已连接');
    if (result) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const connectGithub = async () => {
    setGithubBusy(true);
    try { window.location.assign((await startProjectGithubConnection()).url); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法启动 GitHub 授权'); setGithubBusy(false); }
  };
  const disconnectGithub = async () => {
    setGithubBusy(true);
    try { await disconnectProjectGithub(); githubRepositoryLoadId.current += 1; setGithubRepositories([]); setGithubRepositoriesCursor(null); setSelectedGithubRepository(undefined); setGithubRepositoriesLoading(false); await loadGithubConnection(); message.success('GitHub 账号已断开'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '断开 GitHub 授权失败'); }
    finally { setGithubBusy(false); }
  };
  const loadGithubRepositories = async (more = false) => {
    const loadId = ++githubRepositoryLoadId.current;
    setGithubRepositoriesLoading(true);
    try {
      const result = await listGithubAvailableRepositories(more ? githubRepositoriesCursor || undefined : undefined);
      if (loadId !== githubRepositoryLoadId.current) return;
      setGithubRepositories(current => more ? [...current, ...result.items.filter(item => !current.some(existing => existing.fullName === item.fullName))] : result.items);
      setGithubRepositoriesCursor(result.nextCursor);
      if (!more) setSelectedGithubRepository(current => result.items.some(item => item.fullName === current) ? current : undefined);
    } catch (cause) { if (loadId === githubRepositoryLoadId.current) setError(cause instanceof Error ? cause.message : 'GitHub 已授权仓库读取失败'); }
    finally { if (loadId === githubRepositoryLoadId.current) setGithubRepositoriesLoading(false); }
  };

  const load = async () => {
    setLoading(true);
    try { setItems((await listProjectRepositories()).items); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '项目读取失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const create = async (values: FormValues) => {
    setSaving(true);
    try { await createProjectRepository(values); form.resetFields(); await load(); message.success('仓库已接入'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '仓库接入失败'); }
    finally { setSaving(false); }
  };
  const refresh = async (id: string) => {
    setRefreshing(id);
    try { await refreshProjectRepository(id); await load(); message.success('分支 commit 已更新'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '读取分支失败'); }
    finally { setRefreshing(''); }
  };
  const previewIdentity = async (item: ProjectRepository) => {
    setIdentityLoading(item.id);
    try { setIdentityPreview({ item, preview: await previewProjectGithubIdentity(item.id) }); setIdentityConfirmed(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '仓库身份核对失败'); }
    finally { setIdentityLoading(''); }
  };
  const confirmIdentity = async () => {
    if (!identityPreview || !identityConfirmed) return;
    setIdentitySaving(true);
    try {
      await confirmProjectGithubIdentity(identityPreview.item.id,identityPreview.preview.candidate);
      setIdentityPreview(null);
      await load();
      message.success('仓库身份已核对；自动扫描仍需单独开启');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '仓库身份确认失败，请重新预览'); }
    finally { setIdentitySaving(false); }
  };
  const changeWebhookScan = async (item: ProjectRepository, enabled: boolean) => {
    setWebhookSaving(item.id);
    try {
      const updated = await updateProjectWebhookScan(item,enabled);
      setItems(current => current.map(repository => repository.id === item.id ? updated : repository));
      setError('');
      message.success(enabled ? '提交后自动扫描已开启' : '提交后自动扫描已关闭');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) await load();
      setError(cause instanceof Error ? cause.message : '自动扫描设置失败');
    } finally { setWebhookSaving(''); }
  };
  const openEdit = (item: ProjectRepository) => {
    setEditing(item);
    setEditError('');
    editForm.setFieldsValue({ goal: item.goal, externalContext: item.externalContext, requirementBaseline: item.requirementBaseline });
  };
  const saveEdit = async (values: EditValues) => {
    if (!editing) return;
    setEditSaving(true);
    setEditError('');
    try {
      await updateProjectRepository(editing, values);
      setEditing(null);
      await load();
      message.success('项目分析基线已更新，已有报告保留原始快照');
    } catch (cause) {
      setEditError(cause instanceof ApiError && cause.status === 409 ? `${cause.message}。关闭弹窗后重新打开可加载最新内容。` : cause instanceof Error ? cause.message : '项目修改失败');
      if (cause instanceof ApiError && cause.status === 409) await load();
    }
    finally { setEditSaving(false); }
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
  const openTaskLinks = async (repositoryId: string) => {
    setTaskRepositoryId(repositoryId);
    setTaskLoading(true);
    setSelectedTaskId(undefined);
    setSelectedRequirementId('');
    setLinkedTasks([]);
    setTaskRequirements([]);
    setTaskCandidates([]);
    setTaskError('');
    try {
      const [linked, tasks] = await Promise.all([listProjectLinkedTasks(repositoryId), listTasks()]);
      const user = getStoredUser<AuthUser>();
      setLinkedTasks(linked.items);
      setTaskRequirements(linked.requirements);
      setTaskBaselineVersionId(linked.baselineVersionId);
      setTaskCandidates(tasks.items.filter(task => isAdministrator(user) || task.ownerId === user?.id));
    } catch (cause) { setTaskError(cause instanceof Error ? cause.message : '关联任务读取失败'); }
    finally { setTaskLoading(false); }
  };
  const addTaskLink = async () => {
    if (!selectedTaskId) return;
    setTaskSaving(true);
    try {
      const task = await linkProjectTask(taskRepositoryId, selectedTaskId, selectedRequirementId || null, taskBaselineVersionId);
      setLinkedTasks(current => current.some(item => item.id === task.id) ? current : [task, ...current]);
      setSelectedTaskId(undefined);
      setSelectedRequirementId('');
      message.success('任务已关联');
    } catch (cause) { setTaskError(cause instanceof Error ? cause.message : '关联任务失败'); }
    finally { setTaskSaving(false); }
  };
  const removeTaskLink = async (taskId: string) => {
    setTaskSaving(true);
    try { await unlinkProjectTask(taskRepositoryId, taskId); setLinkedTasks(current => current.filter(item => item.id !== taskId)); message.success('关联已移除'); }
    catch (cause) { setTaskError(cause instanceof Error ? cause.message : '移除关联失败'); }
    finally { setTaskSaving(false); }
  };
  const changeTaskRequirement = async (taskId: string, requirementId: string) => {
    setTaskSaving(true);
    setTaskError('');
    try {
      const updated = await updateProjectLinkedTaskRequirement(taskRepositoryId,taskId,requirementId || null,taskBaselineVersionId);
      setLinkedTasks(current => current.map(item => item.id === taskId ? updated : item));
      message.success('任务对应需求已更新');
    } catch (cause) { setTaskError(cause instanceof Error ? cause.message : '更新对应需求失败'); }
    finally { setTaskSaving(false); }
  };

  return <Space direction="vertical" size={20} style={{ width: '100%' }}>
    <Alert type="info" showIcon message="GitHub 仓库与项目报告" description="公开仓库可扫描并分析固定 commit；私有仓库需先连接 GitHub App，并在模型分析前确认本次发送的文件范围与数据去向。" />
    <Card title="GitHub App 账号连接">
      <Space direction="vertical">
        <Typography.Text>{githubConnection?.connected ? `已连接 ${githubConnection.githubLogin}` : githubConnection?.configured ? '尚未连接 GitHub 账号' : '服务端尚未配置 GitHub App'}</Typography.Text>
        {githubConnection && !githubConnection.configured && <Alert type="warning" showIcon message="GitHub App 配置待完成" description={`请管理员检查服务端配置：${githubConnection.configurationIssues.join('、')}。配置后刷新此页。`} />}
        <Typography.Text type="secondary">连接账号后，从已授权仓库中选择私有仓库并接入。扫描仅读取所选仓库；开始模型分析前会再次展示发送范围供你确认。</Typography.Text>
        {githubConnection?.connected ? <Button danger loading={githubBusy} onClick={() => Modal.confirm({ title: '断开 GitHub 账号？', content: '断开后服务端删除本账号保存的 GitHub 凭证。', okText: '断开连接', okButtonProps: { danger: true }, onOk: disconnectGithub })}>断开连接</Button> : <Button loading={githubBusy} disabled={!githubConnection?.configured} onClick={() => void connectGithub()}>连接 GitHub</Button>}
        {githubConnection?.connected && <>
          <Button loading={githubRepositoriesLoading} onClick={() => void loadGithubRepositories()}>查看已授权仓库</Button>
          {githubRepositories.length > 0 && <Space wrap><Select aria-label="选择 GitHub App 已授权仓库" showSearch optionFilterProp="label" value={selectedGithubRepository} onChange={setSelectedGithubRepository} style={{ minWidth: 320 }} options={githubRepositories.map(repo => ({ value: repo.fullName, label: `${repo.fullName} · ${repo.private ? '私有' : '公开'}` }))} /><Button disabled={!selectedGithubRepository} onClick={() => { const repo = githubRepositories.find(item => item.fullName === selectedGithubRepository); if (repo) form.setFieldsValue({ url: `https://github.com/${repo.fullName}`, branch: repo.defaultBranch || undefined, useGithubApp: repo.private }); }}>填入接入表单</Button></Space>}
          {githubRepositoriesCursor && <Button loading={githubRepositoriesLoading} onClick={() => void loadGithubRepositories(true)}>加载更多授权仓库</Button>}
        </>}
      </Space>
    </Card>
    <Card title="接入 GitHub 仓库">
      <Form form={form} layout="vertical" onFinish={values => void create(values)}>
        <Form.Item name="url" label="仓库地址" rules={[{ required: true, message: '请输入 https://github.com/所有者/仓库' }]}><Input placeholder="https://github.com/owner/repo" /></Form.Item>
        <Form.Item name="branch" label="分支（留空使用默认分支）"><Input placeholder="main" /></Form.Item>
        <Form.Item name="useGithubApp" valuePropName="checked"><Checkbox>使用已连接的 GitHub App 读取私有仓库</Checkbox></Form.Item>
        <Form.Item name="goal" label="项目目标" rules={[{ required: true, message: '请填写项目目标' }, { max: 2000 }]}><Input.TextArea rows={3} placeholder="希望这个项目实现什么？" /></Form.Item>
        <Form.Item name="externalContext" label="仓库外配置说明（可选）" extra="描述无法从 GitHub commit 读取的部署环境或配置版本。此内容会发送给分析模型，请勿填写密钥。" rules={[{ max: 2000 }]}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
        <Form.Item name="requirementBaseline" label="需求基线标记（可选）" rules={[{ max: 200 }]}><Input placeholder="接入后可在项目列表添加带正文的版本化需求文档" /></Form.Item>
        <Button type="primary" htmlType="submit" loading={saving}>接入仓库</Button>
      </Form>
    </Card>
    <Card title="已接入项目">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Table rowKey="id" loading={loading} dataSource={items} scroll={{ x: 1100 }} pagination={{ pageSize: 10 }} columns={[
        { title: '仓库', render: (_, item: ProjectRepository) => <Space><a href={item.url} target="_blank" rel="noopener noreferrer">{item.fullName}</a>{item.private && <Tag color="purple">私有</Tag>}{item.githubRepositoryId === null && <Tag color="warning">身份待核对</Tag>}</Space> },
        { title: '分支', dataIndex: 'branch', render: value => <Tag>{value}</Tag> },
        { title: '当前 commit', dataIndex: 'commitSha', render: (value: string, item: ProjectRepository) => <a href={`${item.url}/commit/${value}`} target="_blank" rel="noopener noreferrer" title={value}><code>{value.slice(0, 10)}</code></a> },
        { title: '需求基线', dataIndex: 'requirementBaseline', render: value => value || '未指定' },
        { title: '最近读取', dataIndex: 'lastCheckedAt', render: value => new Date(value).toLocaleString('zh-CN') },
        { title: '最近完成分析', render: (_, item: ProjectRepository) => item.lastAnalysisAt && item.lastAnalyzedCommitSha ? <Space direction="vertical" size={0}><span>{new Date(item.lastAnalysisAt).toLocaleString('zh-CN')}</span><a href={`${item.url}/commit/${item.lastAnalyzedCommitSha}`} target="_blank" rel="noopener noreferrer" title={item.lastAnalyzedCommitSha}><code>{item.lastAnalyzedCommitSha.slice(0, 10)}</code></a>{item.commitSha !== item.lastAnalyzedCommitSha && <Tag color="warning">有新提交待分析</Tag>}</Space> : '尚无完成的分析' },
        { title: '提交后扫描', render: (_, item: ProjectRepository) => <Tooltip title={item.githubRepositoryId === null ? '先核对 GitHub 仓库身份，再开启自动扫描' : !githubConnection?.webhookConfigured ? '服务端尚未配置 GitHub Webhook 密钥' : '收到已验证的 GitHub 分支提交事件后自动创建扫描；公开仓库可另行开启自动模型分析'}><span><Switch aria-label={`${item.fullName} 提交后自动扫描`} checked={item.webhookScanEnabled} disabled={item.githubRepositoryId === null || !item.webhookScanEnabled && !githubConnection?.webhookConfigured} loading={webhookSaving === item.id} onChange={enabled => void changeWebhookScan(item,enabled)} /></span></Tooltip> },
        { title: '操作', render: (_, item: ProjectRepository) => <Space wrap><Button type="link" onClick={() => openEdit(item)}>编辑目标</Button>{item.githubRepositoryId === null ? <Button type="link" loading={identityLoading === item.id} onClick={() => void previewIdentity(item)}>核对仓库身份</Button> : <Button type="link" loading={refreshing === item.id} onClick={() => void refresh(item.id)}>更新 commit</Button>}<Button type="link" onClick={() => void openBaseline(item)}>需求文档</Button><Button type="link" onClick={() => void openTaskLinks(item.id)}>关联任务</Button><Button type="link" onClick={() => setSelectedRepositoryId(item.id)}>扫描记录</Button></Space> },
      ]} />
    </Card>
    <Modal title="核对 GitHub 仓库身份" open={Boolean(identityPreview)} onCancel={() => { if (!identitySaving) setIdentityPreview(null); }} onOk={() => void confirmIdentity()} okText="确认绑定" okButtonProps={{ loading: identitySaving, disabled: !identityConfirmed }} cancelButtonProps={{ disabled: identitySaving }}>
      {identityPreview && <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type="warning" showIcon message="旧项目缺少 GitHub 仓库 ID" description="仓库名称可能被改名或重新占用。请在 GitHub 核对下方仓库确实是原项目；确认前不会恢复自动扫描。" />
        <Typography.Paragraph>原记录：{identityPreview.preview.current.fullName} · {identityPreview.preview.current.commitSha.slice(0, 10)}</Typography.Paragraph>
        <Typography.Paragraph>当前 GitHub 仓库：<a href={`https://github.com/${identityPreview.preview.candidate.fullName}`} target="_blank" rel="noopener noreferrer">{identityPreview.preview.candidate.fullName}</a> · ID {identityPreview.preview.candidate.githubRepositoryId} · 分支 {identityPreview.preview.candidate.branch} · {identityPreview.preview.candidate.commitSha.slice(0, 10)}</Typography.Paragraph>
        <Checkbox checked={identityConfirmed} onChange={event => setIdentityConfirmed(event.target.checked)}>我已核对这是原项目对应的 GitHub 仓库</Checkbox>
      </Space>}
    </Modal>
    <Modal title={editing ? `编辑项目 · ${editing.fullName}` : '编辑项目'} open={Boolean(editing)} forceRender onCancel={() => { if (!editSaving) setEditing(null); }} onOk={() => editForm.submit()} okText="保存修改" okButtonProps={{ loading: editSaving }} cancelButtonProps={{ disabled: editSaving }}>
      {editError && <Alert type="error" showIcon message={editError} style={{ marginBottom: 16 }} />}
      <Typography.Paragraph type="secondary">修改后只影响后续分析；已有报告保留创建时的目标与需求快照。</Typography.Paragraph>
      <Form form={editForm} layout="vertical" onFinish={values => void saveEdit(values)}>
        <Form.Item name="goal" label="项目目标" rules={[{ required: true, whitespace: true, message: '请填写项目目标' }, { max: 2000 }]}><Input.TextArea rows={4} maxLength={2000} showCount /></Form.Item>
        <Form.Item name="externalContext" label="仓库外配置说明" extra="更改后，旧报告与后续分析会使用不同基线。内容会发送给分析模型，请勿填写密钥。" rules={[{ max: 2000 }]}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
        <Form.Item name="requirementBaseline" label="需求基线标记" rules={[{ max: 200 }]}><Input maxLength={200} disabled={Boolean(editing?.baselineVersionId)} /></Form.Item>
        {editing?.baselineVersionId && <Typography.Paragraph type="secondary">已有版本化需求文档。请使用“需求文档”入口保存新版本。</Typography.Paragraph>}
      </Form>
    </Modal>
    {items.find(item => item.id === selectedRepositoryId) && <ProjectScanPanel key={selectedRepositoryId} repository={items.find(item => item.id === selectedRepositoryId)!} onAnalysisCompleted={() => void load()} onRepositoryChanged={() => void load()} />}
    <Modal title="关联已有学习任务" open={Boolean(taskRepositoryId)} footer={null} onCancel={() => setTaskRepositoryId('')}>
      {taskError && <Alert type="error" showIcon message={taskError} style={{ marginBottom: 12 }} />}
      <Space wrap style={{ marginBottom: 16 }}>
        <Select aria-label="选择已有任务" showSearch optionFilterProp="label" placeholder="选择可关联的任务" style={{ minWidth: 280 }} loading={taskLoading} value={selectedTaskId} onChange={setSelectedTaskId} options={taskCandidates.filter(task => !linkedTasks.some(link => link.id === task.id)).map(task => ({ value: task.id, label: task.title }))} />
        <Select aria-label="对应需求" value={selectedRequirementId} onChange={setSelectedRequirementId} style={{ minWidth: 200 }} options={[{ value: '', label: '暂不对应具体需求' }, ...taskRequirements.map(item => ({ value: item.id, label: `${item.id} · ${item.text.slice(0, 60)}` }))]} />
        <Button type="primary" disabled={!selectedTaskId || taskLoading} loading={taskSaving} onClick={() => void addTaskLink()}>关联</Button>
      </Space>
      {linkedTasks.length ? linkedTasks.map(task => <Space key={task.id} wrap style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><Link to={`/tasks/${task.id}`}>{task.title}</Link><Space wrap><Tag>{task.status}</Tag><Select aria-label={`${task.title} 对应需求`} value={task.requirementId || ''} disabled={taskSaving} onChange={value => void changeTaskRequirement(task.id,value)} style={{ minWidth: 190 }} options={[{ value: '', label: '未指定需求' }, ...taskRequirements.map(item => ({ value: item.id, label: `${item.id} · ${item.text.slice(0, 50)}` })), ...(task.requirementId && !taskRequirements.some(item => item.id === task.requirementId) ? [{ value: task.requirementId, label: `${task.requirementId}（旧版本）` }] : [])]} /><Button type="link" danger disabled={taskSaving} onClick={() => void removeTaskLink(task.id)}>移除</Button></Space></Space>) : <Typography.Paragraph type="secondary">暂无关联任务</Typography.Paragraph>}
    </Modal>
    <Modal title="版本化需求文档" open={Boolean(baselineRepositoryId)} width={720} onCancel={() => setBaselineRepositoryId('')} onOk={() => void saveBaseline()} okText="保存为新版本" okButtonProps={{ loading: baselineSaving, disabled: baselineLoading || !baselineContent.trim() || baselineContent.length > 5000 }}>
      <Typography.Paragraph type="secondary">每次保存都会创建不可改写的新版本，分析任务固定所选版本。正文将作为模型分析输入，请勿包含密钥或不愿发给模型的信息。</Typography.Paragraph>
      {baselineVersions.length > 0 && <Space wrap style={{ marginBottom: 12 }}>{baselineVersions.map(version => <Button key={version.id} size="small" onClick={() => { void getProjectRequirementBaseline(baselineRepositoryId,version.id).then(item => setBaselineContent(item.content || '')).catch(cause => setError(cause instanceof Error ? cause.message : '需求版本读取失败')); }}>查看 v{version.version}</Button>)}</Space>}
      <Input.TextArea aria-label="需求文档正文" value={baselineContent} onChange={event => setBaselineContent(event.target.value)} rows={12} maxLength={5000} showCount placeholder="逐条描述项目需求；建议每条单独成行，便于后续报告对照。" disabled={baselineLoading} />
    </Modal>
  </Space>;
}
