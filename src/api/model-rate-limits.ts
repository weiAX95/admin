import { http } from './client';

export interface ModelRateLimit { modelId: string; modelName: string; rpm: number; tpm: number }
export interface ModelRateStatus extends ModelRateLimit { usedRequests: number; usedTokens: number; remainingRequests: number; remainingTokens: number }
export const listModelRateLimits = () => http.get<{ items: ModelRateLimit[] }>('/model-rate-limits');
export const getModelRateStatus = () => http.get<{ windowStart: string; retryAfterSeconds: number; items: ModelRateStatus[] }>('/model-rate-status');
export const saveModelRateLimit = (value: Pick<ModelRateLimit, 'modelId' | 'rpm' | 'tpm'>) => http.put('/model-rate-limits', value);
export const deleteModelRateLimit = (modelId: string) => http.del('/model-rate-limits', { modelId });
