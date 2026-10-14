import pg from 'pg';

const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;
if (!ownerUrl || !appUrl) {
  console.error('请同时设置迁移账号 DATABASE_URL 和独立运行账号 APP_DATABASE_URL');
  process.exit(1);
}

const owner = new URL(ownerUrl);
const app = new URL(appUrl);
const identity = url => `${url.hostname}:${url.port || '5432'}${url.pathname}`;
if (identity(owner) !== identity(app) || !/^[a-z_][a-z0-9_]{0,62}$/.test(decodeURIComponent(app.username)) || !app.password) {
  console.error('APP_DATABASE_URL 必须指向同一数据库，使用独立的小写数据库角色和非空密码');
  process.exit(1);
}

const role = decodeURIComponent(app.username);
const password = decodeURIComponent(app.password);
const quotedRole = `"${role}"`;
const client = new pg.Client({ connectionString: ownerUrl });
try {
  await client.connect();
  await client.query('BEGIN');
  const current = (await client.query('SELECT current_user AS name,current_database() AS database')).rows[0];
  if (current.name === role) throw new Error('运行账号不能与迁移账号相同');
  const migration = await client.query("SELECT 1 FROM schema_migrations WHERE version='108_security_audit_retention'");
  if (!migration.rowCount) throw new Error('请先以迁移账号运行 npm run db:migrate');
  const existing = (await client.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication FROM pg_roles WHERE rolname=$1', [role])).rows[0];
  if (!existing) {
    const quotedPassword = (await client.query('SELECT quote_literal($1) AS value', [password])).rows[0].value;
    await client.query(`CREATE ROLE ${quotedRole} LOGIN PASSWORD ${quotedPassword} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
  } else if (existing.rolsuper || existing.rolcreaterole || existing.rolcreatedb || existing.rolreplication) {
    throw new Error('运行账号已有高权限，请改用独立的普通角色');
  }
  const inheritsOwner = (await client.query("SELECT pg_has_role($1::name,current_user,'member') AS member", [role])).rows[0].member;
  if (inheritsOwner) throw new Error('运行账号不能继承迁移账号权限');

  await client.query(`GRANT CONNECT ON DATABASE "${current.database.replaceAll('"', '""')}" TO ${quotedRole}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
  await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRole}`);
  await client.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole}`);
  await client.query(`REVOKE UPDATE,DELETE ON public.security_audit_logs FROM ${quotedRole}`);
  await client.query(`REVOKE INSERT,UPDATE,DELETE ON public.schema_migrations FROM ${quotedRole}`);
  await client.query(`GRANT EXECUTE ON FUNCTION public.cleanup_security_audit_logs() TO ${quotedRole}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${quotedRole}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${quotedRole}`);
  const privileges = (await client.query(`SELECT
    has_table_privilege($1,'public.security_audit_logs','SELECT') AS can_read,
    has_table_privilege($1,'public.security_audit_logs','INSERT') AS can_append,
    has_table_privilege($1,'public.security_audit_logs','UPDATE') AS can_update,
    has_table_privilege($1,'public.security_audit_logs','DELETE') AS can_delete`, [role])).rows[0];
  if (!privileges.can_read || !privileges.can_append || privileges.can_update || privileges.can_delete) {
    throw new Error('审计表有效权限不符合只读加追加要求');
  }
  await client.query('COMMIT');
  const runtime = new pg.Client({ connectionString: appUrl });
  try {
    await runtime.connect();
    const connected = (await runtime.query('SELECT current_user AS name')).rows[0].name;
    if (connected !== role) throw new Error('运行连接使用了错误的数据库角色');
  } finally { await runtime.end().catch(() => undefined); }
  console.log(`数据库运行角色 ${role} 已配置：审计表仅可读取和追加，过期清理由受限函数执行`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(`运行角色配置失败：${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
