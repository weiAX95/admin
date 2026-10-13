import { http } from './client';

export type WebhookEvent = 'task.completed' | 'experiment.finished' | 'evaluation.completed' | 'alert.firing' | 'note.updated';
export interface WebhookConfig {
  id: string;
  event: WebhookEvent;
  url: string;
  secretMask: string;
  hasHeaders: boolean;
  enabled: boolean;
  deletedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface WebhookAttempt {
  attempt_number: number;
  attempted_at: string;
  status_code: number | null;
  response_body: string | null;
  error: string | null;
}
export interface WebhookDelivery {
  id: string;
  status: 'pending' | 'sending' | 'delivered' | 'failed' | 'cancelled';
  attempt_count: number;
  created_at: string;
  next_attempt_at: string;
  delivered_at: string | null;
  last_error: string | null;
  event_id: string;
  event_type: WebhookEvent;
  payload: Record<string, unknown>;
  event_at: string;
  attempts: WebhookAttempt[];
}
export interface WebhookInput {
  event: WebhookEvent;
  url: string;
  secret?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  confirmExternalFields: true;
  version?: number;
}
export const listWebhooks = () => http.get<{ items: WebhookConfig[] }>('/settings/webhooks');
export const createWebhook = (data: WebhookInput) => http.post<WebhookConfig>('/settings/webhooks', data);
export const updateWebhook = (id: string, data: WebhookInput) => http.put<WebhookConfig>(`/settings/webhooks/${id}`, data);
export const deleteWebhook = (id: string, version: number) => http.del<{ deleted: true }>(`/settings/webhooks/${id}`, { version });
export const listWebhookDeliveries = (id: string) => http.get<{ items: WebhookDelivery[] }>(`/settings/webhooks/${id}/deliveries`);
export const testWebhookDelivery = (id: string) => http.post<{ deliveryId: string; status: 'pending' }>(`/settings/webhooks/${id}/test`, { confirmExternalFields: true });
