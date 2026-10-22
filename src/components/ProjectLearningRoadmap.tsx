import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Empty, Input, Modal, Select, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { addProjectLearningEvidence, getProjectLearningRoadmap, setProjectPrerequisiteTask, type ProjectLearningEvidence, type ProjectLearningRoadmap as Roadmap, type ProjectPrerequisiteMapping } from '../api/projectRepositories';

const taskStatus: Record<string,string> = { todo: '待办', in_progress: '进行中', blocked: '阻塞', done: '已完成' };
const suggestionStatus: Record<string,string> = { pending: '待决定', accepted: '已接受', ignored: '已忽略' };
const prerequisiteState: Record<ProjectPrerequisiteMapping['state'], string> = { done: '关联任务已完成', pending: '关联任务未完成', unmapped: '未找到明确任务', ambiguous: '同名建议不唯一' };

export default function ProjectLearningRoadmap({ repositoryId, analysisId }: { repositoryId: string; analysisId: string }) {
  const { message } = App.useApp();
  const [data, setData] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [checkSuggestionId, setCheckSuggestionId] = useState('');
  const [checkKind, setCheckKind] = useState<ProjectLearningEvidence['kind']>('understanding');
  const [checkResponse, setCheckResponse] = useState('');
  const [checkArtifactUrl, setCheckArtifactUrl] = useState('');
  const [savingCheck, setSavingCheck] = useState(false);
  const [savingMappingKey, setSavingMappingKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getProjectLearningRoadmap(repositoryId,analysisId).then(result => {
      if (!cancelled) { setData(result); setError(''); }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '学习路线读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repositoryId,analysisId,revision]);

  const saveCheck = async () => {
    if (!checkSuggestionId) return;
    setSavingCheck(true);
    try {
      await addProjectLearningEvidence(repositoryId,analysisId,{ suggestionId: checkSuggestionId, kind: checkKind, response: checkResponse.trim(), artifactUrl: checkArtifactUrl.trim() });
      setCheckSuggestionId('');
      setCheckResponse('');
      setCheckArtifactUrl('');
      setRevision(value => value + 1);
      message.success('个人学习记录已保存，尚未核验掌握程度');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '学习记录保存失败'); }
    finally { setSavingCheck(false); }
  };

  const saveMapping = async (suggestionId: string, index: number, mapping: ProjectPrerequisiteMapping, taskId: string | null) => {
    const key = `${suggestionId}:${index}`;
    if (savingMappingKey || data?.stale) return;
    setSavingMappingKey(key);
    try {
      await setProjectPrerequisiteTask(repositoryId,analysisId,suggestionId,index,{ taskId, expectedVersion: mapping.version });
      message.success(taskId ? '前置知识已关联任务' : '已恢复自动匹配');
      setRevision(value => value + 1);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : '前置任务映射保存失败');
      setRevision(value => value + 1);
    } finally { setSavingMappingKey(''); }
  };

  return <Card size="small" title="学习路线与个人记录" loading={loading} extra={<Button size="small" onClick={() => setRevision(value => value + 1)}>刷新</Button>} style={{ marginBottom: 16 }}>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
    {data && <>
      <Alert type={data.stale ? 'warning' : 'info'} showIcon message={data.stale ? '报告与当前项目基线不同，路线需重新核对' : '项目进度与个人学习证据分开显示'} description={data.evidenceScope} style={{ marginBottom: 12 }} />
      {data.evidenceTruncated && <Alert type="warning" showIcon message="关联记录较多，仅展示最近 500 条笔记和实验；当前证据列表不完整" style={{ marginBottom: 12 }} />}
      <Typography.Paragraph type="secondary">{data.previousAnalysisId ? '建议与上一份同目标、同需求基线的报告比较；“新增”只表示建议文字首次出现。' : '没有可比的上一份报告，建议变化暂不判断。'}前置知识先按本报告的唯一同名建议自动匹配；你可手动关联本人已加入项目的任务，人工映射只改变学习路线，不改写固定报告或推断掌握程度。</Typography.Paragraph>
      <Typography.Title level={5}>关联任务 · 按依赖顺序</Typography.Title>
      {data.tasks.length ? <ol style={{ paddingLeft: 22, maxHeight: 440, overflowY: 'auto' }}>{data.tasks.map(task => <li key={task.id} style={{ marginBottom: 12 }}>
        <Space wrap><Link to={`/tasks/${task.id}`}>{task.title}</Link><Tag>{taskStatus[task.status] || task.status}</Tag>{task.id === data.nextTaskId && <Tag color="blue">建议下一步</Tag>}{task.requirementId && <Tag color="purple">需求 {task.requirementId}</Tag>}</Space>
        <div><Typography.Text type="secondary">{task.dependencyIds.length ? `前置任务：${task.dependencyIds.map(id => data.tasks.find(item => item.id === id)?.title || '已关联任务').join('、')}` : '无已关联的前置任务'}{task.externalBlockingCount ? `；另有 ${task.externalBlockingCount} 项未关联的未完成前置任务，请在任务详情核对` : ''}；任务进度 {task.progress === null ? '未记录' : `${Math.round(task.progress)}%`}。任务完成不等于已掌握。</Typography.Text></div>
        {(task.notes.length > 0 || task.experiments.length > 0) && <Space wrap size="small" style={{ marginTop: 4 }}>
          {task.notes.map(note => <Space key={note.id} size={2}><Link to={`/notes/${note.id}`}>笔记：{note.title}</Link>{note.sourceSessionId && <Link to={`/sessions?sessionId=${encodeURIComponent(note.sourceSessionId)}`}>来源会话</Link>}</Space>)}
          {task.experiments.map(experiment => <Link key={experiment.id} to={`/experiments/${experiment.id}`}>实验：{experiment.title}</Link>)}
        </Space>}
      </li>)}</ol> : <Empty description="暂无本人关联任务；先在项目中关联任务，路线才能按依赖排序" />}
      <Typography.Title level={5}>报告中的学习建议</Typography.Title>
      {data.suggestions.length ? <Space direction="vertical" style={{ width: '100%', maxHeight: 420, overflowY: 'auto' }}>{data.suggestions.map(item => <Card key={item.id} size="small" style={{ width: '100%' }} title={<Space wrap><span>{item.topic}</span><Tag>{suggestionStatus[item.status]}</Tag>{item.id === data.nextSuggestionId && <Tag color="blue">可考虑先处理</Tag>}{item.newSincePrevious && <Tag color="blue">相较上次新增</Tag>}{item.impact === 'high' && <Tag color="orange">高影响</Tag>}</Space>}>
        <Typography.Paragraph>{item.reason}</Typography.Paragraph>
        <Typography.Paragraph><strong>实践：</strong>{item.practice}</Typography.Paragraph>
        <Typography.Paragraph><strong>验收：</strong>{item.acceptance}</Typography.Paragraph>
        {item.adjustment && <Alert type="info" showIcon message="个人调整稿" description={<><div><strong>实践：</strong>{item.adjustment.practice}</div><div><strong>验收：</strong>{item.adjustment.acceptance}</div><div><strong>理由：</strong>{item.adjustment.rationale}</div></>} style={{ marginBottom: 8 }} />}
        <Typography.Text type="secondary">对应本人任务：{item.linkedTaskIds.length ? item.linkedTaskIds.map(id => data.tasks.find(task => task.id === id)?.title || '已关联任务').join('、') : '暂无明确关联'}</Typography.Text>
        {item.prerequisiteMappings.length ? <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
          {item.prerequisiteMappings.map((mapping,index) => {
            const key = `${item.id}:${index}`;
            const status = mapping.source === 'manual_stale' ? '原人工映射已失效，请重新关联或清除' : prerequisiteState[mapping.state];
            return <Space key={key} wrap align="center">
              <Typography.Text strong>{mapping.name}</Typography.Text>
              <Tag color={mapping.source === 'manual_stale' ? 'error' : mapping.state === 'done' ? 'success' : 'default'}>{mapping.source === 'manual' ? '人工映射' : mapping.source === 'manual_stale' ? '映射已失效' : '自动匹配'} · {status}</Tag>
              {mapping.source === 'auto' && mapping.taskIds.length > 0 && <Typography.Text type="secondary">{mapping.taskIds.map(id => data.tasks.find(task => task.id === id)?.title || '已关联任务').join('、')}</Typography.Text>}
              <Select aria-label={`前置知识 ${mapping.name} 关联任务`} showSearch optionFilterProp="label" style={{ minWidth: 240, maxWidth: '100%' }}
                placeholder="手动选择关联任务" value={mapping.source === 'manual' ? mapping.mappedTaskId || undefined : undefined}
                allowClear={mapping.source === 'manual'} disabled={data.stale || Boolean(savingMappingKey) || data.tasks.length === 0}
                loading={savingMappingKey === key} options={data.tasks.map(task => ({ value: task.id, label: `${task.title} · ${taskStatus[task.status] || task.status}` }))}
                onChange={value => void saveMapping(item.id,index,mapping,value || null)} />
              {mapping.source === 'manual_stale' && <Button size="small" disabled={data.stale || Boolean(savingMappingKey)} onClick={() => void saveMapping(item.id,index,mapping,null)}>清除失效映射</Button>}
            </Space>;
          })}
        </Space> : <Typography.Text type="secondary">；前置知识：报告未给出</Typography.Text>}
        {item.id === data.nextSuggestionId && <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>{data.nextSuggestionReason}</Typography.Paragraph>}
        <div style={{ marginTop: 8 }}><Button size="small" onClick={() => { setCheckSuggestionId(item.id); setCheckKind('understanding'); setCheckResponse(''); setCheckArtifactUrl(''); }}>记录理解或实践</Button></div>
        {item.evidence.length > 0 && <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>{item.evidence.map(entry => <Typography.Text key={entry.id} type="secondary">{entry.kind === 'understanding' ? '理解回答' : '实践记录'} · {new Date(entry.createdAt).toLocaleString('zh-CN')} · 已提交待核验：{entry.response.slice(0,150)}{entry.response.length > 150 ? '…' : ''}{entry.artifactUrl && <> · <a href={entry.artifactUrl} target="_blank" rel="noopener noreferrer">查看本人提供的材料</a></>}</Typography.Text>)}{item.evidenceCount > item.evidence.length && <Typography.Text type="secondary">另有 {item.evidenceCount - item.evidence.length} 条历史记录</Typography.Text>}</Space>}
      </Card>)}</Space> : <Empty description="本报告没有学习建议" />}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>接受或忽略建议请使用本报告下方的处理入口。本人提交的理解回答或实践记录尚需核验；系统不据此推断个人掌握程度。</Typography.Paragraph>
    </>}
    <Modal title="记录个人理解或实践" open={Boolean(checkSuggestionId)} onCancel={() => { if (!savingCheck) setCheckSuggestionId(''); }} onOk={() => void saveCheck()} okText="保存记录" okButtonProps={{ loading: savingCheck, disabled: Array.from(checkResponse.trim()).length < 20 || Array.from(checkResponse.trim()).length > 4000 }}>
      <Alert type="info" showIcon message="此记录是本人提交的学习证据，保存后仍标为待核验，不会自动判定掌握" style={{ marginBottom: 12 }} />
      <Select aria-label="记录类型" value={checkKind} onChange={setCheckKind} style={{ width: '100%', marginBottom: 12 }} options={[{ value: 'understanding', label: '简短理解检查' },{ value: 'practice', label: '实践验收记录' }]} />
      <Typography.Paragraph>{checkKind === 'understanding' ? `请用自己的话解释“${data?.suggestions.find(item => item.id === checkSuggestionId)?.topic || '本主题'}”的关键概念，并举出一个容易出错的边界。` : `请说明你如何完成实践，以及如何核对验收标准：${data?.suggestions.find(item => item.id === checkSuggestionId)?.acceptance || '按报告要求验证'}`}</Typography.Paragraph>
      <Input.TextArea aria-label="理解回答或实践记录" value={checkResponse} onChange={event => setCheckResponse(event.target.value)} rows={6} maxLength={4000} showCount placeholder="至少 20 字，请写出自己的理解或实践过程" />
      <Input aria-label="实践材料链接" value={checkArtifactUrl} onChange={event => setCheckArtifactUrl(event.target.value)} maxLength={2048} placeholder="可选：HTTPS 证据链接" style={{ marginTop: 12 }} />
    </Modal>
  </Card>;
}
