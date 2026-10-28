import { Alert, Button, Card, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ProjectComparedFinding, ProjectReportComparison as Comparison } from '../api/projectRepositories';
import { projectFindingBasis } from '../utils/projectEvidence';
import ProjectSuggestionReview from './ProjectSuggestionReview';

const statusLabels: Record<string, string> = { implemented: '已实现线索', partial: '部分实现线索', not_found: '模型未发现实现线索', unverified: '待验证' };
const kindLabels: Record<Comparison['changes'][number]['kind'], string> = {
  completion_signal: '新增完成线索', possible_regression: '可能退化', new_gap: '新发现缺口', improved_gap: '缺口改善线索', changed: '判断变化',
};
const reviewFieldLabels: Record<Comparison['findingReview']['sameStatusChanges'][number]['changedFields'][number], string> = {
  title: '标题文字', detail: '说明文字', evidence: '证据行或来源',
};
const unmatchedReasonLabels: Record<Comparison['findingReview']['unmatchedGroups'][number]['reason'], string> = {
  new_only: '仅新报告出现；不能据此认定新增实现',
  old_only: '仅旧报告出现；不能据此认定问题已解决',
  ambiguous_multiple: '同一需求含多条结论，无法一对一配对',
  missing_requirement_id: '缺少稳定需求 ID，两侧结论均未自动配对',
  incomparable_scope: '仓库身份、分支、目标或需求基线不同，结论不配对',
};

export default function ProjectReportComparison({ comparison, onOpenReport, onClose }: { comparison: Comparison; onOpenReport: (id: string) => void; onClose: () => void }) {
  const source = (report: Comparison['older'], finding: ProjectComparedFinding) => finding.evidence
    ? <Space direction="vertical" size={0}><a href={`https://github.com/${report.fullName}/blob/${report.commitSha}/${finding.evidence.path.split('/').map(encodeURIComponent).join('/')}#L${finding.evidence.line}`} target="_blank" rel="noopener noreferrer">{finding.evidence.path}:{finding.evidence.line}</a><Typography.Text type="secondary">{projectFindingBasis(finding)} · {finding.evidence.excerpt}</Typography.Text></Space>
    : <Typography.Text type="secondary">{projectFindingBasis(finding)}</Typography.Text>;
  const findingView = (report: Comparison['older'], finding: ProjectComparedFinding) => <Space direction="vertical" size={0}>
    <strong>{statusLabels[finding.status]} · {finding.title}</strong>
    {finding.featureKey && <Tag title="功能线索 ID；仅供人工核对，不自动配对">{finding.featureKey}</Tag>}
    <span>{finding.detail}</span>
    {source(report, finding)}
  </Space>;
  const findingList = (report: Comparison['older'], findings: ProjectComparedFinding[]) => findings.length
    ? <Space direction="vertical" size="small">{findings.map((finding, index) => <div key={`${finding.requirementId || 'unlinked'}-${index}`}><Tag>{finding.requirementId || '未关联需求'}</Tag>{findingView(report, finding)}</div>)}</Space>
    : <Typography.Text type="secondary">此侧没有对应结论</Typography.Text>;
  const reportLabel = (item: Comparison['older']) => `${new Date(item.finishedAt || item.createdAt).toLocaleString('zh-CN')} · ${item.branch} · ${item.commitSha.slice(0, 10)} · ${item.selectedFileCount}/${item.availableFileCount} 文件`;

  return <Card size="small" title="两次报告对照" extra={<Button type="text" onClick={onClose}>关闭</Button>} style={{ marginTop: 16 }}>
    <Space wrap style={{ marginBottom: 12 }}><Button type="link" onClick={() => onOpenReport(comparison.older.id)}>旧报告：{reportLabel(comparison.older)}</Button><Button type="link" onClick={() => onOpenReport(comparison.newer.id)}>新报告：{reportLabel(comparison.newer)}</Button></Space>
    {comparison.limitations.length ? <Alert type="warning" showIcon message="比较范围有限" description={`原因：${comparison.limitations.join('；')}。下方状态变化仅供逐项复核，不计算进度增长；未扫描区域不能据此判为已解决或退化。`} style={{ marginBottom: 12 }} /> : <Alert type="info" showIcon message="下方是固定需求 ID 对应结论的变化线索，不代表运行验收通过，也不作为项目完成率。" style={{ marginBottom: 12 }} />}
    <Typography.Title level={5}>需求结论变化</Typography.Title>
    {comparison.changes.length ? <Table rowKey="requirementId" size="small" pagination={false} dataSource={comparison.changes} scroll={{ x: 850 }} columns={[
      { title: '需求', dataIndex: 'requirementId', width: 125 },
      { title: '变化', render: (_, item: Comparison['changes'][number]) => <Tag color={item.kind === 'completion_signal' || item.kind === 'improved_gap' ? 'green' : item.kind === 'possible_regression' || item.kind === 'new_gap' ? 'orange' : 'default'}>{kindLabels[item.kind]}</Tag> },
      { title: '旧结论与证据', render: (_, item: Comparison['changes'][number]) => findingView(comparison.older, item.before) },
      { title: '新结论与证据', render: (_, item: Comparison['changes'][number]) => findingView(comparison.newer, item.after) },
    ]} /> : <Empty description="没有可按同一需求 ID 安全配对的状态变化" />}
    {comparison.findingReview ? <>
    <Typography.Title level={5} style={{ marginTop: 16 }}>同状态的文字与证据变化</Typography.Title>
    <Typography.Paragraph type="secondary">仅展示同一需求 ID 在两份报告中各有一条、状态相同但文字或证据不同的结论；这些变化仍需人工复核。</Typography.Paragraph>
    {comparison.findingReview.sameStatusChanges.length ? <Table rowKey="requirementId" size="small" dataSource={comparison.findingReview.sameStatusChanges} scroll={{ x: 850 }} columns={[
      { title: '需求', dataIndex: 'requirementId', width: 125 },
      { title: '变化位置', render: (_, item: Comparison['findingReview']['sameStatusChanges'][number]) => item.changedFields.map(field => <Tag key={field}>{reviewFieldLabels[field]}</Tag>) },
      { title: '旧结论与证据', render: (_, item: Comparison['findingReview']['sameStatusChanges'][number]) => findingView(comparison.older, item.before) },
      { title: '新结论与证据', render: (_, item: Comparison['findingReview']['sameStatusChanges'][number]) => findingView(comparison.newer, item.after) },
    ]} /> : <Empty description="没有同状态的文字或证据变化" />}
    <Typography.Title level={5} style={{ marginTop: 16 }}>功能线索 ID 待核对配对</Typography.Title>
    <Typography.Paragraph type="secondary">仅在同一仓库、分支和目标下展示两侧唯一匹配的线索 ID；标题或路径改变、同 ID 有多条结论时不会配对。状态变化不计入进度判断。</Typography.Paragraph>
    {comparison.findingReview.featureKeyCandidates.length ? <Table rowKey="featureKey" size="small" dataSource={comparison.findingReview.featureKeyCandidates} scroll={{ x: 850 }} columns={[
      { title: '线索 ID', dataIndex: 'featureKey', width: 190 },
      { title: '待核对变化', render: (_, item: Comparison['findingReview']['featureKeyCandidates'][number]) => <Space wrap>{item.statusChanged && <Tag color="orange">状态变化</Tag>}{item.evidenceChanged && <Tag>证据变化</Tag>}{!item.statusChanged && !item.evidenceChanged && <Tag>文字或内容待核对</Tag>}</Space> },
      { title: '旧结论', render: (_, item: Comparison['findingReview']['featureKeyCandidates'][number]) => findingView(comparison.older,item.before) },
      { title: '新结论', render: (_, item: Comparison['findingReview']['featureKeyCandidates'][number]) => findingView(comparison.newer,item.after) },
    ]} /> : <Empty description="没有可按功能线索 ID 唯一匹配的结论" />}
    <Typography.Title level={5} style={{ marginTop: 16 }}>未能安全配对的结论</Typography.Title>
    <Typography.Paragraph type="secondary">这些是原始报告结论，出现或消失不代表功能新增、问题解决或个人已掌握；部分扫描时尤其需要核对覆盖范围。</Typography.Paragraph>
    {comparison.findingReview.unmatchedGroups.length ? <Table rowKey={(item, index) => `${item.reason}:${item.requirementId || index}`} size="small" dataSource={comparison.findingReview.unmatchedGroups} scroll={{ x: 850 }} columns={[
      { title: '需求', width: 125, render: (_, item: Comparison['findingReview']['unmatchedGroups'][number]) => item.requirementId || (item.reason === 'incomparable_scope' ? '范围不可比' : '未关联') },
      { title: '待复核原因', render: (_, item: Comparison['findingReview']['unmatchedGroups'][number]) => <Tag color="orange">{unmatchedReasonLabels[item.reason]}</Tag> },
      { title: '旧报告原始结论', render: (_, item: Comparison['findingReview']['unmatchedGroups'][number]) => findingList(comparison.older, item.before) },
      { title: '新报告原始结论', render: (_, item: Comparison['findingReview']['unmatchedGroups'][number]) => findingList(comparison.newer, item.after) },
    ]} /> : <Empty description="没有未配对的结论" />}
    </> : <Alert type="info" showIcon message="请重新打开报告对照，获取完整的待复核结论" style={{ marginTop: 16 }} />}
    <Typography.Title level={5} style={{ marginTop: 16 }}>学习建议变化</Typography.Title>
    <Typography.Paragraph type="secondary">按主题和实践文字比较；措辞变化可能被识别为新增或移除，不代表建议已经完成。</Typography.Paragraph>
    <Space direction="vertical" style={{ width: '100%' }}>
      <div><strong>新建议：</strong>{comparison.suggestions.added.length ? comparison.suggestions.added.map(item => <Tag key={`${item.topic}-${item.practice}`} color="blue">{item.topic}</Tag>) : '无'}</div>
      <div><strong>不再出现：</strong>{comparison.suggestions.removed.length ? comparison.suggestions.removed.map(item => <Tag key={`${item.topic}-${item.practice}`}>{item.topic}</Tag>) : '无'}</div>
    </Space>
    {comparison.suggestionReviewEligible
      ? <ProjectSuggestionReview key={`${comparison.older.id}:${comparison.newer.id}`} repositoryId={comparison.newer.repositoryId} olderAnalysisId={comparison.older.id} newerAnalysisId={comparison.newer.id} />
      : <Alert type="info" showIcon message="逐条建议复核暂不可用" description={comparison.suggestionReviewUnavailableReason} style={{ marginTop: 16 }} />}
  </Card>;
}
