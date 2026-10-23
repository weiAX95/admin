import { Alert, Button, Card, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ProjectReportComparison as Comparison } from '../api/projectRepositories';
import { projectFindingBasis } from '../utils/projectEvidence';
import ProjectSuggestionReview from './ProjectSuggestionReview';

const statusLabels: Record<string, string> = { implemented: '已实现线索', partial: '部分实现线索', not_found: '模型未发现实现线索', unverified: '待验证' };
const kindLabels: Record<Comparison['changes'][number]['kind'], string> = {
  completion_signal: '新增完成线索', possible_regression: '可能退化', new_gap: '新发现缺口', improved_gap: '缺口改善线索', changed: '判断变化',
};

export default function ProjectReportComparison({ comparison, onOpenReport, onClose }: { comparison: Comparison; onOpenReport: (id: string) => void; onClose: () => void }) {
  const source = (report: Comparison['older'], finding: Comparison['changes'][number]['before']) => finding.evidence
    ? <Space direction="vertical" size={0}><a href={`https://github.com/${report.fullName}/blob/${report.commitSha}/${finding.evidence.path.split('/').map(encodeURIComponent).join('/')}#L${finding.evidence.line}`} target="_blank" rel="noopener noreferrer">{finding.evidence.path}:{finding.evidence.line}</a><Typography.Text type="secondary">{projectFindingBasis(finding)} · {finding.evidence.excerpt}</Typography.Text></Space>
    : <Typography.Text type="secondary">{projectFindingBasis(finding)}</Typography.Text>;
  const reportLabel = (item: Comparison['older']) => `${new Date(item.finishedAt || item.createdAt).toLocaleString('zh-CN')} · ${item.branch} · ${item.commitSha.slice(0, 10)} · ${item.selectedFileCount}/${item.availableFileCount} 文件`;

  return <Card size="small" title="两次报告对照" extra={<Button type="text" onClick={onClose}>关闭</Button>} style={{ marginTop: 16 }}>
    <Space wrap style={{ marginBottom: 12 }}><Button type="link" onClick={() => onOpenReport(comparison.older.id)}>旧报告：{reportLabel(comparison.older)}</Button><Button type="link" onClick={() => onOpenReport(comparison.newer.id)}>新报告：{reportLabel(comparison.newer)}</Button></Space>
    {comparison.limitations.length ? <Alert type="warning" showIcon message="比较范围有限" description={`原因：${comparison.limitations.join('；')}。下方状态变化仅供逐项复核，不计算进度增长；未扫描区域不能据此判为已解决或退化。`} style={{ marginBottom: 12 }} /> : <Alert type="info" showIcon message="下方是固定需求 ID 对应结论的变化线索，不代表运行验收通过，也不作为项目完成率。" style={{ marginBottom: 12 }} />}
    <Typography.Title level={5}>需求结论变化</Typography.Title>
    {comparison.changes.length ? <Table rowKey="requirementId" size="small" pagination={false} dataSource={comparison.changes} scroll={{ x: 850 }} columns={[
      { title: '需求', dataIndex: 'requirementId', width: 125 },
      { title: '变化', render: (_, item: Comparison['changes'][number]) => <Tag color={item.kind === 'completion_signal' || item.kind === 'improved_gap' ? 'green' : item.kind === 'possible_regression' || item.kind === 'new_gap' ? 'orange' : 'default'}>{kindLabels[item.kind]}</Tag> },
      { title: '旧结论与证据', render: (_, item: Comparison['changes'][number]) => <Space direction="vertical"><strong>{statusLabels[item.before.status]} · {item.before.title}</strong><span>{item.before.detail}</span>{source(comparison.older,item.before)}</Space> },
      { title: '新结论与证据', render: (_, item: Comparison['changes'][number]) => <Space direction="vertical"><strong>{statusLabels[item.after.status]} · {item.after.title}</strong><span>{item.after.detail}</span>{source(comparison.newer,item.after)}</Space> },
    ]} /> : <Empty description="没有可按同一需求 ID 安全配对的状态变化" />}
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
