import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
export const assetDir = process.env.ASSET_DIR || path.join(root, "uploads");
const MAX_BYTES = 10 * 1024 * 1024;
const assetRoute = /^\/api\/assets\/([0-9a-f-]{36})$/;
export const isAssetPath = pathname => pathname === "/api/assets" || assetRoute.test(pathname);

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(payload));
}

function imageMime(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6))) return "image/gif";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

async function readLimited(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw Object.assign(new Error("图片不能超过 10 MB"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function handleAssetRequest(req, res, pool, lookupSession, canReadSharedAsset = async () => false) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];
  const assetMatch = pathname.match(assetRoute);
  if (!await lookupSession(token) && !(assetMatch && req.method === "GET" && await canReadSharedAsset(url.searchParams.get("share"), assetMatch[1]))) return json(res, 401, { error: "请先登录" });
  if (pathname === "/api/assets" && req.method === "POST") {
    try {
      if (Number(req.headers["content-length"] || 0) > MAX_BYTES) return json(res, 413, { error: "图片不能超过 10 MB" });
      const data = await readLimited(req);
      const mime = imageMime(data);
      if (!mime || req.headers["content-type"]?.split(";")[0] !== mime) return json(res, 415, { error: "只支持 PNG、JPEG、WebP、GIF 图片" });
      const id = crypto.randomUUID();
      await fs.mkdir(assetDir, { recursive: true });
      await fs.writeFile(path.join(assetDir, id), data, { flag: "wx" });
      try { await pool.query("INSERT INTO media_assets(id,mime_type,byte_size) VALUES($1,$2,$3)", [id, mime, data.length]); }
      catch (error) { await fs.unlink(path.join(assetDir, id)).catch(() => {}); throw error; }
      return json(res, 201, { id, url: `/api/assets/${id}` });
    } catch (error) {
      return json(res, error.status || 500, { error: error.status ? error.message : "图片保存失败" });
    }
  }
  const match = pathname.match(assetRoute);
  if (match && req.method === "GET") {
    const record = await pool.query("SELECT mime_type FROM media_assets WHERE id=$1", [match[1]]);
    if (!record.rowCount) return json(res, 404, { error: "图片不存在" });
    try {
      const data = await fs.readFile(path.join(assetDir, match[1]));
      res.writeHead(200, { "Content-Type": record.rows[0].mime_type, "Content-Length": data.length, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" });
      return res.end(data);
    } catch { return json(res, 404, { error: "图片文件不存在" }); }
  }
  return json(res, 405, { error: "method not allowed" });
}

export async function cleanupAssets(pool, now = new Date(), directory = assetDir) {
  const ownConnection = typeof pool.totalCount === "number";
  const client = ownConnection ? await pool.connect() : pool;
  const removed = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(748201)");
    const content = await client.query("SELECT content AS value FROM notes UNION ALL SELECT description FROM tasks UNION ALL SELECT notes FROM tasks UNION ALL SELECT prompt FROM experiments UNION ALL SELECT result FROM experiments UNION ALL SELECT system_prompt FROM experiments UNION ALL SELECT user_prompt FROM experiments UNION ALL SELECT output FROM experiment_runs UNION ALL SELECT snapshot_description FROM recurring_series UNION ALL SELECT description FROM task_templates");
    const referenced = new Set();
    const pattern = /\/api\/assets\/([0-9a-f-]{36})/g;
    for (const row of content.rows) for (const match of String(row.value || "").matchAll(pattern)) referenced.add(match[1]);
    const expired = await client.query("SELECT id FROM media_assets WHERE created_at < $1", [new Date(now.getTime() - 24 * 3600 * 1000)]);
    for (const row of expired.rows) {
      if (referenced.has(row.id)) continue;
      await client.query("DELETE FROM media_assets WHERE id=$1", [row.id]);
      removed.push(row.id);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { if (ownConnection) client.release(); }
  for (const id of removed) await fs.unlink(path.join(directory, id)).catch(() => {});
}
