import { Navigate, Outlet } from 'react-router-dom';
import { getStoredUser } from '../api/client';
import type { AuthUser } from '../types';

export default function RequireAdmin() {
  return getStoredUser<AuthUser>()?.role === 'admin' ? <Outlet /> : <Navigate to="/" replace />;
}
