import { Navigate, Outlet } from "react-router-dom";
import { getStoredUser, getToken } from "../api/client";
import type { AuthUser } from "../types";

/** 路由守卫：无 token 跳登录 */
export default function RequireAuth() {
  if (!getToken()) return <Navigate to="/login" replace />;
  if (getStoredUser<AuthUser>()?.passwordChangeRequired && window.location.pathname !== "/change-password") return <Navigate to="/change-password" replace />;
  if (getStoredUser<AuthUser>()?.mfaSetupRequired && window.location.pathname !== '/mfa/setup') return <Navigate to="/mfa/setup" replace />;
  return <Outlet />;
}
