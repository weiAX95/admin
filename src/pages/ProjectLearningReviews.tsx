import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Empty, Input, Modal, Space, Spin, Tag, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { listProjectLearningReviews, submitProjectLearningReview, type ProjectLearningReviewItem } from '../api/projectLearningReviews';

export default function ProjectLearningReviews() {
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const repositoryId = searchParams.get('repositoryId') || undefined;
  const [enteredRepositoryId, setEnteredRepositoryId] = useState(repositoryId || '');
  const [items, setItems] = useState<ProjectLearningReviewItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<ProjectLearningReviewItem | null>(null);
  const [coreCorrect, setCoreCorrect] = useState(false);
  const [boundaryVerified, setBoundaryVerified] = useState(false);
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setEnteredRepositoryId(repositoryId || ''); setPage(1); }, [repositoryId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void listProjectLearningReviews(repositoryId,page).then(result => {
      if (active) { setItems(result.items); setHasMore(result.hasMore); setError(''); }
    }).catch(cause => { if (active) { setItems([]); setHasMore(false); setError(cause instanceof Error ? cause.message : '核验请求读取失败'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [repositoryId,page,revision]);

  const openReview = (item: ProjectLearningReviewItem) => {
    setSelected(item); setCoreCorrect(false); setBoundaryVerified(false); setRationale('');
  };
  const submit = async () => {
    if (!selected || Array.from(rationale.trim()).length < 20) return;
    setSaving(true);
    try {
      const result = await submitProjectLearningReview(selected.evidenceId,{ coreCorrect,boundaryVerified,rationale: rationale.trim() });
      message.success(result.state === 'verified' ? '核验已通过' : '已标记需补充材料');
      setSelected(null);
      setPage(1);
      setRevision(value => value + 1);
    } catch (cause) { message.error(cause instanceof Error ? cause.message : '核验保存失败'); }
    finally { setSaving(false); }
  };

  return <Card title="项目学习记录独立核验" extra={<Button size="small" onClick={() => setRevision(value => value + 1)}>刷新</Button>}>
    <Alert type="info" showIcon message="仅核验由本人明确提交的记录" description="审核人必须是另一名管理员。理解回答核对概念和边界例子；实践记录核对过程与验收结果。两项都通过才标记为已核验，任务完成不会自动产生此结论。" style={{ marginBottom: 16 }} />
    <Space wrap style={{ marginBottom: 16 }}>
      <Input aria-label="项目 ID" value={enteredRepositoryId} onChange={event => setEnteredRepositoryId(event.target.value.trim())} placeholder="留空查看公开项目；私有项目填写审核链接中的 ID" style={{ width: 360, maxWidth: '100%' }} />
      <Button onClick={() => { const id = enteredRepositoryId.trim(); setSearchParams(id ? { repositoryId: id } : {}); setPage(1); }}>查看项目</Button>
    </Space>
    {repositoryId && <Typography.Paragraph type="secondary">私有项目仅在当前管理员也持有该仓库的 GitHub 读取授权时显示记录。</Typography.Paragraph>}
    {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    {loading ? <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div> : items.length ? <Space direction="vertical" style={{ width: '100%' }}>{items.map(item => <Card key={item.evidenceId} size="small" title={<Space wrap><span>{item.topic}</span><Tag>{item.kind === 'understanding' ? '理解回答' : '实践记录'}</Tag>{item.private && <Tag color="purple">私有项目</Tag>}</Space>} extra={<Button type="primary" size="small" onClick={() => openReview(item)}>核验</Button>}>
      <Typography.Paragraph type="secondary">{item.repositoryName} · 提交于 {new Date(item.submittedAt).toLocaleString('zh-CN')}</Typography.Paragraph>
      <Typography.Paragraph><strong>建议实践：</strong>{item.practice}</Typography.Paragraph>
      <Typography.Paragraph><strong>验收要求：</strong>{item.acceptance}</Typography.Paragraph>
      <Typography.Paragraph><strong>本人记录：</strong>{item.response}</Typography.Paragraph>
      {item.artifactUrl && <a href={item.artifactUrl} target="_blank" rel="noopener noreferrer">查看本人提供的 HTTPS 材料</a>}
    </Card>)}</Space> : !error && <Empty description="当前范围没有待核验记录" />}
    <Space style={{ marginTop: 16 }}><Button disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button><Typography.Text>第 {page} 页</Typography.Text><Button disabled={loading || !hasMore} onClick={() => setPage(value => value + 1)}>下一页</Button></Space>
    <Modal title={selected ? `核验：${selected.topic}` : '核验学习记录'} open={Boolean(selected)} onCancel={() => { if (!saving) setSelected(null); }} onOk={() => void submit()} okText="提交核验" okButtonProps={{ loading: saving, disabled: Array.from(rationale.trim()).length < 20 }} width={680}>
      {selected && <>
        <Typography.Paragraph>{selected.kind === 'understanding' ? '核对本人是否准确解释概念，并给出有意义的边界或反例。' : '核对本人提供的实践过程和材料是否足以复现，并与报告验收要求一致。'}</Typography.Paragraph>
        <Typography.Paragraph><strong>实践：</strong>{selected.practice}</Typography.Paragraph>
        <Typography.Paragraph><strong>验收：</strong>{selected.acceptance}</Typography.Paragraph>
        <Typography.Paragraph><strong>本人记录：</strong>{selected.response}</Typography.Paragraph>
        {selected.artifactUrl && <Typography.Paragraph><a href={selected.artifactUrl} target="_blank" rel="noopener noreferrer">查看本人提供的 HTTPS 材料</a></Typography.Paragraph>}
        <Space direction="vertical" style={{ width: '100%' }}>
          <Checkbox checked={coreCorrect} onChange={event => setCoreCorrect(event.target.checked)}>{selected.kind === 'understanding' ? '核心概念准确' : '实践过程与证据可信'}</Checkbox>
          <Checkbox checked={boundaryVerified} onChange={event => setBoundaryVerified(event.target.checked)}>{selected.kind === 'understanding' ? '边界情况或反例明确' : '验收结果可复现'}</Checkbox>
          <Input.TextArea aria-label="审核理由" value={rationale} onChange={event => setRationale(event.target.value)} rows={4} maxLength={2000} showCount placeholder="说明两项判断的具体依据，至少 20 字" />
        </Space>
        <Alert type={coreCorrect && boundaryVerified ? 'success' : 'warning'} showIcon message={coreCorrect && boundaryVerified ? '两项通过：提交后标为已核验' : '至少一项未通过：提交后标为需补充材料'} style={{ marginTop: 12 }} />
      </>}
    </Modal>
  </Card>;
}
