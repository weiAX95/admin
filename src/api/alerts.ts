import { http } from './client';

export interface AlertRule {
  id: string; name: string; template_key: string | null; metric: string;
  scope_type: 'global' | 'model'; scope_id: string;
  operator: '>' | '<' | '=' | '>=' | '<='; threshold: number;
  duration_seconds: number; level: 'info' | 'warning' | 'critical';
  channels: string[]; enabled: boolean; version: number; updated_at: string;
}
export interface AlertIncident {
  id: string; rule_id: string | null; rule_name: string; metric: string;
  scope_id: string; level: AlertRule['level'];
  status: 'firing' | 'acknowledged' | 'resolved'; trigger_value: number;
  trigger_count: number; opened_at: string; acknowledged_at: string | null;
  resolved_at: string | null;
}
export interface AlertMetricSample {
  metric: string; scope_type: string; scope_id: string;
  sampled_at: string; value: number; source_count: number;
}
export interface AlertRuleInput {
  name: string; metric: string; scopeId: string; operator: AlertRule['operator'];
  threshold: number; durationSeconds: number; level: AlertRule['level'];
  channels: string[]; enabled: boolean;
}

export const listAlertRules = () => http.get<{ items: AlertRule[] }>('/alerts/rules');
export const createAlertRule = (input: AlertRuleInput) => http.post<{ item: AlertRule }>('/alerts/rules', input);
export const updateAlertRule = (id: string, version: number, input: Partial<AlertRuleInput>) => http.put<{ item: AlertRule }>(`/alerts/rules/${id}`, { version, ...input });
export const deleteAlertRule = (id: string, version: number) => http.del(`/alerts/rules/${id}`, { version });
export const listAlertIncidents = (status?: string, level?: string) => http.get<{ items: AlertIncident[] }>('/alerts/incidents', { status, level });
export const acknowledgeAlertIncident = (id: string) => http.post<{ item: AlertIncident }>(`/alerts/incidents/${id}/ack`, {});
export const listAlertMetricSamples = (metric?: string, scopeId = '*') => http.get<{ items: AlertMetricSample[] }>('/alerts/metrics', { metric, scopeId });
