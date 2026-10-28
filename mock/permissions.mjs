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
  allowed_models: '仅可使用的模型',
  personal: '预置与个人模板',
  own: '仅本人资源',
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
  { id: 'experiments', label: '实验记录', description: '所有登录账号可查看并创建个人实验；成员只能修改、删除或执行自己的实验，旧记录无归属时仅管理员可管理。', access: {
    read: { super_admin: 'all', admin: 'all', member: 'all' }, create: { super_admin: 'all', admin: 'all', member: 'own' },
    update: { super_admin: 'all', admin: 'all', member: 'own' }, delete: { super_admin: 'all', admin: 'all', member: 'own' },
    manage: { super_admin: 'all', admin: 'all', member: 'own' },
  } },
  { id: 'prompts', label: '提示词条目', description: '所有登录账号可读并创建个人提示词；作者和管理员可修改及删除条目。导入不得追加到其他作者的条目。', access: {
    read: { super_admin: 'all', admin: 'all', member: 'all' }, create: { super_admin: 'all', admin: 'all', member: 'own' },
    update: { super_admin: 'all', admin: 'all', member: 'own' }, delete: { super_admin: 'all', admin: 'all', member: 'own' }, manage: nobody,
  } },
  { id: 'prompt_folders', label: '提示词文件夹', description: '所有登录账号可浏览文件夹；只有管理员可创建、重命名或删除。', access: {
    read: { super_admin: 'all', admin: 'all', member: 'all' }, create: admins, update: admins, delete: admins, manage: nobody,
  } },
  { id: 'prompt_compliance', label: '提示词合规规则', description: '合规规则由管理员读取、创建与删除；保存提示词时的内容扫描对所有作者生效。', access: {
    read: admins, create: admins, update: nobody, delete: admins, manage: nobody,
  } },
  { id: 'note_categories', label: '笔记分类', description: '分类为全局目录，普通成员只读。', access: {
    read: { super_admin: 'all', admin: 'all', member: 'all' }, create: admins, update: admins, delete: admins, manage: admins,
  } },
  { id: 'accounts', label: '账号', description: '管理员不能修改 SuperAdmin；正式 SuperAdmin 全局唯一且不能停用、降级或删除。', access: {
    read: admins, create: admins, update: { super_admin: 'protected', admin: 'non_super_admin', member: 'none' },
    delete: { super_admin: 'non_super_admin', admin: 'non_super_admin', member: 'none' },
    manage: { super_admin: 'all', admin: 'non_super_admin', member: 'none' },
  } },
  { id: 'account_audit', label: '操作审计', description: '成员只能读取自己的历史；审计记录不可通过业务接口改写或删除。', access: {
    read: { super_admin: 'all', admin: 'all', member: 'own' }, create: nobody, update: nobody, delete: nobody, manage: nobody,
  } },
  { id: 'account_activity', label: '账号活跃度', description: '所有账号可记录自己的页面访问；仅管理员可查看团队活跃度。', access: {
    read: admins, create: { super_admin: 'own', admin: 'own', member: 'own' }, update: nobody, delete: nobody, manage: nobody,
  } },
  { id: 'model_call_audit', label: '模型调用审计', description: '管理员可查询脱敏后的模型调用事实；调用记录由服务自动写入，不提供手工增删接口。', access: {
    read: admins, create: nobody, update: nobody, delete: nobody, manage: nobody,
  } },
  { id: 'alerts', label: '告警监控', description: '告警规则、指标、静默与处置仅管理员可访问。', access: {
    read: admins, create: admins, update: admins, delete: admins, manage: admins,
  } },
  { id: 'model_registry', label: '模型注册中心', description: '成员只能读取其角色允许的模型；模型与执行预算由管理员管理。退役通过管理操作完成。', access: {
    read: { super_admin: 'all', admin: 'all', member: 'allowed_models' },
    create: admins, update: admins, delete: nobody, manage: admins,
  } },
  { id: 'model_connections', label: '模型连接', description: '管理员查看、创建与修改连接；连接测试为管理操作。当前没有删除接口。', access: {
    read: admins, create: admins, update: admins, delete: nobody, manage: admins,
  } },
  { id: 'model_quotas', label: '模型 Token 配额', description: '管理员读取、设置或移除模型日配额；设置接口可创建或更新配额。', access: {
    read: admins, create: admins, update: admins, delete: admins, manage: nobody,
  } },
  { id: 'model_costs', label: '模型成本', description: '成本报表只读；月预算由管理员读取和修改。', access: {
    read: admins, create: nobody, update: admins, delete: nobody, manage: nobody,
  } },
  { id: 'model_rate_limits', label: '模型速率限制', description: '管理员读取实时限流状态，设置或移除模型 RPM/TPM 限制。', access: {
    read: admins, create: admins, update: admins, delete: admins, manage: nobody,
  } },
  { id: 'model_security', label: '模型安全策略', description: '管理员读取安全事件及策略、修改策略；事件记录不可通过业务接口改写。', access: {
    read: admins, create: nobody, update: admins, delete: nobody, manage: nobody,
  } },
  { id: 'model_health', label: '模型健康', description: '健康状态面板只读，仅管理员可访问。', access: {
    read: admins, create: nobody, update: nobody, delete: nobody, manage: nobody,
  } },
  { id: 'project_repositories', label: '项目仓库', description: '所有账号仅能查看、创建和修改自己的仓库；刷新和任务关联属于管理操作。当前没有删除接口。', access: {
    read: { super_admin: 'own', admin: 'own', member: 'own' }, create: { super_admin: 'own', admin: 'own', member: 'own' },
    update: { super_admin: 'own', admin: 'own', member: 'own' }, delete: nobody,
    manage: { super_admin: 'own', admin: 'own', member: 'own' },
  } },
  { id: 'project_scans', label: '仓库扫描', description: '所有账号仅能读取自己仓库的扫描、文件内容并发起扫描；当前没有修改和删除接口。', access: {
    read: { super_admin: 'own', admin: 'own', member: 'own' }, create: { super_admin: 'own', admin: 'own', member: 'own' },
    update: nobody, delete: nobody, manage: nobody,
  } },
  { id: 'project_analyses', label: '项目分析', description: '所有账号仅能读取自己仓库的报告、发起分析并取消或重试自己的分析；当前没有删除接口。', access: {
    read: { super_admin: 'own', admin: 'own', member: 'own' }, create: { super_admin: 'own', admin: 'own', member: 'own' },
    update: nobody, delete: nobody, manage: { super_admin: 'own', admin: 'own', member: 'own' },
  } },
  { id: 'project_baselines', label: '项目需求基线', description: '只能读取自己仓库的需求版本并创建新版本；已有版本不可修改或删除。', access: {
    read: { super_admin: 'own', admin: 'own', member: 'own' }, create: { super_admin: 'own', admin: 'own', member: 'own' },
    update: nobody, delete: nobody, manage: nobody,
  } },
  { id: 'project_feedback', label: '项目结论反馈', description: '仅能为自己仓库已完成报告中的结论提交人工反馈；反馈随报告详情读取。', access: {
    read: nobody, create: { super_admin: 'own', admin: 'own', member: 'own' }, update: nobody, delete: nobody, manage: nobody,
  } },
  { id: 'project_finding_matches', label: '项目结论人工对应', description: '仅能确认或撤销自己仓库两份可信报告中未关联需求的结论对应；原始结论不变。', access: {
    read: { super_admin: 'own', admin: 'own', member: 'own' }, create: { super_admin: 'own', admin: 'own', member: 'own' },
    update: nobody, delete: { super_admin: 'own', admin: 'own', member: 'own' }, manage: nobody,
  } },
  { id: 'project_suggestions', label: '项目建议处理', description: '所有账号可调整或忽略自己仓库的建议；仅管理员可预览并接受建议转任务。', access: {
    read: { super_admin: 'own', admin: 'own', member: 'none' }, create: { super_admin: 'own', admin: 'own', member: 'none' },
    update: nobody, delete: nobody, manage: { super_admin: 'own', admin: 'own', member: 'own' },
  } },
  { id: 'evaluation_folders', label: '评测文件夹', description: '所有登录账号可浏览文件夹；创建、重命名和删除仅管理员可操作。', access: {
    read: { super_admin: 'all', admin: 'all', member: 'all' }, create: admins, update: admins, delete: admins, manage: nobody,
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
  // Restricted read scopes are further narrowed by their existing queries.
  // A role check alone must never bypass those filters.
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
