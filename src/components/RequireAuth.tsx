import { Navigate, Outlet } from "react-router-dom";
import { getToken } from "../api/client";

/** 路由守卫：无 token 跳登录 */
export default function RequireAuth() {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <Outlet />;
}
