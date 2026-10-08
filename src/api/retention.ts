import { http } from './client';

export interface RetentionPolicy { version: number; auditDays: number; sessionDays: number; recycleDays: number; cleanupLocalTime: string }
export interface CleanupRun { local_date: string; completed_at: string | null; audit_deleted: number; sessions_deleted: number; candidates_deleted: number; notes_deleted: number; tasks_deleted: number; experiments_deleted: number; prompts_deleted: number }
export const getRetentionPolicy = () => http.get<RetentionPolicy>('/settings/retention');
export const saveRetentionPolicy = (value: RetentionPolicy) => http.put<RetentionPolicy>('/settings/retention', value);
export const listRetentionRuns = () => http.get<{ items: CleanupRun[] }>('/settings/retention/runs');
