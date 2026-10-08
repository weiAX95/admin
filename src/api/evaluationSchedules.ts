import { http } from './client';

export interface EvaluationSchedule { id: string; title: string; experiment_id: string; variant_id: string; dataset_version_id: string; metric_version_id: string; time_zone: string; frequency: 'daily' | 'weekly'; local_time: string; weekday: number | null; active: boolean; next_run_at: string }
export const listEvaluationSchedules = () => http.get<{ items: EvaluationSchedule[] }>('/evaluation/schedules');
export const createEvaluationSchedule = (body: { experimentId: string; variantId: string; datasetVersionId: string; metricVersionId: string; frequency: 'daily' | 'weekly'; localTime: string; weekday?: number }) => http.post<{ id: string }>('/evaluation/schedules', body);
export const setEvaluationScheduleActive = (id: string, active: boolean) => http.patch(`/evaluation/schedules/${id}`, { active });
export const deleteEvaluationSchedule = (id: string) => http.del(`/evaluation/schedules/${id}`);
export const runEvaluationScheduleNow = (id: string) => http.post<{ batchId: string }>(`/evaluation/schedules/${id}/run-now`, {});
