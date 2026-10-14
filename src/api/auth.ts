import type { AuthUser, LoginResponse } from "../types";
import { http } from "./client";

export const login = (username: string, password: string, fingerprint?: string) =>
  http.post<LoginResponse | { mfaRequired: true; challengeToken: string; expiresInSeconds: number }>("/auth/login", { username, password, deviceFingerprint: fingerprint });
export interface MfaStatus { enabled: boolean; required: boolean; recoveryCodesRemaining: number }
export const mfaStatus = () => http.get<MfaStatus>('/auth/mfa');
export const beginMfaSetup = (currentPassword: string) => http.post<{ secret: string; uri: string }>('/auth/mfa/setup', { currentPassword });
export const confirmMfaSetup = (code: string) => http.post<{ enabled: true; recoveryCodes: string[] }>('/auth/mfa/confirm', { code });
export const disableMfa = (currentPassword: string, code: string) => http.post<{ enabled: false }>('/auth/mfa/disable', { currentPassword, code });
export const verifyMfaLogin = (challengeToken: string, code: string, deviceFingerprint?: string) =>
  http.post<LoginResponse>('/auth/mfa/verify', { challengeToken, code, deviceFingerprint });
export interface LoginHistoryItem { id: string; ipAddress: string; userAgent: string; succeeded: boolean; reason: string; createdAt: string }
export const loginHistory = () => http.get<{ items: LoginHistoryItem[] }>("/auth/login-history");
export const changePassword = (currentPassword: string, newPassword: string) =>
  http.post<LoginResponse>("/auth/password", { currentPassword, newPassword });

export const me = () => http.get<AuthUser>("/auth/me");
export const logout = () => http.post<{ loggedOut: boolean }>("/auth/logout", {});
