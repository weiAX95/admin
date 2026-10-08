import { http } from './client';

export interface ReviewTask { id: string; batch_id: string; experiment_title: string; batch_status: string; created_at: string }
export interface ReviewItem { run_id: string; case_key: string; output: string | null; reference_answer: string | null; input_payload: { parts: { type: string; text?: string }[] } | null; expected_payload: { parts: { type: string; text?: string }[] } | null; context_payload: unknown[]; tags: string[] }
export interface ReviewInbox { taskId: string; role: 'primary' | 'adjudicator'; rubric: { dimensions: string[]; tags: string[] }; items: ReviewItem[] }
export interface ReviewReport { taskId: string; reviewedPairs: number; overallKappa: number | null; qualityWarning: boolean; kappa: Record<string, number | null>; disputes: { runId: string; dimensions: string[]; adjudicated: boolean }[]; distribution: { score: number; count: number }[] }
export const listReviewTasks = () => http.get<{ items: ReviewTask[] }>('/evaluation/reviews');
export const listReviewableBatches = () => http.get<{ items: { id: string; title: string; dataset_version_id: string }[] }>('/evaluation/reviewable-batches');
export const createReviewTask = (batchId: string, reviewerIds: string[], tags: string[]) => http.post<{ id: string }>('/evaluation/reviews', { batchId, reviewerIds, tags });
export const getReviewInbox = (id: string) => http.get<ReviewInbox>(`/evaluation/reviews/${id}/inbox`);
export const saveReviewScore = (taskId: string, runId: string, score: { accuracy: number; completeness: number; brevity: number; safety: number; tags: string[] }) => http.post(`/evaluation/reviews/${taskId}/scores/${runId}`, score);
export const getReviewReport = (id: string) => http.get<ReviewReport>(`/evaluation/reviews/${id}/report`);
export const assignAdjudicator = (id: string, userId: string) => http.post(`/evaluation/reviews/${id}/adjudicator`, { userId });
