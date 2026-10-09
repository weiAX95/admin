import { http } from './client';

export interface ModelSecurityPolicy {
  modelId: string;
  inputPii: boolean;
  inputJailbreak: boolean;
  outputPii: boolean;
  sensitiveWords: string[];
  brandTerms: string[];
  version: number;
}
export const getModelSecurityPolicy = (modelId: string) => http.get<ModelSecurityPolicy>(`/model-security/${encodeURIComponent(modelId)}`);
export const saveModelSecurityPolicy = (policy: ModelSecurityPolicy) => http.put<ModelSecurityPolicy>(`/model-security/${encodeURIComponent(policy.modelId)}`, policy);
export interface ModelSecurityEvent { id: string; modelId: string; modelName: string; runId: string | null; phase: string; direction: 'input' | 'output'; rule: string; action: 'blocked' | 'replaced'; createdAt: string }
export const listModelSecurityEvents = () => http.get<{ items: ModelSecurityEvent[] }>('/model-security-events');
