import { http } from './client';

export interface EvaluationCandidate { id: string; source_type: 'session' | 'experiment'; source_entity_id: string; rating: number; input_payload: string | { parts: { type: string; text?: string }[] }; expected_payload: string | { parts: { type: string; text?: string }[] }; status: string; target_dataset_id: string | null; created_at: string }
export const listEvaluationCandidates = (status = 'pending', page = 1) => http.get<{ items: EvaluationCandidate[]; page: number }>('/evaluation/candidates', { status, page: String(page) });
export const reviewEvaluationCandidate = (id: string, body: { status: 'staged' | 'rejected'; datasetId?: string; input?: unknown; expectedOutput?: unknown }) => http.post(`/evaluation/candidates/${id}/review`, body);
export const publishEvaluationCandidates = (datasetId: string) => http.post<{ versionId: string; published: number }>('/evaluation/candidates/publish', { datasetId });
