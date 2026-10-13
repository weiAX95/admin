import type { Account, AccountPayload } from "../types";
import { http } from "./client";

export const listAccounts = (deleted = false) => http.get<{ items: Account[] }>(`/users${deleted ? '?deleted=true' : ''}`);
export const restoreAccount = (id: string) => http.post<Account>(`/users/${id}/restore`, {});

export const createAccount = (payload: AccountPayload) =>
  http.post<Account>("/users", payload);

export const updateAccount = (id: string, payload: AccountPayload) =>
  http.put<Account>(`/users/${id}`, payload);

export const deleteAccount = (id: string) =>
  http.del<{ deleted: boolean; id: string }>(`/users/${id}`);

export interface AccountInvitation {
  id: string; username: string; name: string | null; role: "admin" | "member";
  activationMode: "immediate" | "first_login" | "manual";
  createdAt: string; expiresAt: string; consumedAt: string | null; revokedAt: string | null;
}
export const listAccountInvitations = () => http.get<{ items: AccountInvitation[] }>("/users/invitations");
export const createAccountInvitation = (payload: { username: string; name?: string; role: "admin" | "member"; activationMode: AccountInvitation["activationMode"]; expiresInHours: number }) =>
  http.post<{ id: string; token: string; username: string; role: string; activationMode: string; expiresAt: string }>("/users/invitations", payload);
export const revokeAccountInvitation = (id: string) => http.post<{ revoked: boolean }>(`/users/invitations/${id}/revoke`, {});
export const previewAccountInvitation = (token: string) => http.post<{ username: string; name: string; role: string; activationMode: AccountInvitation["activationMode"]; expiresAt: string }>("/auth/invitations/preview", { token });
export const registerWithInvitation = (token: string, password: string, name: string) => http.post<{ username: string; status: Account["status"]; activationMode: AccountInvitation["activationMode"] }>("/auth/register", { token, password, name });
