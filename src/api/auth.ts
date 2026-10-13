import type { AuthUser, LoginResponse } from "../types";
import { http } from "./client";

export const login = (username: string, password: string, fingerprint?: string) =>
  http.post<LoginResponse>("/auth/login", { username, password, deviceFingerprint: fingerprint });
export interface LoginHistoryItem { id: string; ipAddress: string; userAgent: string; succeeded: boolean; reason: string; createdAt: string }
export const loginHistory = () => http.get<{ items: LoginHistoryItem[] }>("/auth/login-history");
export const changePassword = (currentPassword: string, newPassword: string) =>
  http.post<LoginResponse>("/auth/password", { currentPassword, newPassword });

export const me = () => http.get<AuthUser>("/auth/me");
export const logout = () => http.post<{ loggedOut: boolean }>("/auth/logout", {});
