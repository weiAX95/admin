import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../mock/passwords.mjs";
import { importJson, migrate, pool, sha256 } from "../mock/postgres-store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(process.argv[2] || path.join(root, "mock/db.json"));
let client;
try {
  const bytes = fs.readFileSync(source);
  const raw = JSON.parse(bytes.toString("utf8"));
  if (!raw || !Array.isArray(raw.tasks) || !Array.isArray(raw.users)) throw new Error("旧 JSON 数据结构无效");
  await migrate();
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(748201)");
  const backupDirectory = path.join(path.dirname(source), "db-backups");
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const backup = path.join(backupDirectory, `${path.basename(source)}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup, 0o600);
  const data = { ...raw, users: raw.users.map(user => ({ ...user, passwordHash: hashPassword(user.password), password: undefined })) };
  const counts = await importJson(client, data, sha256(bytes));
  await client.query("COMMIT");
  console.log(`Imported ${source}; backup: ${backup}`);
  console.log(counts);
} catch (error) {
  if (client) await client.query("ROLLBACK");
  console.error("Import failed:", error);
  process.exitCode = 1;
} finally { client?.release(); await pool.end(); }
