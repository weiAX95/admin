import type { ProjectAnalysisReport } from '../api/projectRepositories';

type Finding = ProjectAnalysisReport['findings'][number];
type EvidenceType = NonNullable<Finding['evidence']>['type'];

export function projectSourceLabel(type: EvidenceType): string {
  if (type === 'test') return '测试源码行（报告未提供执行结果）';
  if (type === 'document') return '文档行（仅为项目声明）';
  if (type === 'config') return '配置文件行（尚需核对实现）';
  return '源码行（仅静态阅读）';
}

export function projectFindingBasis(finding: Pick<Finding, 'status' | 'evidence'>): string {
  if (finding.evidence) return projectSourceLabel(finding.evidence.type);
  if (finding.status === 'not_found') return '模型在本次输入中未指出实现行；未覆盖范围及模型遗漏仍需核对';
  return '模型未提供可定位的文件行，需人工核对';
}
