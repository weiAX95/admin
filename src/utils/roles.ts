export type WorkspaceRole = 'member' | 'admin' | 'super_admin';

export function isAdministrator(value: { role?: string } | string | null | undefined): boolean {
  const role = typeof value === 'string' ? value : value?.role;
  return role === 'admin' || role === 'super_admin';
}

export function isSuperAdmin(value: { role?: string } | string | null | undefined): boolean {
  const role = typeof value === 'string' ? value : value?.role;
  return role === 'super_admin';
}
