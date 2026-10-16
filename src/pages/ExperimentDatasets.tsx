import { isAdministrator } from '../utils/roles';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Alert, Button, Card, Checkbox, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Spin, Table, Tag, TreeSelect, Typography, Upload } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { createDataset, createDatasetSubset, createDatasetVersion, createEvaluationFolder, renameEvaluationFolder, deleteEvaluationFolder, previewEvaluationImport, confirmEvaluationImport, getDatasetCase, getDatasetVersion, getDatasetVersions, getEvaluationSettings, listDatasets, listEvaluationFolders, updateEvaluationSettings } from '../api/experiment-evaluation';
import type { EvaluationImportReport, EvaluationImportRequest } from '../api/experiment-evaluation';
import { ApiError, getStoredUser } from '../api/client';
import type { Dataset, DatasetCase } from '../api/experiment-evaluation';
import { EVALUATION_FIELDS, parseEvaluationFile, previewEvaluationRows } from '../utils/evaluationImport';
import type { EvaluationField, EvaluationImportSource } from '../utils/evaluationImport';

const example = JSON.stringify([{ caseKey: 'case-1', input: '解释 ReAct', expectedOutput: 'ReAct 将思考与行动交替进行', tags: ['Agent'], difficulty: 2, source: 'manual' }], null, 2);
type Folder = { id: string; name: string; parent_id: string | null };
type FolderNode = { value: string; title: string; children: FolderNode[] };
function toFolderTree(folders: Folder[]): FolderNode[] {
  const byId = new Map(folders.map(folder => [folder.id, { value: folder.id, title: folder.name, children: [] as FolderNode[] }]));
  const roots: FolderNode[] = [];
  for (const folder of folders) {
    const node = byId.get(folder.id)!;
    const parent = folder.parent_id ? byId.get(folder.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
export default function ExperimentDatasets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedVersionId = searchParams.get('versionId');
  const requestedCaseKey = searchParams.get('caseKey');
  const { message } = App.useApp();
  const [items, setItems] = useState<Dataset[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Dataset | 'new' | null>(null);
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string>();
  const [folderName, setFolderName] = useState('');
  const [renameFolderId, setRenameFolderId] = useState<string>();
  const [renameName, setRenameName] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [casesText, setCasesText] = useState(example);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<Record<string, { id: string; version: number }[]>>({});
  const [file, setFile] = useState<File>();
  const [source, setSource] = useState<EvaluationImportSource>();
  const [encoding, setEncoding] = useState<'auto' | 'utf-8' | 'gbk'>('auto');
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [serverPreviewState, setServerPreview] = useState<{ request: EvaluationImportRequest; report: EvaluationImportReport } | null>(null);
  const [serverPreviewLoading, setServerPreviewLoading] = useState(false);
  const [serverPreviewError, setServerPreviewError] = useState('');
  const [subset, setSubset] = useState<{ dataset: Dataset; versionId: string; cases: { case_key: string }[] }>();
  const [subsetKeys, setSubsetKeys] = useState<string[]>([]);
  const [subsetName, setSubsetName] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mediaGlobalGb, setMediaGlobalGb] = useState(10);
  const [mediaDatasetGb, setMediaDatasetGb] = useState(5);
  const [minFreePercent, setMinFreePercent] = useState(20);
  const [linkedCase, setLinkedCase] = useState<Record<string, unknown> | null>(null);
  const [linkedCaseError, setLinkedCaseError] = useState('');
  const [linkedCaseLoading, setLinkedCaseLoading] = useState(false);
  useEffect(() => {
    if (!requestedVersionId || !requestedCaseKey) return;
    let active = true;
    setLinkedCaseLoading(true); setLinkedCaseError(''); setLinkedCase(null);
    void getDatasetCase(requestedVersionId, requestedCaseKey).then(result => {
      if (!active) return;
      setLinkedCase(result.item);
    }).catch(cause => { if (active) setLinkedCaseError(cause instanceof Error ? cause.message : '用例加载失败'); })
      .finally(() => { if (active) setLinkedCaseLoading(false); });
    return () => { active = false; };
  }, [requestedVersionId, requestedCaseKey]);
  const closeLinkedCase = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('versionId'); next.delete('caseKey');
    setSearchParams(next, { replace: true });
    setLinkedCase(null);
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [datasets, tree] = await Promise.all([listDatasets(), listEvaluationFolders()]);
      setItems(datasets.items); setFolders(tree.items);
      setFolderId(current => current && !tree.items.some(folder => folder.id === current) ? undefined : current);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const preview = useMemo(() => source ? previewEvaluationRows(source) : [], [source]);
  const importRequest = useMemo<EvaluationImportRequest>(() => ({
    rows: preview.map(row => ({ rowNumber: row.rowNumber, data: row.data, parseErrors: row.errors })),
    ...(target === 'new' ? { name, folderId } : target ? { datasetId: target.id } : {}),
  }), [preview,target,name,folderId]);
  const serverPreview = serverPreviewState?.request === importRequest ? serverPreviewState.report : null;
  const invalid = serverPreview?.invalid ?? preview.filter(row => row.errors.length).length;
  const serverErrors = useMemo(() => new Map(serverPreview?.errors.map(row => [row.rowNumber,row.reason]) || []), [serverPreview]);
  useEffect(() => {
    if (!importOpen || !preview.length) { setServerPreview(null); setServerPreviewLoading(false); setServerPreviewError(''); return; }
    let active = true;
    setServerPreview(null); setServerPreviewLoading(true); setServerPreviewError('');
    const timer = window.setTimeout(() => {
      void previewEvaluationImport(importRequest).then(report => { if (active) setServerPreview({ request: importRequest, report }); })
        .catch(cause => { if (active) setServerPreviewError(cause instanceof Error ? cause.message : '服务端校验失败'); })
        .finally(() => { if (active) setServerPreviewLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [importOpen,preview,importRequest]);
  const folderTree = useMemo(() => toFolderTree(folders), [folders]);
  const selectedFolder = folders.find(folder => folder.id === folderId);
  const addFolder = async () => {
    if (!folderName.trim()) return;
    setFolderBusy(true);
    try { await createEvaluationFolder(folderName.trim(), folderId); setFolderName(''); message.success('文件夹已创建'); await load(); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '创建失败'); }
    finally { setFolderBusy(false); }
  };
  const saveFolderName = async () => {
    const folder = folders.find(item => item.id === renameFolderId);
    if (!folder || !renameName.trim()) return;
    setFolderBusy(true);
    try { await renameEvaluationFolder(folder.id, renameName.trim(), folder.parent_id); setRenameFolderId(undefined); message.success('文件夹已重命名'); await load(); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '重命名失败'); }
    finally { setFolderBusy(false); }
  };
  const removeFolder = async () => {
    if (!folderId) return;
    setFolderBusy(true);
    try { await deleteEvaluationFolder(folderId); setFolderId(undefined); message.success('空文件夹已删除'); await load(); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '删除失败'); }
    finally { setFolderBusy(false); }
  };
  const saveCases = async (cases: DatasetCase[]) => {
    if (target === 'new') await createDataset(name, cases, folderId);
    else if (target) await createDatasetVersion(target.id, cases);
  };
  const save = async () => {
    setBusy(true);
    try {
      const cases = JSON.parse(casesText) as DatasetCase[];
      if (!Array.isArray(cases)) throw new Error('用例须为 JSON 数组');
      await saveCases(cases);
      message.success('数据集版本已保存'); setTarget(null); await load();
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const readFile = async (candidate: File, selectedEncoding = encoding) => {
    try { setSource(parseEvaluationFile(await candidate.arrayBuffer(), candidate.name, selectedEncoding)); setFile(candidate); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '解析失败'); setSource(undefined); }
  };
  const openImport = (item: Dataset | 'new') => { setTarget(item); setImportOpen(true); setSource(undefined); setFile(undefined); setSkipInvalid(false); if (item === 'new') setName(''); };
  const confirmImport = async () => {
    if (!source || !serverPreview || serverPreviewLoading || !serverPreview.valid || serverPreview.globalErrors.length) return;
    if (serverPreview.invalid && !skipInvalid) { message.error('请修正无效行或勾选跳过'); return; }
    setBusy(true);
    try {
      const result = await confirmEvaluationImport({ ...importRequest, skipInvalid });
      message.success(`已导入 ${result.imported} 条，跳过 ${result.skipped} 条`);
      setImportOpen(false); setTarget(null); await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.payload && typeof cause.payload === 'object' && 'errors' in cause.payload) setServerPreview({ request: importRequest, report: cause.payload as EvaluationImportReport });
      message.error(cause instanceof Error ? cause.message : '导入失败');
    }
    finally { setBusy(false); }
  };
  const showVersions = async (item: Dataset) => {
    try { const value = await getDatasetVersions(item.id); setVersions(current => ({ ...current, [item.id]: value.items })); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '加载版本失败'); }
  };
  const openSubset = async (dataset: Dataset, versionId: string) => {
    try { const detail = await getDatasetVersion(versionId); setSubset({ dataset, versionId, cases: detail.cases as { case_key: string }[] }); setSubsetKeys([]); setSubsetName(`${dataset.name} · 子集`); }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '加载用例失败'); }
  };
  const admin = isAdministrator(getStoredUser<{role:string}>());
  const openSettings = async () => { try { const value=await getEvaluationSettings(); setMediaGlobalGb(Number(value.global_media_bytes)/1024**3); setMediaDatasetGb(Number(value.dataset_media_bytes)/1024**3); setMinFreePercent(Number(value.min_free_percent)); setSettingsOpen(true); } catch(cause) { message.error(cause instanceof Error ? cause.message : '设置加载失败'); } };
  const saveSettings = async () => { try { await updateEvaluationSettings({globalMediaBytes:Math.round(mediaGlobalGb*1024**3),datasetMediaBytes:Math.round(mediaDatasetGb*1024**3),minFreePercent}); setSettingsOpen(false); message.success('评测媒体配额已更新'); } catch(cause) { message.error(cause instanceof Error ? cause.message : '保存失败'); } };
  return <Card title="版本化评测数据集" extra={<Space wrap><Link to="/experiments">返回实验</Link>{admin && <Button onClick={() => void openSettings()}>媒体配额</Button>}<Button onClick={() => openImport('new')}>导入 CSV／JSONL</Button><Button type="primary" onClick={() => { setName(''); setCasesText(example); setTarget('new'); }}>新建数据集</Button></Space>}>
    <Typography.Paragraph type="secondary">每次保存生成不可变版本。支持最多 10,000 条文本或多模态用例；媒体使用已上传的附件 ID。</Typography.Paragraph>
    {error && <Alert type="error" message={error} showIcon action={<Button size="small" onClick={() => void load()}>重试</Button>} />}
    <Space wrap style={{ marginBottom: 16 }}>
      <TreeSelect aria-label="按文件夹浏览" allowClear treeDefaultExpandAll placeholder="全部文件夹" style={{ width: 240 }} treeData={folderTree} value={folderId} onChange={setFolderId} />
      {admin && <><Input aria-label="新文件夹名称" placeholder={folderId ? '新子文件夹名称' : '新根文件夹名称'} maxLength={120} value={folderName} onChange={event => setFolderName(event.target.value)} style={{ width: 180 }} /><Button disabled={!folderName.trim()} loading={folderBusy} onClick={() => void addFolder()}>创建文件夹</Button></>}
      {admin && selectedFolder && <><Button onClick={() => { setRenameFolderId(selectedFolder.id); setRenameName(selectedFolder.name); }}>重命名</Button><Popconfirm title={`删除空文件夹“${selectedFolder.name}”？`} description="包含子文件夹或数据集时无法删除" onConfirm={() => void removeFolder()}><Button danger loading={folderBusy}>删除</Button></Popconfirm></>}
    </Space>
    <Table rowKey="id" loading={loading} locale={{ emptyText: <Empty description={error ? '数据集加载失败' : folderId ? '当前文件夹暂无数据集' : '暂无评测数据集'}>{error ? <Button onClick={() => void load()}>重试</Button> : <Button type="primary" onClick={() => { setName(''); setCasesText(example); setTarget('new'); }}>新建数据集</Button>}</Empty> }} dataSource={items.filter(item => !folderId || item.folder_id === folderId)} columns={[{ title: '名称', dataIndex: 'name' }, { title: '最新版本', render: (_, item) => <Tag>v{item.latest_version}</Tag> }, { title: '来源', render: (_, item) => item.parent_version_id ? '版本子集' : '原始数据集' }, { title: '操作', render: (_, item) => <Space wrap><Button type="link" onClick={() => void showVersions(item)}>查看版本</Button><Button type="link" onClick={() => { setTarget(item); setCasesText(example); }}>新增版本</Button><Button type="link" onClick={() => openImport(item)}>导入为新版本</Button></Space> }]} expandable={{ rowExpandable: row => Boolean(versions[row.id]), expandedRowRender: row => <Space wrap>{versions[row.id]?.map(version => <Space key={version.id}><Tag>v{version.version} · {version.id}</Tag><Button size="small" onClick={() => void openSubset(row, version.id)}>创建子集</Button></Space>)}</Space> }} />
    <Modal title={target === 'new' ? '新建评测数据集' : '新增不可变版本'} open={Boolean(target) && !importOpen} onCancel={() => setTarget(null)} onOk={() => void save()} okButtonProps={{ loading: busy }} width={720}>
      {target === 'new' && <><Form.Item label="数据集名称" htmlFor="dataset-name"><Input id="dataset-name" value={name} onChange={event => setName(event.target.value)} /></Form.Item><Form.Item label="文件夹"><TreeSelect aria-label="数据集文件夹" allowClear treeDefaultExpandAll value={folderId} onChange={setFolderId} treeData={folderTree} style={{ width: '100%' }} /></Form.Item></>}
      <Form.Item label="用例 JSON" htmlFor="dataset-cases"><Input.TextArea id="dataset-cases" rows={14} value={casesText} onChange={event => setCasesText(event.target.value)} /></Form.Item>
      <Typography.Text type="secondary">字段：caseKey、input、expectedOutput、context、tags、difficulty、source；旧 variables/referenceAnswer 保持兼容。</Typography.Text>
    </Modal>
    <Modal title="导入评测用例" open={importOpen} onCancel={() => { setImportOpen(false); setTarget(null); }} onOk={() => void confirmImport()} okText="确认导入" okButtonProps={{ loading: busy, disabled: !source || !serverPreview || serverPreviewLoading || !serverPreview.valid || serverPreview.globalErrors.length > 0 || (invalid > 0 && !skipInvalid) }} width={960}>
      {target === 'new' && <><Form.Item label="数据集名称" htmlFor="dataset-import-name"><Input id="dataset-import-name" value={name} onChange={event => setName(event.target.value)} /></Form.Item><Form.Item label="文件夹"><TreeSelect aria-label="导入目标文件夹" allowClear treeDefaultExpandAll value={folderId} onChange={setFolderId} treeData={folderTree} style={{ width: '100%' }} /></Form.Item></>}
      <Space wrap><Upload accept=".csv,.jsonl" showUploadList={false} beforeUpload={candidate => { void readFile(candidate); return false; }}><Button>选择 CSV／JSONL</Button></Upload><Select value={encoding} style={{ width: 125 }} options={[{ value: 'auto', label: '自动编码' }, { value: 'utf-8', label: 'UTF-8' }, { value: 'gbk', label: 'GBK' }]} onChange={value => { setEncoding(value); if (file) void readFile(file, value); }} />{file?.name}</Space>
      {source && <>
        <Typography.Paragraph style={{ marginTop: 16 }}>共 {preview.length} 行，{invalid} 行无效。编码：{source.encoding}。{serverPreviewLoading ? '服务端正在校验…' : serverPreview ? '已完成服务端校验' : '等待服务端校验'}</Typography.Paragraph>
        {serverPreviewError && <Alert type="error" showIcon message={serverPreviewError} style={{ marginBottom: 12 }} />}
        {serverPreview?.globalErrors.map(reason => <Alert key={reason} type="error" showIcon message={reason} style={{ marginBottom: 12 }} />)}
        <Space wrap style={{ marginBottom: 12 }}>{source.headers.map((header, index) => <Space key={index} direction="vertical" size={0}><Typography.Text>{header || `第 ${index + 1} 列`}</Typography.Text><Select value={source.mapping[index]} style={{ width: 140 }} options={[{ value: '', label: '忽略' }, ...EVALUATION_FIELDS.map(field => ({ value: field, label: field }))]} onChange={(field: EvaluationField | '') => setSource(current => current ? { ...current, mapping: current.mapping.map((value, i) => i === index ? field : value) } : current)} /></Space>)}</Space>
        <Table size="small" rowKey="rowNumber" dataSource={preview} pagination={{ pageSize: 10 }} rowClassName={row => row.errors.length || serverErrors.has(row.rowNumber) ? 'evaluation-invalid-row' : ''} columns={[{ title: '原始行', dataIndex: 'rowNumber' }, { title: '用例 ID', render: (_, row) => row.data.caseKey }, { title: '输入', render: (_, row) => typeof row.data.input === 'string' ? row.data.input.slice(0, 100) : '[结构化输入]' }, { title: '校验', render: (_, row) => { const errors = [...new Set([...row.errors,...(serverErrors.has(row.rowNumber) ? [serverErrors.get(row.rowNumber)!] : [])])]; return errors.length ? <Tag color="red">{errors.join('；')}</Tag> : <Tag color="green">有效</Tag>; } }]} />
        <Checkbox checked={skipInvalid} onChange={event => setSkipInvalid(event.target.checked)}>跳过无效行</Checkbox>
      </>}
    </Modal>
    <Modal title="从固定版本创建子集" open={Boolean(subset)} onCancel={() => setSubset(undefined)} onOk={() => { if (!subset) return; void createDatasetSubset(subset.dataset.id, subset.versionId, subsetName, subsetKeys, folderId).then(() => { message.success('子集已创建'); setSubset(undefined); return load(); }).catch(cause => message.error(cause.message)); }} okButtonProps={{ disabled: !subsetKeys.length || !subsetName.trim() }} width={720}>
      <Input aria-label="子集名称" value={subsetName} onChange={event => setSubsetName(event.target.value)} style={{ marginBottom: 12 }} /><Select mode="multiple" aria-label="选择用例" maxTagCount="responsive" value={subsetKeys} onChange={setSubsetKeys} options={subset?.cases.map(item => ({ value: item.case_key, label: item.case_key }))} style={{ width: '100%' }} placeholder="选择源版本中的用例" />
    </Modal>
    <Modal title="重命名评测文件夹" open={Boolean(renameFolderId)} onCancel={() => setRenameFolderId(undefined)} onOk={() => void saveFolderName()} okButtonProps={{ loading: folderBusy, disabled: !renameName.trim() }}>
      <Input aria-label="文件夹新名称" maxLength={120} value={renameName} onChange={event => setRenameName(event.target.value)} />
    </Modal>
    <Modal title="评测媒体配额" open={settingsOpen} onCancel={() => setSettingsOpen(false)} onOk={() => void saveSettings()} okButtonProps={{disabled:mediaDatasetGb>mediaGlobalGb || mediaGlobalGb<=0 || mediaDatasetGb<=0}}><Form.Item label="总配额（GB）"><InputNumber min={0.001} step={1} value={mediaGlobalGb} onChange={value=>setMediaGlobalGb(value||0)} /></Form.Item><Form.Item label="单数据集配额（GB）"><InputNumber min={0.001} step={1} value={mediaDatasetGb} onChange={value=>setMediaDatasetGb(value||0)} /></Form.Item><Form.Item label="磁盘最小空闲比例（%）"><InputNumber min={0} max={99} value={minFreePercent} onChange={value=>setMinFreePercent(value||0)} /></Form.Item></Modal>
    <Modal title={`固定版本用例 · ${requestedCaseKey || ''}`} open={Boolean(requestedVersionId && requestedCaseKey)} onCancel={closeLinkedCase} footer={<Button onClick={closeLinkedCase}>关闭</Button>} width={760}>
      {linkedCaseLoading ? <Spin /> : linkedCaseError ? <Alert type="error" message={linkedCaseError} /> : linkedCase ? <pre className="global-search-case-detail">{JSON.stringify(linkedCase, null, 2)}</pre> : null}
    </Modal>
  </Card>;
}
