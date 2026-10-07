import type { AuthUser, LoginResponse } from "../types";
import { http } from "./client";

export const login = (username: string, password: string) =>
  http.post<LoginResponse>("/auth/login", { username, password });

export const me = () => http.get<AuthUser>("/auth/me");
export const logout = () => http.post<{ loggedOut: boolean }>("/auth/logout", {});
