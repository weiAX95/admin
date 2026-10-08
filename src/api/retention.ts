import { http } from './client';

export interface RetentionPolicy { version: number; auditDays: number; sessionDays: number; recycleDays: number; cleanupLocalTime: string }
export interface CleanupRun { local_date: string; completed_at: string | null; audit_deleted: number; sessions_deleted: number; candidates_deleted: number; notes_deleted: number; tasks_deleted: number; experiments_deleted: number; prompts_deleted: number; purge_failures: { type: string; id: string; reason: string }[] }
export interface RecycleItem { type: 'task' | 'note' | 'experiment' | 'prompt'; id: string; title: string; deletedAt: string }
export const getRetentionPolicy = () => http.get<RetentionPolicy>('/settings/retention');
export const saveRetentionPolicy = (value: RetentionPolicy) => http.put<RetentionPolicy>('/settings/retention', value);
export const listRetentionRuns = () => http.get<{ items: CleanupRun[] }>('/settings/retention/runs');
export const listRecycleBin = () => http.get<{ items: RecycleItem[] }>('/settings/recycle-bin');
export const restoreRecycleItem = (item: RecycleItem) => http.post(`/settings/recycle-bin/${item.type}/${encodeURIComponent(item.id)}/restore`, {});
export const purgeRecycleItem = (item: RecycleItem) => http.post(`/settings/recycle-bin/${item.type}/${encodeURIComponent(item.id)}/purge`, { confirmTitle: item.title });
