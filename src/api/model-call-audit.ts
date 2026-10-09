import { http } from './client';

export interface ModelCallAuditItem { requestId: string; runId: string; phase: 'main' | 'judge'; attempt: number; userId: string | null; userName: string; modelId: string; modelName: string; module: 'experiments' | 'evaluations'; provider: string; promptPreview: string; promptTokens: number | null; completionTokens: number | null; latencyMs: number; statusCode: number; succeeded: boolean; errorCode: string | null; createdAt: string }
export const listModelCallAudit = (params: { start?: string; end?: string; modelId?: string; userId?: string; module?: string; page: number }) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value !== undefined).map(([key, value]) => [key, String(value)]));
  return http.get<{ total: number; page: number; pageSize: number; items: ModelCallAuditItem[] }>(`/model-call-audit?${query}`);
};
