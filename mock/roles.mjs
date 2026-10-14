export function isAdministrator(value) {
  const role = typeof value === 'string' ? value : value?.role;
  return role === 'admin' || role === 'super_admin';
}

export function isSuperAdmin(value) {
  const role = typeof value === 'string' ? value : value?.role;
  return role === 'super_admin';
}
