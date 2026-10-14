# 操作审计的数据库运行账号

数据库迁移账号拥有表结构，API 和评测 worker 不应持有该账号的连接串。独立运行账号可读写业务表，但对 `security_audit_logs` 只有读取和追加权限；旧审计记录只能由数据库所有者创建的 `cleanup_security_audit_logs()` 按 `retention_settings.audit_days` 清理。函数不接受客户端指定的截止时间。数据库所有者、超级用户及掌握主机备份的人仍可改变历史；这里的边界针对 API／worker 账号，不是对这些更高权限者的绝对防篡改保证。

1. 使用迁移账号设置 `DATABASE_URL`，执行 `npm run db:migrate`。这会安装 [108 迁移](../db/migrations/108_security_audit_retention.sql)。
2. 为同一数据库设置另一个角色的 `APP_DATABASE_URL`。角色名使用小写字母、数字和下划线，密码独立生成。执行 `npm run db:provision-app-role`。脚本会在角色不存在时创建普通登录角色，赋予现有业务表和后续由迁移账号创建的表的读写权限，随后撤销其审计表更新／删除和迁移记录写权限。已有高权限角色或仍可更新／删除审计表的角色会被拒绝。
3. 在 API 和独立 worker 进程中只提供 `APP_DATABASE_URL`，不要提供迁移账号的 `DATABASE_URL`。`NODE_ENV=production` 时缺少 `APP_DATABASE_URL` 会拒绝启动。每次新增迁移后，用迁移账号执行 `npm run db:migrate`，必要时重跑角色配置命令。迁移脚本与恢复工具仍使用独立的迁移／维护账号。
4. 在线手动备份的 `pg_dump` 优先使用 `BACKUP_DATABASE_URL`，否则使用 `APP_DATABASE_URL`；它需要对所有待备份表具有读取权限。独立备份账号应只获得读取权限。恢复操作不应由 API 运行账号执行。

本地开发为兼容旧环境，未设置 `APP_DATABASE_URL` 时 API 仍使用 `DATABASE_URL`；这时数据库账号隔离尚未生效。切换前先保存数据库备份；角色配置完成后重启 API 和 worker，让新连接生效。完整接口、权限和保留期行为将在项目统一测试阶段验证。
