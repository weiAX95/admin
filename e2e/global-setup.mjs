import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { migrate, importJson } from '../mock/postgres-store.mjs';
import { hashPassword } from '../mock/passwords.mjs';
import { basicFixture } from '../tests/pg-helper.mjs';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const uiPort = 5187;

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(url, child, logs) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`E2E 服务提前退出：${logs.join('').slice(-2000)}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* Service is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`E2E 服务启动超时：${logs.join('').slice(-2000)}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

export default async function globalSetup() {
  const base = new URL(process.env.TEST_DATABASE_URL || 'postgres://admin:admin_local_only@127.0.0.1:55432/agent_admin_test');
  base.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  const database = `admin_e2e_${randomUUID().replaceAll('-', '')}`;
  let client;
  let api;
  let vite;
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(base);
    url.pathname = `/${database}`;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    await migrate(client);
    const fixture = basicFixture();
    fixture.users = fixture.users.map(user => ({ ...user, passwordHash: hashPassword(user.password), password: undefined }));
    await client.query('BEGIN');
    try { await importJson(client, fixture, randomUUID()); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    await client.end();
    client = null;

    const apiPort = await freePort();
    const logs = [];
    api = spawn(process.execPath, [path.join(root, 'mock/server.mjs')], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url.toString(), MOCK_PORT: String(apiPort), WEBHOOK_MASTER_KEY: randomBytes(32).toString('hex') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    api.stdout.on('data', chunk => logs.push(String(chunk)));
    api.stderr.on('data', chunk => logs.push(String(chunk)));
    await waitFor(`http://127.0.0.1:${apiPort}/api/settings/public`, api, logs);

    vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], {
      cwd: root,
      env: { ...process.env, ADMIN_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    vite.stdout.on('data', chunk => logs.push(String(chunk)));
    vite.stderr.on('data', chunk => logs.push(String(chunk)));
    await waitFor(`http://127.0.0.1:${uiPort}/login`, vite, logs);

    return async () => {
      await Promise.all([stop(vite), stop(api)]);
      await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await admin.end();
    };
  } catch (error) {
    await Promise.all([stop(vite), stop(api)]);
    if (client) await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.end();
    throw error;
  }
}
