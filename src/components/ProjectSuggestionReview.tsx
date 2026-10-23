import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, Empty, Input, Row, Select, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import {
  getProjectSuggestionReviews,
  saveProjectSuggestionReview,
  type ProjectSuggestionReviewOutcome,
  type ProjectSuggestionReviewPair,
} from '../api/projectRepositories';

type ReviewItem = ProjectSuggestionReviewPair['items'][number];
type ReviewDraft = { newerSuggestionId: string | null; outcome: ProjectSuggestionReviewOutcome | null; note: string };

const outcomeLabels: Record<ProjectSuggestionReviewOutcome, string> = {
  matched: '对应同一建议',
  follow_up: '仍需后续跟进',
  no_longer_relevant: '已不再适用',
};

function draftFor(item: ReviewItem): ReviewDraft {
  return {
    newerSuggestionId: item.review?.newerSuggestionId || null,
    outcome: item.review?.outcome || null,
    note: item.review?.note || '',
  };
}

function lexicalHint(similarity: number): string {
  return `${Math.round(Math.max(0, Math.min(1, similarity)) * 100)}% 词面相似`;
}

export default function ProjectSuggestionReview({ repositoryId, olderAnalysisId, newerAnalysisId }: { repositoryId: string; olderAnalysisId: string; newerAnalysisId: string }) {
  const { message, modal } = App.useApp();
  const [pair, setPair] = useState<ProjectSuggestionReviewPair | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [loading, setLoading] = useState(true);
  const [reloadSerial, setReloadSerial] = useState(0);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPair(null);
    setDrafts({});
    setSaveError({});
    setError('');
    void getProjectSuggestionReviews(repositoryId, olderAnalysisId, newerAnalysisId).then(result => {
      if (!active) return;
      setPair(result);
      setDrafts(Object.fromEntries(result.items.map(item => [item.older.id, draftFor(item)])));
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : '建议复核记录读取失败');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [repositoryId, olderAnalysisId, newerAnalysisId, reloadSerial]);

  const updateDraft = (id: string, change: Partial<ReviewDraft>) => {
    setDrafts(current => ({ ...current, [id]: { ...(current[id] || { newerSuggestionId: null, outcome: null, note: '' }), ...change } }));
    setSaveError(current => ({ ...current, [id]: '' }));
  };

  const save = async (item: ReviewItem, draft: ReviewDraft) => {
    setSavingId(item.older.id);
    setSaveError(current => ({ ...current, [item.older.id]: '' }));
    try {
      const saved = await saveProjectSuggestionReview(repositoryId, olderAnalysisId, newerAnalysisId, item.older.id, {
        newerSuggestionId: draft.newerSuggestionId,
        outcome: draft.outcome!,
        note: draft.note.trim(),
        expectedVersion: item.review?.version || 0,
      });
      setPair(current => current && ({
        ...current,
        items: current.items.map(row => row.older.id === item.older.id ? { ...row, review: saved } : row),
      }));
      setDrafts(current => ({ ...current, [item.older.id]: { ...draft, note: draft.note.trim() } }));
      message.success('复核记录已保存；原建议的接受或忽略决定未改变');
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : '建议复核保存失败';
      setSaveError(current => ({ ...current, [item.older.id]: `${detail}。请重新读取记录，核对后再试。` }));
      message.error(detail);
    } finally {
      setSavingId('');
    }
  };

  const confirmSave = (item: ReviewItem, draft: ReviewDraft) => {
    const candidate = item.candidates.find(row => row.id === draft.newerSuggestionId);
    modal.confirm({
      title: '确认保存这条建议的复核结果？',
      content: <Space direction="vertical" size="small">
        <span>旧建议：{item.older.topic}</span>
        <span>新建议：{candidate?.topic || '未选择'}</span>
        <span>结论：{outcomeLabels[draft.outcome!]}</span>
        <span>理由：{draft.note.trim()}</span>
        <Typography.Text type="secondary">此操作只记录人工复核，不会自动接受、忽略或创建任务。</Typography.Text>
      </Space>,
      okText: '确认保存',
      cancelText: '返回检查',
      onOk: () => save(item, draft),
    });
  };

  return <Card size="small" title="逐条人工复核学习建议" style={{ marginTop: 16 }} loading={loading} extra={<Button size="small" onClick={() => setReloadSerial(current => current + 1)} disabled={loading || !!savingId}>重新读取</Button>}>
    {error && <Alert type="error" showIcon message="复核记录读取失败" description={error} action={<Button size="small" onClick={() => setReloadSerial(current => current + 1)}>重试</Button>} style={{ marginBottom: 12 }} />}
    {pair && <>
      <Typography.Paragraph type="secondary">旧提交 {pair.olderCommitSha.slice(0, 10)} → 新提交 {pair.newerCommitSha.slice(0, 10)}。候选相似度只是词面提示，需对照实践和验收要求再判断；旧决定与新建议的状态不会被自动改动。</Typography.Paragraph>
      {pair.limitations.length > 0 && <Alert type="warning" showIcon message="复核范围有限" description={pair.limitations.join('；')} style={{ marginBottom: 12 }} />}
      {pair.stale && <Alert type="warning" showIcon message="报告已失效，只能查看复核记录" description="仓库身份、目标或基线已发生变化，不能继续保存这组报告的复核。" style={{ marginBottom: 12 }} />}
      {pair.items.length === 0 ? <Empty description="旧报告没有需要复核的学习建议" /> : <Space direction="vertical" style={{ width: '100%' }}>
        {pair.items.map(item => {
          const draft = drafts[item.older.id] || draftFor(item);
          const chosen = item.candidates.find(candidate => candidate.id === draft.newerSuggestionId);
          const noteLength = Array.from(draft.note.trim()).length;
          const invalid = !draft.outcome || noteLength < 10 || noteLength > 1000 || (draft.outcome === 'matched' && !chosen) || (draft.outcome === 'no_longer_relevant' && !!draft.newerSuggestionId);
          const unchanged = item.review && item.review.newerSuggestionId === draft.newerSuggestionId && item.review.outcome === draft.outcome && item.review.note === draft.note.trim();
          return <Card key={item.older.id} size="small" title={<Space wrap>旧建议：{item.older.topic}{item.review && <Tag color="green">{outcomeLabels[item.review.outcome]} · 第 {item.review.version} 版</Tag>}</Space>}>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag>{item.older.status === 'accepted' ? '旧决定：已接受' : item.older.status === 'ignored' ? '旧决定：已忽略' : item.older.status === 'stale' ? '旧建议已失效' : '旧决定：未处理'}</Tag>
              {item.older.requirementId && <Tag>需求 {item.older.requirementId}</Tag>}
              {item.older.taskId && <Link to={`/tasks/${item.older.taskId}`}>查看关联任务</Link>}
              {item.review && <Typography.Text type="secondary">上次复核：{new Date(item.review.reviewedAt).toLocaleString('zh-CN')}</Typography.Text>}
            </Space>
            <Row gutter={[16, 12]}>
              <Col xs={24} md={12}>
                <Card size="small" title={`旧提交 ${pair.olderCommitSha.slice(0, 10)}`}>
                  <Typography.Paragraph><strong>主题：</strong>{item.older.topic}</Typography.Paragraph>
                  <Typography.Paragraph><strong>实践：</strong>{item.older.practice}</Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 0 }}><strong>验收：</strong>{item.older.acceptance}</Typography.Paragraph>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card size="small" title={`新提交 ${pair.newerCommitSha.slice(0, 10)}`}>
                  <Select aria-label={`${item.older.topic} 对应的新建议`} placeholder="选择新建议；也可不选" allowClear value={draft.newerSuggestionId || undefined} disabled={pair.stale || !!savingId} onChange={value => updateDraft(item.older.id, { newerSuggestionId: value || null })} style={{ width: '100%', marginBottom: 12 }} options={item.candidates.map(candidate => ({ value: candidate.id, label: `${candidate.topic} · ${lexicalHint(candidate.similarity)}${candidate.sameRequirement ? ' · 同一需求' : ''}` }))} />
                  {chosen ? <>
                    <Typography.Paragraph type="secondary">{lexicalHint(chosen.similarity)}，{chosen.sameRequirement ? '同一固定需求 ID' : '固定需求 ID 不同或缺失'}；这不是已完成判定。</Typography.Paragraph>
                    <Typography.Paragraph><strong>实践：</strong>{chosen.practice}</Typography.Paragraph>
                    <Typography.Paragraph style={{ marginBottom: 0 }}><strong>验收：</strong>{chosen.acceptance}</Typography.Paragraph>
                  </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择新建议；可记录后续跟进或不再适用" />}
                </Card>
              </Col>
            </Row>
            <Space direction="vertical" style={{ width: '100%', marginTop: 12 }}>
              <Select aria-label={`${item.older.topic} 复核结论`} placeholder="选择复核结论" value={draft.outcome || undefined} disabled={pair.stale || !!savingId} onChange={value => updateDraft(item.older.id, { outcome: value as ProjectSuggestionReviewOutcome, ...(value === 'no_longer_relevant' ? { newerSuggestionId: null } : {}) })} options={Object.entries(outcomeLabels).map(([value, label]) => ({ value, label }))} style={{ width: '100%' }} />
              <Input.TextArea aria-label={`${item.older.topic} 复核理由`} placeholder="说明为何视为同一建议、仍需跟进或已不再适用（10–1000 字）" value={draft.note} disabled={pair.stale || !!savingId} showCount maxLength={1000} rows={2} onChange={event => updateDraft(item.older.id, { note: event.target.value })} />
              {draft.outcome === 'matched' && !chosen && <Typography.Text type="danger">“对应同一建议”必须选择一条新建议。</Typography.Text>}
              {draft.outcome && noteLength > 0 && noteLength < 10 && <Typography.Text type="danger">复核理由至少需要 10 字。</Typography.Text>}
              {saveError[item.older.id] && <Alert type="error" showIcon message={saveError[item.older.id]} action={<Button size="small" onClick={() => setReloadSerial(current => current + 1)}>重新读取</Button>} />}
              <Button type="primary" size="small" disabled={pair.stale || invalid || !!unchanged || !!savingId} loading={savingId === item.older.id} onClick={() => confirmSave(item, draft)}>保存复核</Button>
            </Space>
          </Card>;
        })}
      </Space>}
    </>}
  </Card>;
}
