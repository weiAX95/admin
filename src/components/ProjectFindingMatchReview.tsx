import { useState } from 'react';
import { Alert, Button, Card, Col, Empty, Input, Popconfirm, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import { confirmProjectFindingMatch, removeProjectFindingMatch, type ProjectAnalysisJob, type ProjectComparedFinding, type ProjectReportComparison } from '../api/projectRepositories';
import { projectFindingBasis } from '../utils/projectEvidence';

const statusLabels: Record<ProjectComparedFinding['status'], string> = {
  implemented: '已实现线索', partial: '部分实现线索', not_found: '模型未发现实现线索', unverified: '待验证',
};

function evidenceLink(finding: ProjectComparedFinding, report: ProjectAnalysisJob & { fullName: string }) {
  const evidence = finding.evidence;
  if (!evidence) return <Typography.Text type="secondary">{projectFindingBasis(finding)}</Typography.Text>;
  const path = evidence.path.split('/').map(encodeURIComponent).join('/');
  return <Space direction="vertical" size={0} style={{ overflowWrap: 'anywhere' }}>
    <a href={`https://github.com/${report.fullName}/blob/${report.commitSha}/${path}#L${evidence.line}`} target="_blank" rel="noopener noreferrer">{evidence.path}:{evidence.line}</a>
    <Typography.Text type="secondary">{projectFindingBasis(finding)} · {evidence.excerpt}</Typography.Text>
  </Space>;
}

export default function ProjectFindingMatchReview({ comparison, onRefresh }: { comparison: ProjectReportComparison; onRefresh: () => Promise<void> }) {
  const [olderFindingId, setOlderFindingId] = useState<string>();
  const [newerFindingId, setNewerFindingId] = useState<string>();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const confirmed = comparison.confirmedFindingMatches || [];
  const usedOld = new Set(confirmed.map(item => item.before.id));
  const usedNew = new Set(confirmed.map(item => item.after.id));
  const candidates = comparison.findingMatchCandidates;
  const oldSelection = candidates.older.find(item => item.id === olderFindingId);
  const newSelection = candidates.newer.find(item => item.id === newerFindingId);
  const option = (finding: NonNullable<typeof candidates>['older'][number]) => ({
    value: finding.id,
    label: `${finding.title} · ${finding.evidence?.path || '无文件证据'}`.slice(0, 150),
  });
  const save = async () => {
    if (!olderFindingId || !newerFindingId || saving) return;
    setSaving(true);
    try {
      await confirmProjectFindingMatch(comparison.older.repositoryId, comparison.older.id, comparison.newer.id, { olderFindingId, newerFindingId, reason: reason.trim() });
      await onRefresh();
      setOlderFindingId(undefined); setNewerFindingId(undefined); setReason('');
      message.success('已记录人工对应关系');
    } catch (error) { message.error(error instanceof Error ? error.message : '确认失败'); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    setSaving(true);
    try {
      await removeProjectFindingMatch(comparison.older.repositoryId, comparison.older.id, comparison.newer.id, id);
      await onRefresh();
      message.success('已撤销对应关系');
    } catch (error) { message.error(error instanceof Error ? error.message : '撤销失败'); }
    finally { setSaving(false); }
  };
  const brief = (finding: ProjectComparedFinding, report: ProjectAnalysisJob & { fullName: string }) => <Space direction="vertical" size={0}>
    <strong>{finding.title}</strong><Tag>{statusLabels[finding.status]}</Tag>
    {evidenceLink(finding, report)}
  </Space>;
  const preview = (label: string, finding: ProjectComparedFinding, report: ProjectAnalysisJob & { fullName: string }) => <Card size="small" title={`${label} · ${report.commitSha.slice(0, 10)}`} style={{ height: '100%' }}>
    <Space direction="vertical" size="small" style={{ width: '100%', overflowWrap: 'anywhere' }}>
      <div><Tag>{statusLabels[finding.status]}</Tag><strong>{finding.title}</strong></div>
      <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{finding.detail}</Typography.Paragraph>
      {evidenceLink(finding, report)}
    </Space>
  </Card>;

  return <section aria-label="人工确认功能线索对应关系">
    <Typography.Title level={5} style={{ marginTop: 16 }}>人工确认的功能对应关系</Typography.Title>
    <Typography.Paragraph type="secondary">标题或文件路径变化时，可选择两份报告中未关联需求的结论，确认它们指向同一功能。此记录不改写模型结论，也不用于自动进度通知。</Typography.Paragraph>
    {comparison.findingMatchEligible ? <>
      <Space wrap style={{ width: '100%', marginBottom: 8 }}>
        <Select aria-label="选择旧报告结论" showSearch optionFilterProp="label" placeholder="旧报告结论" style={{ minWidth: 260, maxWidth: 400 }} value={olderFindingId} onChange={setOlderFindingId} options={candidates.older.filter(item => !usedOld.has(item.id)).map(option)} />
        <Select aria-label="选择新报告结论" showSearch optionFilterProp="label" placeholder="新报告结论" style={{ minWidth: 260, maxWidth: 400 }} value={newerFindingId} onChange={setNewerFindingId} options={candidates.newer.filter(item => !usedNew.has(item.id)).map(option)} />
      </Space>
      {(oldSelection || newSelection) && <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} lg={12}>{oldSelection ? preview('旧报告结论', oldSelection, comparison.older) : <Alert type="info" message="请选择旧报告结论" />}</Col>
        <Col xs={24} lg={12}>{newSelection ? preview('新报告结论', newSelection, comparison.newer) : <Alert type="info" message="请选择新报告结论" />}</Col>
      </Row>}
      <Input.TextArea aria-label="对应关系确认理由" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} showCount rows={2} placeholder="说明两条结论为何指向同一功能（10–500 字）" style={{ marginBottom: 8 }} />
      <Popconfirm title="确认这两条结论指向同一功能？" description="请核对上方两侧原始说明与固定 commit 证据；此操作不改变报告和自动通知。" onConfirm={() => void save()} disabled={!olderFindingId || !newerFindingId || reason.trim().length < 10 || saving}>
        <Button loading={saving} disabled={!olderFindingId || !newerFindingId || reason.trim().length < 10}>确认对应</Button>
      </Popconfirm>
    </> : <Alert type="info" showIcon message="人工对应暂不可用" description="两份报告必须来自同一可信 GitHub 仓库、分支与目标，且各自提交与扫描记录一致。" style={{ marginBottom: 12 }} />}
    {confirmed.length ? <Table size="small" rowKey="id" scroll={{ x: 850 }} dataSource={confirmed} columns={[
      { title: '旧结论', render: (_, item: typeof confirmed[number]) => brief(item.before, comparison.older) },
      { title: '新结论', render: (_, item: typeof confirmed[number]) => brief(item.after, comparison.newer) },
      { title: '确认依据', render: (_, item: typeof confirmed[number]) => <Space direction="vertical" size={0}><span>{item.reason}</span><Typography.Text type="secondary">{item.reviewer} · {new Date(item.createdAt).toLocaleString('zh-CN')}</Typography.Text></Space> },
      { title: '操作', render: (_, item: typeof confirmed[number]) => <Popconfirm title="撤销这条人工对应关系？" onConfirm={() => void remove(item.id)}><Button type="link" danger disabled={saving}>撤销</Button></Popconfirm> },
    ]} /> : <Empty description="尚无人工确认的功能对应关系" />}
  </section>;
}
