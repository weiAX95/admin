import { http } from './client';

export interface EvaluationCandidate { id: string; source_type: 'session' | 'experiment'; source_entity_id: string; rating: number; input_payload: string | { parts: { type: string; text?: string }[] }; expected_payload: string | { parts: { type: string; text?: string }[] }; status: string; target_dataset_id: string | null; created_at: string }
export type CandidateSource = 'all' | 'session' | 'experiment';
export interface QaSummary { pending: number; accepted: number; rejected: number; reviewed: number; approvalRate: number | null }
export const listEvaluationCandidates = (status = 'pending', page = 1, source: CandidateSource = 'all') => http.get<{ items: EvaluationCandidate[]; page: number }>('/evaluation/candidates', { status, page: String(page), source });
export const getQaSummary = () => http.get<QaSummary>('/evaluation/candidates/qa-summary');
export const exportQaPairs = () => http.get<{ filename: string; content: string; count: number }>('/evaluation/candidates/qa-export');
export const reviewEvaluationCandidate = (id: string, body: { status: 'staged' | 'rejected'; datasetId?: string; input?: unknown; expectedOutput?: unknown }) => http.post(`/evaluation/candidates/${id}/review`, body);
export const publishEvaluationCandidates = (datasetId: string) => http.post<{ versionId: string; published: number }>('/evaluation/candidates/publish', { datasetId });
