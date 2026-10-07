import { http } from './client';
export interface ExperimentSchedule { id: string; experimentId: string; title: string; ownerId: string; timeZone: string; frequency: 'daily'|'weekly'|'monthly'; localTime: string; weekday: number | null; dayOfMonth: number | null; variables: Record<string,string>; retryLimit: number; active: boolean; failureStreak: number; nextRunAt: string }
export const getAccountTimeZone = () => http.get<{ timeZone: string }>('/account/time-zone');
export const saveAccountTimeZone = (timeZone: string) => http.put<{ timeZone: string }>('/account/time-zone', { timeZone });
export const listExperimentSchedules = () => http.get<{ items: ExperimentSchedule[] }>('/experiment-schedules');
export const createExperimentSchedule = (payload: { experimentId: string; frequency: string; localTime: string; weekday?: number; dayOfMonth?: number; variables: Record<string,string>; retryLimit: number }) => http.post<{ id: string; nextRunAt: string }>('/experiment-schedules', payload);
export const setExperimentScheduleActive = (id: string, active: boolean) => http.patch(`/experiment-schedules/${id}`, { active });
export const deleteExperimentSchedule = (id: string) => http.del(`/experiment-schedules/${id}`);
