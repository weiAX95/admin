import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { getProjectLearningRoadmap, type ProjectLearningRoadmap as Roadmap } from '../api/projectRepositories';

const taskStatus: Record<string,string> = { todo: '待办', in_progress: '进行中', blocked: '阻塞', done: '已完成' };
const suggestionStatus: Record<string,string> = { pending: '待决定', accepted: '已接受', ignored: '已忽略' };

export default function ProjectLearningRoadmap({ repositoryId, analysisId }: { repositoryId: string; analysisId: string }) {
  const [data, setData] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getProjectLearningRoadmap(repositoryId,analysisId).then(result => {
      if (!cancelled) { setData(result); setError(''); }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '学习路线读取失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repositoryId,analysisId,revision]);

  return <Card size="small" title="学习路线与个人记录" loading={loading} extra={<Button size="small" onClick={() => setRevision(value => value + 1)}>刷新</Button>} style={{ marginBottom: 16 }}>
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
    {data && <>
      <Alert type={data.stale ? 'warning' : 'info'} showIcon message={data.stale ? '报告与当前项目基线不同，路线需重新核对' : '项目进度与个人学习证据分开显示'} description={data.evidenceScope} style={{ marginBottom: 12 }} />
      {data.evidenceTruncated && <Alert type="warning" showIcon message="关联记录较多，仅展示最近 500 条笔记和实验；当前证据列表不完整" style={{ marginBottom: 12 }} />}
      <Typography.Paragraph type="secondary">{data.previousAnalysisId ? '建议与上一份同目标、同需求基线的报告比较；“新增”只表示建议文字首次出现。' : '没有可比的上一份报告，建议变化暂不判断。'}依赖顺序仅依据已关联的本人任务；未关联的前置知识以文字保留。</Typography.Paragraph>
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
      {data.suggestions.length ? <Space direction="vertical" style={{ width: '100%', maxHeight: 420, overflowY: 'auto' }}>{data.suggestions.map(item => <Card key={item.id} size="small" style={{ width: '100%' }} title={<Space wrap><span>{item.topic}</span><Tag>{suggestionStatus[item.status]}</Tag>{item.newSincePrevious && <Tag color="blue">相较上次新增</Tag>}{item.impact === 'high' && <Tag color="orange">高影响</Tag>}</Space>}>
        <Typography.Paragraph>{item.reason}</Typography.Paragraph>
        <Typography.Paragraph><strong>实践：</strong>{item.practice}</Typography.Paragraph>
        <Typography.Paragraph><strong>验收：</strong>{item.acceptance}</Typography.Paragraph>
        <Typography.Text type="secondary">前置知识：{item.prerequisites.length ? item.prerequisites.join('、') : '报告未给出'}；对应本人任务：{item.linkedTaskIds.length ? item.linkedTaskIds.map(id => data.tasks.find(task => task.id === id)?.title || '已关联任务').join('、') : '暂无明确关联'}</Typography.Text>
      </Card>)}</Space> : <Empty description="本报告没有学习建议" />}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>接受或忽略建议请使用本报告下方的处理入口；理解检查和实践验收尚未记录时，系统不推断个人掌握程度。</Typography.Paragraph>
    </>}
  </Card>;
}
