/**
 * 一条命令同时启动 mock API server 与 Vite dev server。
 * 避免手动开两个终端：npm run dev
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localEnv = path.join(root, ".env.local");
if (fs.existsSync(localEnv)) process.loadEnvFile(localEnv);
if (!process.env.WEBHOOK_MASTER_KEY) {
  const existing = fs.existsSync(localEnv) ? fs.readFileSync(localEnv, "utf8") : "";
  if (/^WEBHOOK_MASTER_KEY\s*=/m.test(existing)) throw new Error(".env.local 中的 WEBHOOK_MASTER_KEY 无效，请检查后重试");
  fs.appendFileSync(localEnv, `${existing && !existing.endsWith("\n") ? "\n" : ""}WEBHOOK_MASTER_KEY=${crypto.randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  fs.chmodSync(localEnv, 0o600);
  process.loadEnvFile(localEnv);
}
if (!/^[a-f\d]{64}$/i.test(process.env.WEBHOOK_MASTER_KEY || "")) throw new Error("WEBHOOK_MASTER_KEY 必须是 32 字节随机密钥的十六进制值");

const children = [];

function launch(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  child.on("error", (err) => {
    console.error(`[dev-all] ${name} 启动出错：`, err.message);
    shutdown(1);
  });
  child.on("exit", (code) => {
    console.log(`[dev-all] ${name} exited with code ${code}`);
    if (code !== 0 && name === "mock") {
      console.error(
        "[dev-all] mock 非正常退出：若提示端口占用，请先停止另一个实例再重试。"
      );
    }
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// mock API server
launch("mock", [path.join(root, "mock", "server.mjs")]);
// Vite dev server（vite 的 exports 未暴露 bin 子路径，直接按文件系统定位入口）
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
launch("vite", [viteBin]);
