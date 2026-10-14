// This catalogue covers the routes that consume permissionScope below. Add a
// resource here only when its API checks the same policy, so the matrix stays
// an account of enforced access rather than a wish list.
export const PERMISSION_ROLES = [
  { id: 'super_admin', label: '超级管理员' },
  { id: 'admin', label: '管理员' },
  { id: 'member', label: '普通成员' },
];

export const PERMISSION_OPERATIONS = [
  { id: 'read', label: '查看' },
  { id: 'create', label: '创建' },
  { id: 'update', label: '修改' },
  { id: 'delete', label: '删除' },
  { id: 'manage', label: '管理' },
];

export const PERMISSION_SCOPES = {
  none: '无权限',
  all: '全部',
  visible: '有权访问的任务',
  personal: '预置与个人模板',
  own: '仅本人创建',
  non_super_admin: '除 SuperAdmin 外',
  protected: '其他账号及本人非受保护字段',
};

const admins = { super_admin: 'all', admin: 'all', member: 'none' };
const nobody = { super_admin: 'none', admin: 'none', member: 'none' };
export const PERMISSION_RESOURCES = [
  { id: 'tasks', label: '学习任务', description: '普通成员只读取有权访问的任务；管理员写入所有任务。', access: {
    read: { super_admin: 'all', admin: 'all', member: 'visible' }, create: admins, update: admins, delete: admins, manage: admins,
  } },
  { id: 'task_templates', label: '任务模板', description: '预置模板与个人模板可读；目前仅提供创建自定义模板接口。', access: {
    read: { super_admin: 'personal', admin: 'personal', member: 'personal' }, create: admins, update: nobody, delete: nobody, manage: nobody,
  } },
  { id: 'recurring_series', label: '重复序列', description: '普通成员可查看自己已有的重复序列；仅管理员可调整后续生成。', access: {
    read: { super_admin: 'all', admin: 'all', member: 'own' }, create: admins, update: admins, delete: nobody, manage: admins,
  } },
  { id: 'notes', label: '学习笔记', description: '普通成员可读全部笔记、创建个人笔记，只能修改或删除自己的笔记；旧笔记无归属，只有管理员可改。', access: {
    read: { super_admin: 'all', admin: 'all', member: 'all' }, create: { super_admin: 'all', admin: 'all', member: 'own' },
    update: { super_admin: 'all', admin: 'all', member: 'own' }, delete: { super_admin: 'all', admin: 'all', member: 'own' }, manage: admins,
  } },
  { id: 'note_categories', label: '笔记分类', description: '分类为全局目录，普通成员只读。', access: {
    read: { super_admin: 'all', admin: 'all', member: 'all' }, create: admins, update: admins, delete: admins, manage: admins,
  } },
  { id: 'accounts', label: '账号', description: '管理员不能修改 SuperAdmin；正式 SuperAdmin 全局唯一且不能停用、降级或删除。', access: {
    read: admins, create: admins, update: { super_admin: 'protected', admin: 'non_super_admin', member: 'none' },
    delete: { super_admin: 'non_super_admin', admin: 'non_super_admin', member: 'none' },
    manage: { super_admin: 'all', admin: 'non_super_admin', member: 'none' },
  } },
];

const byResource = new Map(PERMISSION_RESOURCES.map(resource => [resource.id, resource]));

export function permissionScope(role, resource, operation) {
  return byResource.get(resource)?.access?.[operation]?.[role] || 'none';
}

export function canAccess(user, resource, operation, { ownerId, targetRole } = {}) {
  const scope = permissionScope(user?.role, resource, operation);
  if (scope === 'none') return false;
  if (scope === 'own') return operation === 'create' || Boolean(ownerId && ownerId === user?.id);
  if (scope === 'non_super_admin') return targetRole !== 'super_admin';
  if (scope === 'protected') return targetRole !== 'super_admin' || ownerId === user?.id;
  // "visible" and "personal" are further narrowed by the existing task or
  // template query filters. A role check alone must never bypass those filters.
  return true;
}

export function permissionMatrix() {
  return {
    roles: PERMISSION_ROLES,
    operations: PERMISSION_OPERATIONS,
    scopes: PERMISSION_SCOPES,
    resources: PERMISSION_RESOURCES.map(({ id, label, description }) => ({ id, label, description })),
    cells: Object.fromEntries(PERMISSION_ROLES.map(role => [role.id,
      Object.fromEntries(PERMISSION_RESOURCES.map(resource => [resource.id,
        Object.fromEntries(PERMISSION_OPERATIONS.map(operation => [operation.id, permissionScope(role.id, resource.id, operation.id)]))]))])),
  };
}
