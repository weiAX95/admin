import { isAdministrator } from '../utils/roles';
import { Navigate, Outlet } from 'react-router-dom';
import { getStoredUser } from '../api/client';
import type { AuthUser } from '../types';

export default function RequireAdmin() {
  return isAdministrator(getStoredUser<AuthUser>()) ? <Outlet /> : <Navigate to="/" replace />;
}
