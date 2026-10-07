import { http } from './client';

export interface SharedExperiment { id: string; recordKind: 'manual'|'definition'; title: string; taskId: string | null; prompt?: string; model?: string; params?: string; result?: string; score?: number; systemPrompt?: string; userPrompt?: string; variables?: Record<string,string>; variants?: { label: string; model: string; parameters: Record<string,unknown> }[]; latestBatch?: { createdAt: string; status: string; runs: { apiModel: string; parameters: Record<string,unknown>; inputIndex: number; status: string; output: string | null; autoScore: number | null; promptTokens: number | null; completionTokens: number | null; latencyMs: number | null; costUsd: number | null }[] } | null }
export const sharePreview = (id: string) => http.get<{ experiment: SharedExperiment }>(`/experiments/${id}/share-preview`);
export const createShare = (id: string, expiry: '1h'|'24h'|'7d'|'permanent') => http.post<{ id: string; path: string; expiresAt: string | null }>(`/experiments/${id}/shares`, { expiry });
export const listShares = (id: string) => http.get<{ items: { id: string; expires_at: string | null; revoked_at: string | null; created_at: string }[] }>(`/experiments/${id}/shares`);
export const revokeShare = (id: string) => http.post(`/experiment-shares/${id}/revoke`, {});
export const getSharedExperiment = (token: string) => http.get<{ experiment: SharedExperiment; expiresAt: string | null }>(`/public/experiments/${token}`);
