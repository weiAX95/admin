import { http } from './client';

export interface AccountAuditItem {
  id: string; actorId: string | null; action: string; resource: string; resourceId: string | null;
  details: Record<string, unknown>; createdAt: string;
}
export interface AccountAuditQuery {
  actorId?: string; action?: string; resource?: string; from?: string; to?: string;
  page?: number; pageSize?: number;
}
export interface AccountAuditPage { items: AccountAuditItem[]; total: number; page: number; pageSize: number }

export const listAccountAudit = (query: AccountAuditQuery) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  return http.get<AccountAuditPage>(`/account-audit?${params}`);
};
