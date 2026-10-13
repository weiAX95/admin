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
