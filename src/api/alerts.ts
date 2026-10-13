import { http } from './client';

export interface AlertRule {
  id: string; name: string; template_key: string | null; metric: string;
  scope_type: 'global' | 'model'; scope_id: string;
  operator: '>' | '<' | '=' | '>=' | '<='; threshold: number;
  duration_seconds: number; repeat_minutes: number; level: 'info' | 'warning' | 'critical';
  channels: string[]; tags: string[]; enabled: boolean; version: number; updated_at: string;
}
export interface AlertIncident {
  id: string; rule_id: string | null; rule_name: string; metric: string;
  scope_id: string; level: AlertRule['level'];
  status: 'firing' | 'acknowledged' | 'resolved'; trigger_value: number;
  trigger_count: number; opened_at: string; acknowledged_at: string | null;
  resolved_at: string | null; escalated_at: string | null; assigned_to: string | null;
}
export interface AlertIncidentEvent {
  id: string; incident_id: string; actor_id: string | null; actor_name: string | null;
  event_type: 'opened' | 'escalated' | 'acknowledged' | 'assigned' | 'note' | 'resolved' | 'reminded';
  detail: string | null; occurred_at: string;
}
export interface AlertAssignee { id: string; name: string; username: string; status: string }
export interface AlertMetricSample {
  metric: string; scope_type: string; scope_id: string;
  sampled_at: string; value: number; source_count: number;
}
export interface AlertRuleInput {
  name: string; metric: string; scopeId: string; operator: AlertRule['operator'];
  threshold: number; durationSeconds: number; repeatMinutes: number; level: AlertRule['level'];
  channels: string[]; tags: string[]; enabled: boolean;
}

export interface AlertSilence {
  id: string; name: string; scope_type: 'all' | 'module' | 'tag'; scope_value: string | null;
  timezone: string; start_minute: number; end_minute: number; enabled: boolean; version: number;
}
export interface AlertSilenceInput {
  name: string; scopeType: AlertSilence['scope_type']; scopeValue: string | null;
  timezone: string; startMinute: number; endMinute: number; enabled: boolean;
}
export const listAlertSilences = () => http.get<{ items: AlertSilence[] }>('/alerts/silences');
export const createAlertSilence = (input: AlertSilenceInput) => http.post<{ item: AlertSilence }>('/alerts/silences', input);
export const updateAlertSilence = (id: string, version: number, input: AlertSilenceInput) => http.put<{ item: AlertSilence }>(`/alerts/silences/${id}`, { version, ...input });
export const deleteAlertSilence = (id: string, version: number) => http.del(`/alerts/silences/${id}`, { version });

export const listAlertRules = () => http.get<{ items: AlertRule[] }>('/alerts/rules');
export const createAlertRule = (input: AlertRuleInput) => http.post<{ item: AlertRule }>('/alerts/rules', input);
export const updateAlertRule = (id: string, version: number, input: Partial<AlertRuleInput>) => http.put<{ item: AlertRule }>(`/alerts/rules/${id}`, { version, ...input });
export const deleteAlertRule = (id: string, version: number) => http.del(`/alerts/rules/${id}`, { version });
export interface AlertIncidentQuery { status?: string; level?: string; from?: string; to?: string; limit?: number; offset?: number }
export const listAlertIncidents = (query: AlertIncidentQuery = {}) => http.get<{ items: AlertIncident[]; total: number }>('/alerts/incidents', {
  status: query.status, level: query.level, from: query.from, to: query.to,
  limit: query.limit?.toString(), offset: query.offset?.toString(),
});
export interface AlertAnalytics {
  totals: { total: number; mtta_minutes: string | null; mttr_minutes: string | null };
  daily: { day: string; info: number; warning: number; critical: number }[];
  byModule: { name: string; count: number }[]; byType: { name: string; count: number }[];
  byLevel: { level: string; total: number; mtta_minutes: string | null; mttr_minutes: string | null }[];
}
export const getAlertAnalytics = (days: 7 | 30 | 90, level?: string) => http.get<AlertAnalytics>('/alerts/incidents/analytics', { days: String(days), level });
export const acknowledgeAlertIncident = (id: string) => http.post<{ item: AlertIncident }>(`/alerts/incidents/${id}/ack`, {});
export const listAlertAssignees = () => http.get<{ items: AlertAssignee[] }>('/users');
export const listAlertIncidentEvents = (id: string) => http.get<{ items: AlertIncidentEvent[] }>(`/alerts/incidents/${id}/events`);
export const assignAlertIncident = (id: string, userId: string) => http.post<{ item: AlertIncident }>(`/alerts/incidents/${id}/assign`, { userId });
export const addAlertIncidentNote = (id: string, note: string) => http.post(`/alerts/incidents/${id}/notes`, { note });
export const resolveAlertIncident = (id: string, note: string) => http.post<{ item: AlertIncident }>(`/alerts/incidents/${id}/resolve`, { note });
export const listAlertMetricSamples = (metric?: string, scopeId = '*') => http.get<{ items: AlertMetricSample[] }>('/alerts/metrics', { metric, scopeId });
export interface AlertRulePreview { triggers: number; firstTriggerAt: string | null; sampleCount: number; firstSampleAt: string | null; lastSampleAt: string | null; historyComplete: boolean; byDay: { day: string; count: number }[] }
export const previewAlertRule = (input: AlertRuleInput) => http.post<AlertRulePreview>('/alerts/rules/preview', input);

export interface AlertRuleArchive { schemaVersion: 1; rules: (AlertRuleInput & { templateKey: string | null })[] }
export interface AlertImportRow { index: number; name: string; status: 'create' | 'update' | 'skip' | 'error'; error: string | null; targetId: string | null; version: number | null }
export const previewAlertRuleImport = (archive: AlertRuleArchive, mode: 'skip' | 'replace') => http.post<{ rows: AlertImportRow[] }>('/alerts/rules/import/preview', { ...archive, mode });
export const importAlertRules = (archive: AlertRuleArchive, mode: 'skip' | 'replace', expected: AlertImportRow[]) => http.post<{ created: number; updated: number; skipped: number }>('/alerts/rules/import', { ...archive, mode, expected });
