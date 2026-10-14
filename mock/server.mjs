import { isAdministrator, isSuperAdmin } from './roles.mjs';
import { canAccess, permissionMatrix } from './permissions.mjs';
/**
 * 本地 API 层（node:http + PostgreSQL）。
 * 覆盖：登录鉴权、学习任务 CRUD + 审计、会话记录、学习笔记、实验记录、统计看板。
 * PostgreSQL 是唯一运行时数据源；旧 db.json 仅供显式迁移。
 *
 * 启动：npm run mock   （默认端口 8002，可用 MOCK_PORT 覆盖）
 * 演示账号：admin / admin123
 */
import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { listActivity } from "./activity.mjs";
import { searchSessions } from "./session-search.mjs";
import { searchGlobally } from "./global-search.mjs";
import { saveClientError } from "./client-errors.mjs";
import { exportSessions } from "./session-export.mjs";
import { handleSessionCosts, saveSessionPriceSnapshot } from './session-costs.mjs';
import { saveSessionQuality } from './session-quality.mjs';
import { assignSessionCluster, ensureSessionClusters, rebuildSessionClusters } from './session-clusters.mjs';
import { getSessionLearningPath } from "./session-learning-path.mjs";
import { getRelatedSessions } from "./session-related.mjs";
import { activityHeatmap, activityDay, validDateKey } from "./heatmap.mjs";
import { quickActionCounts, quickPreview } from "./quick-actions.mjs";
import { computeOverdueTasks } from "./overdue.mjs";
import crypto from "node:crypto";
import { parseLoginIpAllowlist, requestLoginIp } from './login-network.mjs';
import { recordAccountAction } from './account-audit.mjs';
import { handleAccountAudit } from './account-audit-api.mjs';
import { handleAccountActivity, markInactiveAccounts } from './account-activity.mjs';
import { pool, loadData, saveData, sha256, assertSchemaCurrent } from "./postgres-store.mjs";
import { hashPassword, passwordPolicyError, verifyPassword } from "./passwords.mjs";
import { consumeMfaFactor, getMfaChallenge, handleAccountMfa, issueMfaChallenge, mfaConfigured, mfaState } from './account-mfa.mjs';
import { createPasswordExpiryReminders } from "./password-expiry.mjs";
import { recordTaskTrendEvent, recordTaskTrendSnapshot, computeTaskTrends, trendDateKey } from "./task-trends.mjs";
import { applyTaskProgress, clampProgress as normalizeProgress, normalizeChecklist } from "./task-checklist.mjs";
import { canUseDependency, projectTasks, validateDependencies, validatePlan } from "./task-dependencies.mjs";
import { AUDITED_TASK_FIELDS, recordTaskChanges } from "./task-change-log.mjs";
import { actualMinutes, applyCompletionTransition, initializeTaskWork, normalizeTimeEntry, workVariance } from "./task-worklog.mjs";
import { canGenerate, createSeries, generateDueInstances, occurrenceDueAt, updateSeries } from "./recurring.mjs";
import { prepareCsvImport } from "./task-csv-import.mjs";
import { extractWikiLinks, normalizeWikiLinks } from "./wiki-links.mjs";
import { cleanupAssets, handleAssetRequest, isAssetPath } from "./media-assets.mjs";
import { handlePromptMedia, isPromptMediaPath } from "./prompt-media.mjs";
import { handlePromptArchive, isPromptArchivePath } from "./prompt-archive.mjs";
import { handlePromptSync, isPromptSyncPath } from "./prompt-sync.mjs";
import { canonicalNoteTags, noteTagKey, noteTagUsage, validateNoteTagName } from "./note-tags.mjs";
import { buildKnowledgeGraph } from "./knowledge-graph.mjs";
import { initializeNoteReviews, initializeUserReviews, resetNoteReviews, completeNoteReview, createDueReviewNotifications, shanghaiDate, addCalendarDays, reminderTime } from "./note-reviews.mjs";
import { deliverReviewEmails, smtpConfigured } from "./review-mailer.mjs";
import { handleExperimentPlatform } from "./experiment-platform.mjs";
import { recoverExperimentJobs, runExperimentJobs } from "./experiment-runner.mjs";
import { handleExperimentEvaluation, syncEvaluationCandidate } from "./experiment-evaluation.mjs";
import { handleEvaluationReviews } from "./evaluation-review-api.mjs";
import { handleEvaluationSchedules, processDueEvaluationSchedules } from "./evaluation-schedules.mjs";
import { handleEvaluationReportSharing, handlePublicEvaluationReport, canReadSharedEvaluationMedia } from "./evaluation-report-sharing.mjs";
import { canReadSharedExperimentAsset, handleExperimentSharing, handlePublicExperimentShare } from "./experiment-sharing.mjs";
import { deliverAppEmails, notifyUser } from "./app-notifications.mjs";
import { handleExperimentSchedules, processDueExperimentSchedules } from "./experiment-schedules.mjs";
import { handlePrompts } from "./prompts.mjs";
import { getGlobalSettings, handleSystemSettings } from "./system-settings.mjs";
import { handleModelConnections } from './model-connections.mjs';
import { checkLatestRelease, versionInfo } from './version-info.mjs';
import { handleRetentionSettings, runRetentionCleanup } from './retention.mjs';
import { handleRecycleBin } from './recycle-bin.mjs';
import { handleModelQuotas } from './model-quotas.mjs';
import { handleModelCosts, handleModelCostBudget } from './model-costs.mjs';
import { handleModelRateLimits } from './model-rate-limits.mjs';
import { handleModelCallAudit, flushModelCallAudits } from './model-call-audit.mjs';
import { handleModelHealth, processModelHealthAlerts } from './model-health.mjs';
import { collectAlertMetrics, handleAlertMetrics } from './alert-metrics.mjs';
import { evaluateAlertRules, handleAlertRules } from './alert-rules.mjs';
import { handleModelSecurity } from './model-security.mjs';
import { handleBackupRequest, recoverBackupJobs } from './backup-jobs.mjs';
import { handleOutboundWebhooks, processOutboundWebhooks } from './outbound-webhooks.mjs';
import { handleProjectRepositories } from './project-repositories.mjs';
import { handleProjectScans, resumeProjectScans } from './project-scan-jobs.mjs';
import { handleProjectAnalyses, resumeProjectAnalyses } from './project-analyses.mjs';
import { handleProjectSuggestionAction } from './project-suggestion-actions.mjs';
import { handleProjectFindingFeedback } from './project-finding-feedback.mjs';
import { handleProjectRequirementBaselines } from './project-requirement-baselines.mjs';
import { processDueModelRetirements } from './model-retirement.mjs';

function reconcileNoteLinks(preserveContentId = null) {
  let changed = false;
  for (const note of db.notes) {
    const content = note.id === preserveContentId ? note.content || "" : normalizeWikiLinks(note.content || "", db.notes);
    const links = extractWikiLinks(content, db.notes);
    if (note.content !== content || JSON.stringify(note.links || []) !== JSON.stringify(links)) {
      note.content = content;
      note.links = links;
      changed = true;
    }
  }
  return changed;
}
function snapshotNote(note, reason) {
  let latest = 0;
  for (const version of db.noteVersions) if (version.noteId === note.id && version.versionNumber > latest) latest = version.versionNumber;
  db.noteVersions.push({ id: newId(), noteId: note.id, versionNumber: latest + 1, title: note.title, content: note.content, reason, createdAt: note.updatedAt });
}
function categoryBranch(categories, rootId) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) if (ids.has(category.parentId) && !ids.has(category.id)) { ids.add(category.id); changed = true; }
  }
  return ids;
}

const PORT = Number(process.env.MOCK_PORT || 8002);

const DAY = 24 * 3600 * 1000;
const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const isoOffset = (days) => new Date(Date.now() + days * DAY).toISOString();
const dateKey = trendDateKey;

/* ------------------------------ 种子数据 ------------------------------ */

function seedTasks() {
  const t = nowIso();
  const base = [
    {
      title: "理解 Agent 基本范式（ReAct / Plan-and-Execute）",
      description: "梳理 ReAct 的思考-行动-观察循环，对比 Plan-and-Execute 的规划式执行。",
      category: "基础概念", phase: "基础", status: "in_progress", progress: 60,
      priority: "high", dueDate: isoOffset(-2),
      notes: "ReAct 适合工具密集任务；Plan-and-Execute 适合长链路、可分解任务。",
      resources: [{ label: "ReAct 论文", url: "https://arxiv.org/abs/2210.03629" }],
    },
    {
      title: "掌握 Function Calling 与工具编排",
      description: "理解函数调用的 schema 定义、参数校验与多工具编排策略。",
      category: "工具链", phase: "基础", status: "in_progress", progress: 40,
      priority: "high", dueDate: isoOffset(3), notes: "", resources: [],
    },
    {
      title: "搭建最小 RAG 检索增强流水线",
      description: "从文档切分、向量化、检索到注入提示，跑通一个最小 RAG。",
      category: "实战", phase: "实战", status: "todo", progress: 0,
      priority: "medium", dueDate: isoOffset(7), notes: "", resources: [],
    },
    {
      title: "学习 Agent 记忆机制（短期 / 长期 / 向量记忆）",
      description: "区分会话内短期记忆与跨会话长期记忆，了解向量存储方案。",
      category: "基础概念", phase: "进阶", status: "todo", progress: 0,
      priority: "medium", dueDate: isoOffset(5), notes: "", resources: [],
    },
    {
      title: "Multi-Agent 协作与角色分工",
      description: "研究多智能体的角色划分、消息传递与冲突仲裁。",
      category: "实战", phase: "实战", status: "blocked", progress: 20,
      priority: "low", dueDate: isoOffset(10), notes: "卡在角色间状态同步，待补充示例。",
      resources: [],
    },
    {
      title: "Agent 评估与可观测性（trace / 指标）",
      description: "建立任务成功率、工具调用准确率等指标与 trace 追踪。",
      category: "工程化", phase: "工程化", status: "done", progress: 100,
      priority: "medium", dueDate: isoOffset(-5), notes: "已完成：定义了 4 个核心指标并接入日志。",
      resources: [],
    },
    {
      title: "提示词工程与结构化输出",
      description: "系统提示设计、少样本示例与 JSON Schema 约束输出。",
      category: "基础概念", phase: "基础", status: "done", progress: 100,
      priority: "high", dueDate: isoOffset(-8), notes: "", resources: [],
    },
  ];
  return base.map((item) => ({ id: newId(), createdAt: t, updatedAt: t, ...item }));
}

function buildSeed() {
  const tasks = seedTasks();
  const t = nowIso();

  const sessions = [
    {
      id: newId(),
      userId: "u-web-001",
      createdAt: isoOffset(-1),
      updatedAt: isoOffset(-1),
      messages: [
        { id: newId(), role: "user", content: "帮我解释一下 React 19 里的 use() 钩子应该怎么用？", at: isoOffset(-1) },
        { id: newId(), role: "assistant", content: "use() 用于在组件中读取 Promise 或 Context 资源，配合 Suspense 实现异步数据渲染……", at: isoOffset(-1) },
        { id: newId(), role: "user", content: "它和 useEffect 有什么区别？", at: isoOffset(-1) },
        { id: newId(), role: "assistant", content: "use() 是读取资源，useEffect 是副作用调度；前者参与渲染流程，后者在渲染后执行。", at: isoOffset(-1) },
      ],
    },
    {
      id: newId(),
      userId: "u-web-001",
      createdAt: isoOffset(-3),
      updatedAt: isoOffset(-3),
      messages: [
        { id: newId(), role: "user", content: "对比 Vite、Next.js 和 Remix，作为个人项目我该选哪个？", at: isoOffset(-3) },
        { id: newId(), role: "assistant", content: "个人项目优先 Vite：轻量、启动快；需要 SSR/路由全家桶再考虑 Next.js；Remix 擅长数据加载模型。", at: isoOffset(-3) },
      ],
    },
  ];

  const notes = [
    {
      id: newId(),
      title: "ReAct 循环要点",
      content: "Thought → Action → Observation 三步循环；工具返回作为下一步观察输入。",
      taskId: tasks[0].id,
      sourceSessionId: null,
      createdAt: isoOffset(-2),
      updatedAt: isoOffset(-2),
    },
  ];

  const experiments = [
    {
      id: newId(),
      title: "ReAct vs 直接回答 对比",
      taskId: tasks[0].id,
      prompt: "用 ReAct 格式解决：查询天气并给出穿衣建议",
      model: "gpt-4o-mini",
      params: "temperature=0.2, maxSteps=5",
      result: "ReAct 版本工具调用准确率明显更高，但 token 消耗约 2.3 倍。",
      score: 4,
      createdAt: isoOffset(-2),
      updatedAt: isoOffset(-2),
    },
    {
      id: newId(),
      title: "结构化输出稳定性测试",
      taskId: tasks[6].id,
      prompt: "以 JSON Schema 输出任务计划",
      model: "gpt-4o",
      params: "temperature=0, response_format=json_schema",
      result: "30 次调用全部通过 schema 校验。",
      score: 5,
      createdAt: isoOffset(-6),
      updatedAt: isoOffset(-6),
    },
  ];

  // 审计/打卡种子：近 30 天分布的活动事件
  const activity = [];
  const types = ["update", "complete", "note", "experiment", "create"];
  for (let d = 29; d >= 0; d--) {
    const count = d % 4 === 0 ? 0 : (d % 3) + 1;
    for (let i = 0; i < count; i++) {
      const type = types[(d + i) % types.length];
      const task = tasks[(d + i) % tasks.length];
      activity.push({
        id: newId(),
        type,
        taskId: task.id,
        title: task.title,
        detail:
          type === "complete" ? "标记为已完成" :
          type === "note" ? "新增学习笔记" :
          type === "experiment" ? "记录一次实验" :
          type === "create" ? "创建任务" : "更新任务进度",
        at: new Date(Date.now() - d * DAY + i * 3600 * 1000).toISOString(),
      });
    }
  }
  activity.sort((a, b) => (a.at < b.at ? 1 : -1));

  // 账号种子：admin 管理员 + 普通成员 + 一个禁用账号
  const users = [
    { id: newId(), username: "admin", password: "admin123", name: "管理员", role: "admin", status: "active", createdAt: t, updatedAt: t },
    { id: newId(), username: "learner", password: "learn123", name: "学习者", role: "member", status: "active", createdAt: t, updatedAt: t },
    { id: newId(), username: "guest", password: "guest123", name: "访客账号", role: "member", status: "disabled", createdAt: t, updatedAt: t },
  ];

  return { tasks, sessions, notes, experiments, activity, users };
}

/* ------------------------------ 持久化 ------------------------------ */

let notifyLive = () => {};
let db;
let activeClient;
let dirty = false;
const saveDb = () => { dirty = true; };
let afterSaveTasks = [];
const afterSave = task => afterSaveTasks.push(task);
let requestTail = Promise.resolve();
function serialized(work) {
  const current = requestTail.then(work, work);
  requestTail = current.catch(() => {});
  return current;
}
async function lookupSession(token, client = pool, allowExpiredPassword = false, allowMfaSetup = false) {
  if (typeof token !== "string" || !token) return null;
  const result = await client.query(`SELECT u.id,u.username,u.role,a.mfa_setup_required FROM auth_sessions a JOIN users u ON u.id=a.user_id
    WHERE a.token_hash=$1 AND a.revoked_at IS NULL AND a.expires_at>now() AND u.status='active'
    AND ($3::boolean OR a.mfa_setup_required=false)
    AND ($2::boolean OR COALESCE((SELECT changed_at FROM password_history WHERE user_id=u.id ORDER BY changed_at DESC,id DESC LIMIT 1),now()) > now()-interval '90 days')`, [sha256(token), allowExpiredPassword, allowMfaSetup]);
  return result.rows[0] || null;
}
async function revokeUserSessions(userId) {
  const revoked = new Set((await activeClient.query("UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL RETURNING token_hash", [userId])).rows.map(row => row.token_hash));
  for (const [ws, liveToken] of liveClients) if (revoked.has(sha256(liveToken))) { ws.close(1008, 'authentication expired'); liveClients.delete(ws); }
}

async function recordLoginAttempt(req, account, username, deviceHash, succeeded, reason) {
  await activeClient.query(`INSERT INTO account_login_history(id,user_id,username,ip_address,user_agent,device_hash,succeeded,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [newId(), account?.id || null, String(username || '').slice(0, 30), requestLoginIp(req), String(req.headers['user-agent'] || '').slice(0, 500), deviceHash, succeeded, reason]);
}

async function createLoginSession(req, account, deviceHint, setupRequired = false) {
  const token = crypto.randomBytes(32).toString('hex');
  const deviceHash = deviceHint || sha256(token);
  const previousLogin = (await activeClient.query(`SELECT device_hash FROM account_login_history
    WHERE user_id=$1 AND succeeded=true ORDER BY created_at DESC LIMIT 1`, [account.id])).rows[0];
  if (!setupRequired && previousLogin?.device_hash && deviceHint) {
    const seen = (await activeClient.query(`SELECT 1 FROM account_login_history
      WHERE user_id=$1 AND succeeded=true AND device_hash=$2 LIMIT 1`, [account.id, deviceHash])).rowCount;
    if (!seen) await notifyUser(activeClient, account.id, 'account_new_device', sha256(`${account.id}:${deviceHash}`),
      '新设备登录提醒', `账号 ${account.username} 从新设备登录，连接 IP：${requestLoginIp(req)}。如非本人操作，请立即修改密码。`, '/settings');
  }
  const { sessionHours } = await getGlobalSettings(activeClient);
  await activeClient.query(`INSERT INTO auth_sessions(token_hash,user_id,expires_at,device_hash,mfa_setup_required)
    VALUES($1,$2,now()+($3 * interval '1 hour'),$4,$5)`, [sha256(token), account.id, sessionHours, deviceHash, setupRequired]);
  await enforceDeviceLimit(account);
  await recordLoginAttempt(req, account, account.username, deviceHash, !setupRequired, setupRequired ? 'mfa_setup_required' : 'success');
  if (!setupRequired) afterSave(client => client.query('UPDATE users SET last_login_at=now(),inactive_since=NULL WHERE id=$1', [account.id]));
  const passwordChangedAt = (await activeClient.query('SELECT changed_at FROM password_history WHERE user_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 1', [account.id])).rows[0]?.changed_at;
  const passwordChangeRequired = Boolean(passwordChangedAt && new Date(passwordChangedAt).getTime() <= Date.now() - 90 * 24 * 60 * 60 * 1000);
  return { token, user: { ...publicUser(account), passwordChangeRequired, mfaSetupRequired: setupRequired } };
}

async function enforceDeviceLimit(account) {
  const groups = (await activeClient.query(`SELECT COALESCE(device_hash,token_hash) AS device_key,MAX(created_at) AS newest
    FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()
    GROUP BY COALESCE(device_hash,token_hash) ORDER BY newest DESC,device_key DESC`, [account.id])).rows;
  const overflow = groups.slice(account.maxDevices || 3).map(row => row.device_key);
  if (!overflow.length) return;
  const oldTokens = (await activeClient.query(`UPDATE auth_sessions SET revoked_at=now()
    WHERE user_id=$1 AND revoked_at IS NULL AND COALESCE(device_hash,token_hash)=ANY($2::text[]) RETURNING token_hash`, [account.id, overflow])).rows;
  const revoked = new Set(oldTokens.map(row => row.token_hash));
  for (const [ws, liveToken] of liveClients) if (revoked.has(sha256(liveToken))) { ws.close(1008, 'device limit reached'); liveClients.delete(ws); }
}

/** 对外返回账号时剔除密码字段 */
const publicUser = (u) => ({
  id: u.id, username: u.username, name: u.name,
  role: u.role, superAdminCandidate: Boolean(u.superAdminCandidate), status: u.status,
  activationMode: u.activationMode || "immediate", activatedAt: u.activatedAt || null, maxDevices: u.maxDevices || 3, ipAllowlist: u.ipAllowlist || [],
  deletedAt: u.deletedAt || null,
  createdAt: u.createdAt, updatedAt: u.updatedAt,
});

function pauseAccountRecurrences(accountId, paused) {
  let changed = false;
  for (const series of db.recurringSeries) {
    if (series.ownerId !== accountId) continue;
    if (paused && series.active) {
      series.active = false;
      series.pausedByAccountStatus = true;
    } else if (!paused && series.pausedByAccountStatus) {
      series.active = true;
      series.pausedByAccountStatus = false;
    } else continue;
    series.version = (series.version || 1) + 1;
    series.updatedAt = nowIso();
    changed = true;
  }
  if (changed) scheduleRecurrences(0);
}

/* ------------------------------ helpers ------------------------------ */

function send(res, status, payload) {
  if (activeClient) { res.__pending = { status, payload }; return; }
  sendImmediate(res, status, payload);
}

function sendImmediate(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    ...(status===429&&Number.isInteger(payload?.retryAfterSeconds)?{"Retry-After":String(payload.retryAfterSeconds)}:{}),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function readProjectBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '', tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      if (Buffer.byteLength(raw) + chunk.length > 16384) { tooLarge = true; return; }
      raw += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('项目请求体过大'), { status: 413 }));
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(Object.assign(new Error('请求内容必须是 JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function authUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return lookupSession(token, activeClient, true, true);
}

async function annotationView(client, sessionId, messageId, reviewerId) {
  const rows = (await client.query("SELECT a.id,a.reviewer_id,a.rating,a.updated_at,t.tag FROM message_annotations a LEFT JOIN annotation_tags t ON t.annotation_id=a.id WHERE a.session_id=$1 AND a.message_id=$2 ORDER BY a.id", [sessionId, messageId])).rows;
  const annotations = new Map();
  for (const row of rows) {
    if (!annotations.has(row.id)) annotations.set(row.id, { reviewerId: row.reviewer_id, rating: row.rating, updatedAt: row.updated_at, tags: [] });
    if (row.tag) annotations.get(row.id).tags.push(row.tag);
  }
  const entries = [...annotations.values()];
  const mine = entries.find(item => item.reviewerId === reviewerId) || null;
  const tagCounts = new Map();
  for (const item of entries) for (const tag of item.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  return {
    mine: mine ? { rating: mine.rating, tags: mine.tags, updatedAt: mine.updatedAt } : null,
    summary: { averageRating: entries.length ? Math.round(entries.reduce((sum, item) => sum + item.rating, 0) / entries.length * 10) / 10 : null, ratingCount: entries.length, tags: [...tagCounts].map(([tag, count]) => ({ tag, count })) },
  };
}

const clampProgress = normalizeProgress;

const VALID_STATUS = ["todo", "in_progress", "done", "blocked"];
const VALID_PRIORITY = ["low", "medium", "high"];
const PRESET_TAGS = ["必学", "可选", "紧急", "长期", "复习", "已归档"];
const seriesView = series => ({ ...series, finished: !canGenerate(series, series.nextSequence) });
function normalizeTags(value) {
  if (!Array.isArray(value)) throw new Error("tags 必须是字符串数组");
  const tags = value.map(tag => typeof tag === "string" ? tag.trim() : "");
  if (tags.some(tag => !tag || tag.length > 32)) throw new Error("标签不能为空且不能超过 32 字符");
  return [...new Set(tags)];
}

function pickTaskWritable(body) {
  const out = {};
  if (body.estimatedHours !== undefined) {
    if (body.estimatedHours === null || body.estimatedHours === "") out.estimatedHours = null;
    else if (typeof body.estimatedHours === "number" && Number.isFinite(body.estimatedHours) && body.estimatedHours > 0) out.estimatedHours = body.estimatedHours;
    else throw new Error("预估工时必须为正数或留空");
  }
  if (typeof body.title === "string") out.title = body.title.trim();
  if (typeof body.description === "string") out.description = body.description;
  if (typeof body.category === "string") out.category = body.category.trim();
  if (typeof body.phase === "string") out.phase = body.phase.trim();
  if (body.plannedStartDate === null || body.plannedStartDate === "") out.plannedStartDate = "";
  else if (typeof body.plannedStartDate === "string") out.plannedStartDate = body.plannedStartDate.slice(0, 10);
  if (body.dependencyIds !== undefined) out.dependencyIds = body.dependencyIds;
  if (VALID_STATUS.includes(body.status)) out.status = body.status;
  if (VALID_PRIORITY.includes(body.priority)) out.priority = body.priority;
  if (body.progress !== undefined) out.progress = clampProgress(body.progress);
  if (body.tags !== undefined) out.tags = normalizeTags(body.tags);
  if (typeof body.notes === "string") out.notes = body.notes;
  if (body.dueDate === null || body.dueDate === "") out.dueDate = "";
  else if (typeof body.dueDate === "string") out.dueDate = body.dueDate;
  if (Array.isArray(body.resources)) {
    out.resources = body.resources
      .filter((r) => r && typeof r === "object")
      .map((r) => ({
        label: typeof r.label === "string" ? r.label : "",
        url: typeof r.url === "string" ? r.url : "",
      }));
  }
  return out;
}

const PRESET_TEMPLATES = [
  { id: "preset-research", name: "主题调研", description: "阅读资料、梳理概念并输出总结", defaultPhase: "基础", defaultPriority: "medium", checklist: ["明确学习目标", "阅读核心资料", "整理关键概念", "输出学习总结"], suggestedResources: [] },
  { id: "preset-practice", name: "动手实践", description: "通过小项目巩固知识", defaultPhase: "实战", defaultPriority: "high", checklist: ["确定实践范围", "完成最小实现", "验证关键场景", "记录复盘与改进"], suggestedResources: [] },
];

/** 记录一条审计/打卡活动 */
function logActivity(type, { taskId = null, title = "", detail = "", actor } = {}) {
  db.activity.unshift({ id: newId(), type, taskId, title, detail, at: nowIso(), ...(actor ? { userId: actor.id, username: actor.username, userName: actor.name || actor.username } : {}) });
  // 控制规模
  if (db.activity.length > 500) db.activity.length = 500;
}

function computeStats(tasks, { start, end, source = db, allTasks = tasks } = {}) {
  const trends = computeTaskTrends(source, { start, end });
  const byStatus = { todo: 0, in_progress: 0, done: 0, blocked: 0 };
  const catMap = new Map();
  let progressSum = 0;
  const overdue = computeOverdueTasks(allTasks);

  // 时间窗口过滤 activity：含 start/end 时只统计该区间内的 activity
  const activityInWindow = (!start && !end)
    ? source.activity
    : source.activity.filter((a) => {
        const aDate = dateKey(a.at);
        if (start && aDate < start) return false;
        if (end && aDate > end) return false;
        return true;
      });

  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    progressSum += t.progress || 0;
    const key = t.category || "未分类";
    const e = catMap.get(key) || { category: key, count: 0, doneCount: 0, progressSum: 0, tasks: [] };
    e.count += 1;
    e.progressSum += t.progress || 0;
    if (t.status === "done") e.doneCount += 1;
    e.tasks.push({ id: t.id, title: t.title, phase: t.phase || "基础", status: t.status, progress: t.progress || 0 });
    catMap.set(key, e);
  }

  // 每日完成数：有 start/end 时按区间计算，否则默认近 14 天
  const dailyDone = [];
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    for (let d = new Date(e); d >= s; d.setDate(d.getDate() - 1)) {
      const key = dateKey(d.toISOString());
      const count = activityInWindow.filter(
        (a) => a.type === "complete" && dateKey(a.at) === key
      ).length;
      dailyDone.push({ date: key, count });
    }
    dailyDone.reverse();
  } else {
    for (let d = 13; d >= 0; d--) {
      const key = dateKey(new Date(Date.now() - d * DAY).toISOString());
      const count = activityInWindow.filter(
        (a) => a.type === "complete" && dateKey(a.at) === key
      ).length;
      dailyDone.push({ date: key, count });
    }
  }

  // 热力图：有 start/end 时只展示该区间内数据，否则默认近 84 天
  const heatmap = [];
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    for (let d = new Date(e); d >= s; d.setDate(d.getDate() - 1)) {
      const key = dateKey(d.toISOString());
      const count = activityInWindow.filter((a) => dateKey(a.at) === key).length;
      heatmap.push({ date: key, count });
    }
    heatmap.reverse();
  } else {
    for (let d = 83; d >= 0; d--) {
      const key = dateKey(new Date(Date.now() - d * DAY).toISOString());
      const count = activityInWindow.filter((a) => dateKey(a.at) === key).length;
      heatmap.push({ date: key, count });
    }
  }

  return {
    total: tasks.length,
    workVariance: workVariance(allTasks, source.timeEntries),
    byStatus,
    avgProgress: tasks.length ? Math.round(progressSum / tasks.length) : 0,
    byCategory: [...catMap.values()].map((e) => ({
      category: e.category, count: e.count,
      doneCount: e.doneCount,
      avgProgress: Math.round(e.progressSum / e.count),
      tasks: e.tasks,
    })),
    overdue,
    dailyDone,
    trends,
    heatmap,
    recentActivity: activityInWindow.slice(0, 8),
  };
}

/* ------------------------------ router ------------------------------ */

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;
  const method = req.method || "GET";

  if (method === "OPTIONS") return send(res, 204, {});

  try {
    const publicShare = await handlePublicExperimentShare({ pathname, method, client: activeClient });
    if (publicShare) return send(res, publicShare.status, publicShare.data);
    const publicEvaluationReport = await handlePublicEvaluationReport({ pathname, method, client: activeClient });
    if (publicEvaluationReport) return send(res, publicEvaluationReport.status, publicEvaluationReport.data);
    const publicSettings = await handleSystemSettings({ pathname, method, client: activeClient, me: null });
    if (publicSettings) return send(res, publicSettings.status, publicSettings.data);
    if (method === "POST" && pathname === "/api/auth/invitations/preview") {
      const body = await readProjectBody(req);
      const token = String(body.token || "");
      if (!/^[a-f0-9-]{36}$/i.test(token)) return send(res, 404, { error: "邀请链接无效" });
      const invitation = (await activeClient.query("SELECT username,display_name,role,activation_mode,expires_at,consumed_at,revoked_at FROM account_invitations WHERE token_hash=$1", [sha256(token)])).rows[0];
      if (!invitation) return send(res, 404, { error: "邀请链接无效" });
      if (invitation.consumed_at || invitation.revoked_at || new Date(invitation.expires_at).getTime() <= Date.now()) return send(res, 410, { error: "邀请已使用、撤销或过期" });
      return send(res, 200, { username: invitation.username, name: invitation.display_name || invitation.username, role: invitation.role, activationMode: invitation.activation_mode, expiresAt: invitation.expires_at });
    }
    if (method === "POST" && pathname === "/api/auth/register") {
      const body = await readProjectBody(req);
      const token = String(body.token || "");
      if (!/^[a-f0-9-]{36}$/i.test(token)) return send(res, 404, { error: "邀请链接无效" });
      const invitation = (await activeClient.query("SELECT * FROM account_invitations WHERE token_hash=$1 FOR UPDATE", [sha256(token)])).rows[0];
      if (!invitation) return send(res, 404, { error: "邀请链接无效" });
      if (invitation.consumed_at || invitation.revoked_at || new Date(invitation.expires_at).getTime() <= Date.now()) return send(res, 410, { error: "邀请已使用、撤销或过期" });
      if (db.users.some(user => user.username === invitation.username)) return send(res, 409, { error: "用户名已被占用，请联系管理员" });
      const passwordError = passwordPolicyError(body.password);
      if (passwordError) return send(res, 400, { error: passwordError });
      const timestamp = nowIso();
      const account = { id: newId(), username: invitation.username, passwordHash: hashPassword(body.password),
        name: String(body.name || invitation.display_name || invitation.username).trim().slice(0, 30) || invitation.username,
        role: invitation.role, activationMode: invitation.activation_mode,
        status: invitation.activation_mode === "immediate" ? "active" : "pending",
        activatedAt: invitation.activation_mode === "immediate" ? timestamp : null,
        createdAt: timestamp, updatedAt: timestamp };
      db.users.push(account);
      saveDb(db);
      afterSave(async client => {
        await client.query("INSERT INTO password_history(user_id,password_hash) VALUES($1,$2)", [account.id, account.passwordHash]);
        await initializeUserReviews(client, account.id);
        await client.query("UPDATE account_invitations SET consumed_at=now(),consumed_user_id=$1 WHERE id=$2", [account.id, invitation.id]);
      });
      return send(res, 201, { username: account.username, status: account.status, activationMode: account.activationMode });
    }
    // ---- 登录（免鉴权）----
    if (method === "POST" && pathname === "/api/auth/login") {
      const body = await readBody(req);
      const fingerprint = typeof body.deviceFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(body.deviceFingerprint) ? body.deviceFingerprint.toLowerCase() : null;
      const deviceHint = fingerprint ? sha256(`${fingerprint}:${String(req.headers['user-agent'] || '')}`) : null;
      const account = db.users.find((u) => u.username === body.username);
      if (account) {
        const security = (await activeClient.query("SELECT failed_attempts,locked_until FROM login_security_state WHERE user_id=$1", [account.id])).rows[0];
        if (security?.locked_until && new Date(security.locked_until).getTime() > Date.now()) {
          await recordLoginAttempt(req, account, body.username, deviceHint, false, 'locked');
          return send(res, 429, { error: "登录尝试过多，请在锁定结束后重试", lockedUntil: security.locked_until });
        }
      }
      if (!account || !verifyPassword(body.password, account.passwordHash)) {
        if (account && ["active", "pending"].includes(account.status)) {
          const failure = (await activeClient.query(`INSERT INTO login_security_state(user_id,failed_attempts,updated_at)
            VALUES($1,1,now()) ON CONFLICT(user_id) DO UPDATE SET
            failed_attempts=CASE WHEN login_security_state.locked_until IS NOT NULL AND login_security_state.locked_until<=now() THEN 1 ELSE login_security_state.failed_attempts+1 END,
            locked_until=NULL,updated_at=now() RETURNING failed_attempts`, [account.id])).rows[0];
          if (failure.failed_attempts >= 5) {
            const lockedUntil = (await activeClient.query("UPDATE login_security_state SET locked_until=now()+interval '15 minutes',failed_attempts=0 WHERE user_id=$1 RETURNING locked_until", [account.id])).rows[0].locked_until;
            for (const admin of db.users.filter(user => isAdministrator(user) && user.status === "active")) {
              await notifyUser(activeClient, admin.id, "account_login_locked", `${account.id}:${new Date(lockedUntil).toISOString()}`, "账号登录已锁定", `账号 ${account.username} 连续 5 次登录失败，已锁定 15 分钟。`, "/accounts");
            }
            await recordLoginAttempt(req, account, body.username, deviceHint, false, 'locked');
            return send(res, 429, { error: "登录尝试过多，请在锁定结束后重试", lockedUntil });
          }
        }
        await recordLoginAttempt(req, account, body.username, deviceHint, false, 'invalid_credentials');
        return send(res, 401, { error: "用户名或密码错误" });
      }
      const loginIp = requestLoginIp(req);
      if (account.ipAllowlist?.length && !account.ipAllowlist.includes(loginIp)) {
        await recordLoginAttempt(req, account, body.username, deviceHint, false, 'ip_denied');
        return send(res, 403, { error: "当前 IP 不在该账号的登录白名单中" });
      }
      if (account.status === "pending" && account.activationMode === "first_login") {
        account.status = "active";
        account.activatedAt = nowIso();
        account.updatedAt = account.activatedAt;
        saveDb(db);
      }
      if (account.status !== "active") {
        await recordLoginAttempt(req, account, body.username, deviceHint, false, account.status);
        return send(res, 403, { error: account.status === "pending" ? "账号等待管理员激活" : "账号已停用，请联系管理员" });
      }
      const factor = await mfaState(activeClient, account.id);
      if ((factor?.enabled_at || account.role !== 'member') && !mfaConfigured()) {
        return send(res, 503, { error: '双因素认证尚未配置；请设置 MFA_ENCRYPTION_KEY' });
      }
      if (factor?.enabled_at) {
        const challengeToken = await issueMfaChallenge(activeClient, account.id, deviceHint);
        return send(res, 202, { mfaRequired: true, challengeToken, expiresInSeconds: 300 });
      }
      await activeClient.query('DELETE FROM login_security_state WHERE user_id=$1', [account.id]);
      return send(res, 200, await createLoginSession(req, account, deviceHint, account.role !== 'member'));
    }

    if (method === 'POST' && pathname === '/api/auth/mfa/verify') {
      const body = await readBody(req);
      const challenge = await getMfaChallenge(activeClient, body.challengeToken);
      if (!challenge) return send(res, 401, { error: '验证请求已过期，请重新登录' });
      const account = db.users.find(user => user.id === challenge.user_id);
      if (!account || account.status !== 'active') return send(res, 401, { error: '验证请求已过期，请重新登录' });
      const fingerprint = typeof body.deviceFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(body.deviceFingerprint) ? body.deviceFingerprint.toLowerCase() : null;
      const deviceHint = fingerprint ? sha256(`${fingerprint}:${String(req.headers['user-agent'] || '')}`) : null;
      if (challenge.device_hash !== deviceHint) return send(res, 401, { error: '登录设备已变化，请重新登录' });
      const security = (await activeClient.query('SELECT locked_until FROM login_security_state WHERE user_id=$1', [account.id])).rows[0];
      if (security?.locked_until && new Date(security.locked_until).getTime() > Date.now()) return send(res, 429, { error: '登录尝试过多，请稍后重试' });
      if (!await consumeMfaFactor(activeClient, account.id, body.code)) {
        await activeClient.query(`UPDATE account_mfa_login_challenges SET attempts=attempts+1 WHERE token_hash=$1`, [challenge.token_hash]);
        if (challenge.attempts >= 4) await activeClient.query('DELETE FROM account_mfa_login_challenges WHERE token_hash=$1', [challenge.token_hash]);
        const failure = (await activeClient.query(`INSERT INTO login_security_state(user_id,failed_attempts,updated_at) VALUES($1,1,now())
          ON CONFLICT(user_id) DO UPDATE SET failed_attempts=login_security_state.failed_attempts+1,updated_at=now() RETURNING failed_attempts`, [account.id])).rows[0];
        if (failure.failed_attempts >= 5) {
          await activeClient.query("UPDATE login_security_state SET locked_until=now()+interval '15 minutes',failed_attempts=0 WHERE user_id=$1", [account.id]);
        }
        await recordLoginAttempt(req, account, account.username, deviceHint, false, 'mfa_invalid');
        return send(res, 401, { error: '验证码或恢复码无效' });
      }
      await activeClient.query('DELETE FROM account_mfa_login_challenges WHERE token_hash=$1', [challenge.token_hash]);
      await activeClient.query('DELETE FROM login_security_state WHERE user_id=$1', [account.id]);
      return send(res, 200, await createLoginSession(req, account, deviceHint));
    }

    // ---- 其余接口需鉴权 ----
    const auth = await authUser(req);
    if (!auth) return send(res, 401, { error: "未登录或登录已过期" });
    const me = db.users.find((u) => u.username === auth.username) || null;
    if (!me) return send(res, 401, { error: "登录账号不存在，请重新登录" });
    res.__actor = { id: me.id, username: me.username };
    const currentTokenHash = sha256((req.headers.authorization || '').replace(/^Bearer /, ''));
    const latestPassword = (await activeClient.query("SELECT changed_at FROM password_history WHERE user_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 1", [me.id])).rows[0]?.changed_at;
    const passwordChangeRequired = Boolean(latestPassword && new Date(latestPassword).getTime() <= Date.now() - 90 * 24 * 60 * 60 * 1000);
    if (passwordChangeRequired && !["/api/auth/password", "/api/auth/logout", "/api/auth/me"].includes(pathname) && !pathname.startsWith('/api/auth/mfa')) {
      return send(res, 403, { error: "密码已过期，请先修改密码", code: "password_expired" });
    }
    if (auth.mfa_setup_required && !['/api/auth/me', '/api/auth/logout', '/api/auth/password'].includes(pathname) && !pathname.startsWith('/api/auth/mfa')) {
      return send(res, 403, { error: '请先绑定双因素认证', code: 'mfa_setup_required' });
    }
    const mfaResponse = await handleAccountMfa({ pathname, method, client: activeClient, me, readBody: () => readBody(req), tokenHash: currentTokenHash, verifyPassword });
    if (mfaResponse) {
      if ((pathname === '/api/auth/mfa/confirm' || pathname === '/api/auth/mfa/disable') && mfaResponse.status === 200) {
        const revoked = new Set((await activeClient.query(`UPDATE auth_sessions SET revoked_at=now()
          WHERE user_id=$1 AND token_hash<>$2 AND revoked_at IS NULL RETURNING token_hash`, [me.id, currentTokenHash])).rows.map(row => row.token_hash));
        for (const [ws, liveToken] of liveClients) if (revoked.has(sha256(liveToken))) { ws.close(1008, 'authentication changed'); liveClients.delete(ws); }
      }
      if (pathname === '/api/auth/mfa/confirm' && mfaResponse.status === 200 && auth.mfa_setup_required) {
        const deviceHash = (await activeClient.query('SELECT device_hash FROM auth_sessions WHERE token_hash=$1', [currentTokenHash])).rows[0]?.device_hash || null;
        await recordLoginAttempt(req, me, me.username, deviceHash, true, 'success');
        afterSave(client => client.query('UPDATE users SET last_login_at=now(),inactive_since=NULL WHERE id=$1', [me.id]));
      }
      return send(res, mfaResponse.status, mfaResponse.data);
    }
    if (pathname === '/api/permissions/matrix' && method === 'GET') return send(res, 200, permissionMatrix());
    const guardedResource = pathname.startsWith('/api/tasks/') || pathname === '/api/tasks' ? 'tasks'
      : pathname.startsWith('/api/task-templates/') || pathname === '/api/task-templates' ? 'task_templates'
      : pathname.startsWith('/api/recurring-series/') || pathname === '/api/recurring-series' ? 'recurring_series' : null;
    if (guardedResource && method !== 'GET') {
      const operation = method === 'DELETE' ? 'delete' : method === 'POST' ? 'create' : 'update';
      if (!canAccess(me, guardedResource, operation === 'create' && pathname.endsWith('/stop') ? 'manage' : operation)) {
        return send(res, 403, { error: "普通成员只能查看学习任务，不能修改任务、模板或重复配置" });
      }
    }
    const accountTasks = db.tasks.filter(task => canUseDependency(task, me));
    const accountTaskIds = new Set(accountTasks.map(task => task.id));
    const linkedTaskVisible = taskId => !taskId || accountTaskIds.has(taskId);
    const noteSourceIds = isAdministrator(me) || !pathname.startsWith('/api/notes') ? null
      : new Set((await activeClient.query('SELECT id FROM sessions WHERE ingested_by=$1', [me.id])).rows.map(row => row.id));
    const linkedRecordView = record => {
      if (!record) return record;
      return { ...record,
        taskId: linkedTaskVisible(record.taskId) ? record.taskId : null,
        ...(noteSourceIds && record.sourceSessionId && !noteSourceIds.has(record.sourceSessionId) ? { sourceSessionId: null } : {}),
      };
    };
    const visibleTask = task => canUseDependency(task, me);
    const taskView = task => {
      if (!task || isAdministrator(me)) return task;
      return {
        ...task,
        dependencyIds: (task.dependencyIds || []).filter(id => accountTaskIds.has(id)),
        blockedBy: (task.blockedBy || []).filter(item => accountTaskIds.has(item.id)),
      };
    };
    const accountActivity = isAdministrator(me) ? db.activity : db.activity.filter(item => item.taskId ? accountTaskIds.has(item.taskId) : item.userId === me.id);
    const accountData = isAdministrator(me) ? db : {
      ...db,
      tasks: accountTasks,
      activity: accountActivity,
      timeEntries: db.timeEntries.filter(item => accountTaskIds.has(item.taskId)),
      taskTrendEvents: db.taskTrendEvents.filter(item => accountTaskIds.has(item.taskId)),
      // Historical snapshots were global; do not present them as a personal average.
      taskTrendSnapshots: [],
    };

    const settingsResponse = await handleSystemSettings({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (settingsResponse) return send(res, settingsResponse.status, settingsResponse.data);
    const accountAuditResponse = await handleAccountAudit({ pathname, method, url, client: activeClient, me });
    if (accountAuditResponse) return send(res, accountAuditResponse.status, accountAuditResponse.data);
    const accountActivityResponse = await handleAccountActivity({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (accountActivityResponse) return send(res, accountActivityResponse.status, accountActivityResponse.data);
    const connectionResponse = await handleModelConnections({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (connectionResponse) return send(res, connectionResponse.status, connectionResponse.data);
    const retentionResponse = await handleRetentionSettings({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (retentionResponse) return send(res, retentionResponse.status, retentionResponse.data);
    const webhookResponse = await handleOutboundWebhooks({ pathname, method, client: activeClient, me, url, readBody: () => readProjectBody(req) });
    if (webhookResponse) return send(res, webhookResponse.status, webhookResponse.data);
    const recycleResponse = await handleRecycleBin({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (recycleResponse) return send(res, recycleResponse.status, recycleResponse.data);
    const quotaResponse = await handleModelQuotas({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (quotaResponse) return send(res, quotaResponse.status, quotaResponse.data);
    const costsResponse = await handleModelCosts({ pathname, method, client: activeClient, me, url });
    if (costsResponse) return send(res, costsResponse.status, costsResponse.data);
    const costBudgetResponse = await handleModelCostBudget({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (costBudgetResponse) return send(res, costBudgetResponse.status, costBudgetResponse.data);
    const rateResponse = await handleModelRateLimits({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (rateResponse) return send(res, rateResponse.status, rateResponse.data);
    if (pathname === '/api/model-call-audit' && method === 'GET' && !canAccess(me, 'model_call_audit', 'read')) {
      return send(res, 403, { error: '仅管理员可查看模型调用审计' });
    }
    const callAuditResponse = await handleModelCallAudit({ pathname, method, client: activeClient, me, url });
    if (callAuditResponse) return send(res, callAuditResponse.status, callAuditResponse.data);
    const modelHealthResponse = await handleModelHealth({ pathname, method, client: activeClient, me });
    if (modelHealthResponse) return send(res, modelHealthResponse.status, modelHealthResponse.data);
    const alertMetricsResponse = await handleAlertMetrics({ pathname, method, client: activeClient, me, url });
    if (alertMetricsResponse) return send(res, alertMetricsResponse.status, alertMetricsResponse.data);
    const alertRulesResponse = await handleAlertRules({ pathname, method, client: activeClient, me, readBody: () => readBody(req), url });
    if (alertRulesResponse) return send(res, alertRulesResponse.status, alertRulesResponse.data);
    const modelSecurityResponse = await handleModelSecurity({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (modelSecurityResponse) return send(res, modelSecurityResponse.status, modelSecurityResponse.data);
    if (pathname === '/api/settings/version' && method === 'GET') {
      void checkLatestRelease();
      return send(res, 200, versionInfo());
    }

    const promptResponse = await handlePrompts({ pathname, method, client: activeClient, me, readBody: () => readBody(req), url });
    if (promptResponse) return send(res, promptResponse.status, promptResponse.data);

    const platformResponse = await handleExperimentPlatform({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (platformResponse) return send(res, platformResponse.status, platformResponse.data);
    const evaluationResponse = await handleExperimentEvaluation({ pathname, method, client: activeClient, me, readBody: () => readBody(req), url });
    if (evaluationResponse) return send(res, evaluationResponse.status, evaluationResponse.data);
    const reviewResponse = await handleEvaluationReviews({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (reviewResponse) return send(res, reviewResponse.status, reviewResponse.data);
    const evaluationScheduleResponse = await handleEvaluationSchedules({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (evaluationScheduleResponse) return send(res, evaluationScheduleResponse.status, evaluationScheduleResponse.data);
    const evaluationReportShareResponse = await handleEvaluationReportSharing({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (evaluationReportShareResponse) return send(res, evaluationReportShareResponse.status, evaluationReportShareResponse.data);
    const sharingResponse = await handleExperimentSharing({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (sharingResponse) return send(res, sharingResponse.status, sharingResponse.data);
    const scheduleResponse = await handleExperimentSchedules({ pathname, method, client: activeClient, me, readBody: () => readBody(req) });
    if (scheduleResponse) return send(res, scheduleResponse.status, scheduleResponse.data);
    const sessionCostResponse = await handleSessionCosts({ pathname, method, client: activeClient, me, url, readBody: () => readBody(req), sessions: db.sessions });
    if (sessionCostResponse) {
      if (method === 'PATCH' && sessionCostResponse.status === 200) saveDb();
      return send(res, sessionCostResponse.status, sessionCostResponse.data);
    }

    if (method === "GET" && pathname === "/api/auth/me") {
      return send(res, 200, { ...publicUser(me), passwordChangeRequired, mfaSetupRequired: auth.mfa_setup_required });
    }
    if (method === "GET" && pathname === "/api/auth/login-history") {
      const items = (await activeClient.query(`SELECT id,ip_address,user_agent,succeeded,reason,created_at
        FROM account_login_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [me.id])).rows;
      return send(res, 200, { items: items.map(item => ({ id: item.id, ipAddress: item.ip_address,
        userAgent: item.user_agent, succeeded: item.succeeded, reason: item.reason, createdAt: item.created_at })) });
    }
    if (method === "POST" && pathname === "/api/auth/password") {
      const body = await readBody(req);
      if (!verifyPassword(body.currentPassword, me.passwordHash)) return send(res, 400, { error: "当前密码不正确" });
      const passwordError = passwordPolicyError(body.newPassword);
      if (passwordError) return send(res, 400, { error: passwordError });
      const recentPasswords = (await activeClient.query("SELECT password_hash FROM password_history WHERE user_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 5", [me.id])).rows;
      if (recentPasswords.some(row => verifyPassword(body.newPassword, row.password_hash))) return send(res, 400, { error: "不能重复使用最近 5 次密码" });
      me.passwordHash = hashPassword(body.newPassword);
      me.updatedAt = nowIso();
      saveDb(db);
      await activeClient.query("INSERT INTO password_history(user_id,password_hash) VALUES($1,$2)", [me.id, me.passwordHash]);
      const token = crypto.randomBytes(32).toString("hex");
      const previousSessions = (await activeClient.query("SELECT token_hash,device_hash FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL", [me.id])).rows;
      const previousTokens = new Set(previousSessions.map(row => row.token_hash));
      const currentDeviceHash = previousSessions.find(row => row.token_hash === currentTokenHash)?.device_hash || sha256(token);
      await revokeUserSessions(me.id);
      for (const [ws, liveToken] of liveClients) if (previousTokens.has(sha256(liveToken))) { ws.close(1008, "authentication expired"); liveClients.delete(ws); }
      const { sessionHours } = await getGlobalSettings(activeClient);
      await activeClient.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at,device_hash,mfa_setup_required) VALUES($1,$2,now()+($3 * interval '1 hour'),$4,$5)", [sha256(token), me.id, sessionHours, currentDeviceHash, auth.mfa_setup_required]);
      return send(res, 200, { token, user: { ...publicUser(me), mfaSetupRequired: auth.mfa_setup_required } });
    }
    if (method === "POST" && pathname === "/api/auth/logout") {
      const token = (req.headers.authorization || "").replace(/^Bearer /, "");
      await activeClient.query("UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1", [sha256(token)]);
      for (const [ws, liveToken] of liveClients) if (liveToken === token) { ws.close(1008, "authentication expired"); liveClients.delete(ws); }
      return send(res, 200, { loggedOut: true });
    }

    if (pathname === "/api/account/review-settings") {
      if (method === "GET") return send(res, 200, { email: me.reviewEmail || "", emailEnabled: Boolean(me.reviewEmailEnabled), smtpConfigured: smtpConfigured() });
      if (method === "PUT") {
        const body = await readBody(req);
        const email = typeof body.email === "string" ? body.email.trim() : "";
        if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return send(res, 400, { error: "邮箱格式无效" });
        if (typeof body.emailEnabled !== "boolean") return send(res, 400, { error: "emailEnabled 必须是布尔值" });
        if (body.emailEnabled && !email) return send(res, 400, { error: "开启邮件提醒前请填写邮箱" });
        me.reviewEmail = email || null;
        me.reviewEmailEnabled = body.emailEnabled;
        me.updatedAt = nowIso();
        saveDb(db);
        afterSave(client => client.query("UPDATE note_review_notifications SET email_status='skipped',email_next_attempt_at=NULL WHERE user_id=$1 AND email_status IN ('pending','failed') AND ($2::boolean=false OR email_to IS DISTINCT FROM $3)", [me.id, body.emailEnabled, email || null]));
        return send(res, 200, { email, emailEnabled: body.emailEnabled, smtpConfigured: smtpConfigured() });
      }
      return send(res, 405, { error: "method not allowed" });
    }
    if (pathname === "/api/note-reviews" && method === "GET") {
      const today = shanghaiDate(new Date());
      const rows = (await activeClient.query("SELECT p.note_id AS id,n.title,p.step,p.generation,to_char(p.due_on,'YYYY-MM-DD') AS due_on,p.last_reviewed_at FROM note_review_progress p JOIN notes n ON n.id=p.note_id AND n.deleted_at IS NULL WHERE p.user_id=$1 AND p.due_on <= $2 ORDER BY p.due_on,n.title", [me.id, today])).rows;
      return send(res, 200, { items: rows.map(row => ({ noteId: row.id, title: row.title, step: row.step, generation: row.generation, dueOn: row.due_on, lastReviewedAt: row.last_reviewed_at })), today });
    }
    const completeReviewRoute = pathname.match(/^\/api\/note-reviews\/([^/]+)\/complete$/);
    if (completeReviewRoute && method === "POST") {
      const body = await readBody(req);
      if (!Number.isInteger(body.generation) || body.generation < 1) return send(res, 400, { error: "generation 无效" });
      const result = await completeNoteReview(activeClient, me.id, completeReviewRoute[1], body.generation);
      if (result.status === "missing") return send(res, 404, { error: "复习计划不存在" });
      if (result.status === "conflict") return send(res, 409, { error: "该笔记已复习或计划已更新，请刷新列表" });
      if (result.status === "early") return send(res, 400, { error: "尚未到复习日期" });
      return send(res, 200, result);
    }
    if (pathname === "/api/notifications" && method === "GET") {
      const items = (await activeClient.query("SELECT r.id,r.note_id AS note_id,n.title,to_char(r.due_on,'YYYY-MM-DD') AS due_on,r.created_at,r.read_at,r.email_status FROM note_review_notifications r JOIN notes n ON n.id=r.note_id AND n.deleted_at IS NULL WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 100", [me.id])).rows;
      const appItems = (await activeClient.query("SELECT id,kind,title,body,target_url,created_at,read_at,email_status FROM app_notifications WHERE user_id=$1 AND show_in_app=true ORDER BY created_at DESC LIMIT 100", [me.id])).rows;
      const unreadNotes = (await activeClient.query("SELECT count(*)::integer AS count FROM note_review_notifications r JOIN notes n ON n.id=r.note_id AND n.deleted_at IS NULL WHERE r.user_id=$1 AND r.read_at IS NULL", [me.id])).rows[0].count;
      const unreadApps = (await activeClient.query("SELECT count(*)::integer AS count FROM app_notifications WHERE user_id=$1 AND show_in_app=true AND read_at IS NULL", [me.id])).rows[0].count;
      const combined = [...items.map(item => ({ id: item.id, kind: "note_review", noteId: item.note_id, title: item.title, dueOn: item.due_on, targetUrl: `/notes/${item.note_id}`, createdAt: item.created_at, readAt: item.read_at, emailStatus: item.email_status })), ...appItems.map(item => ({ id: item.id, kind: item.kind, noteId: null, title: item.title, body: item.body, dueOn: null, targetUrl: item.target_url, createdAt: item.created_at, readAt: item.read_at, emailStatus: item.email_status }))].sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,100);
      return send(res, 200, { items: combined, unread: unreadNotes + unreadApps });
    }
    const readNotificationRoute = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (readNotificationRoute && method === "POST") {
      const result = await activeClient.query("UPDATE note_review_notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id", [readNotificationRoute[1], me.id]);
      if (result.rowCount) return send(res, 200, { id: readNotificationRoute[1], read: true });
      const appResult = await activeClient.query("UPDATE app_notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id", [readNotificationRoute[1], me.id]);
      return appResult.rowCount ? send(res, 200, { id: readNotificationRoute[1], read: true }) : send(res, 404, { error: "通知不存在" });
    }

    const logAction = (type, data) => logActivity(type, { ...data, actor: me });
    const dependencyStates = () => new Map(projectTasks(db.tasks).map(task => [task.id, task.blockedBy.length > 0]));
    const logReleasedDependencies = previous => {
      for (const task of projectTasks(db.tasks)) {
        if (previous.get(task.id) === true && task.blockedBy.length === 0 && task.status !== "blocked") {
          logAction("update", { taskId: task.id, title: task.title, detail: "前置任务已完成或删除，依赖阻塞已解除" });
        }
      }
    };
    const prepareTaskUpdate = (before, values, tasks = db.tasks) => {
      const writable = { ...values };
      if (writable.progress !== undefined) {
        writable.manualProgress = writable.progress;
        delete writable.progress;
      }
      if (writable.tags !== undefined) writable.tags = normalizeTags(writable.tags);
      if (writable.checklist !== undefined) {
        writable.checklist = normalizeChecklist(writable.checklist);
        const uncheckedDone = (before.checklist || []).some(item => item.done && writable.checklist.some(next => next.id === item.id && !next.done));
        if (uncheckedDone && before.status === "done") writable.status = "in_progress";
      }
      if (writable.dependencyIds !== undefined) {
        const error = validateDependencies(tasks, before.id, writable.dependencyIds, me);
        if (error) throw new Error(error);
      }
      const planError = validatePlan(
        writable.plannedStartDate === undefined ? before.plannedStartDate : writable.plannedStartDate,
        writable.dueDate === undefined ? before.dueDate : writable.dueDate,
      );
      if (planError) throw new Error(planError);
      const after = { ...before, ...writable, version: before.version + 1, updatedAt: nowIso() };
      return applyTaskProgress(applyCompletionTransition(before, after, after.updatedAt));
    };

    if (method === "GET" && pathname === "/api/activity/heatmap") {
      try {
        return send(res, 200, { items: activityHeatmap(accountActivity, url.searchParams.get("start"), url.searchParams.get("end")) });
      } catch (error) { return send(res, 400, { error: error.message }); }
    }
    if (method === "GET" && pathname === "/api/activity/day") {
      try {
        return send(res, 200, activityDay(accountActivity, url.searchParams.get("date")));
      } catch (error) { return send(res, 400, { error: error.message }); }
    }

    if (method === "GET" && pathname === "/api/activity") {
      try {
        return send(res, 200, listActivity(accountActivity, isAdministrator(me) ? db.users : [me], Object.fromEntries(url.searchParams)));
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
    }

    if (method === "GET" && pathname === "/api/dashboard/quick-actions") {
      return send(res, 200, quickActionCounts(accountData));
    }
    if (method === "GET" && pathname === "/api/dashboard/quick-preview") {
      try { return send(res, 200, quickPreview(accountData, url.searchParams.get("kind"))); }
      catch (error) { return send(res, 400, { error: error.message }); }
    }

    // ---- stats ----
    if (method === "GET" && pathname === "/api/stats") {
      const start = url.searchParams.get("start") || "";
      const end = url.searchParams.get("end") || "";
      if (Boolean(start) !== Boolean(end) || (start && (!validDateKey(start) || !validDateKey(end) || start > end || (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY > 365))) {
        return send(res, 400, { error: "日期范围无效或超过 366 天" });
      }
      const allTasks = projectTasks(db.tasks).filter(visibleTask).map(task => ({ ...taskView(task), status: task.effectiveStatus }));
      const windowTasks = start ? allTasks.filter(task => {
        const created = dateKey(task.createdAt);
        return created >= start && created <= end;
      }) : allTasks;
      return send(res, 200, computeStats(windowTasks, { start, end, source: accountData, allTasks }));
    }

    // ---- 一次性账号邀请（仅管理员）----
    if (pathname === "/api/users/invitations" || /^\/api\/users\/invitations\/[^/]+\/revoke$/.test(pathname)) {
      if (!canAccess(me, 'accounts', 'manage')) return send(res, 403, { error: "需要管理员权限" });
      if (pathname === "/api/users/invitations" && method === "GET") {
        const items = (await activeClient.query(`SELECT id,username,display_name,role,activation_mode,created_at,expires_at,consumed_at,revoked_at
          FROM account_invitations ORDER BY created_at DESC LIMIT 100`)).rows;
        return send(res, 200, { items: items.map(item => ({ id: item.id, username: item.username, name: item.display_name,
          role: item.role, activationMode: item.activation_mode, createdAt: item.created_at, expiresAt: item.expires_at,
          consumedAt: item.consumed_at, revokedAt: item.revoked_at })) });
      }
      if (pathname === "/api/users/invitations" && method === "POST") {
        const body = await readProjectBody(req);
        if (body.role === "super_admin") return send(res, 400, { error: "SuperAdmin 账号不能通过邀请创建" });
        const username = String(body.username || "").trim();
        const name = String(body.name || "").trim().slice(0, 30);
        const role = body.role === "admin" ? "admin" : "member";
        const activationMode = ["immediate", "first_login", "manual"].includes(body.activationMode) ? body.activationMode : "first_login";
        const expiresInHours = Number(body.expiresInHours ?? 24);
        if (!username || username.length > 30) return send(res, 400, { error: "用户名长度需为 1–30 个字符" });
        if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) return send(res, 400, { error: "邀请有效期需为 1–168 小时" });
        if (db.users.some(user => user.username === username)) return send(res, 409, { error: "用户名已存在" });
        const token = crypto.randomUUID();
        const id = newId();
        await activeClient.query("UPDATE account_invitations SET revoked_at=now() WHERE username=$1 AND consumed_at IS NULL AND revoked_at IS NULL", [username]);
        const created = (await activeClient.query(`INSERT INTO account_invitations(id,token_hash,username,display_name,role,activation_mode,created_by,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8 * interval '1 hour')) RETURNING expires_at`, [id, sha256(token), username, name || null, role, activationMode, me.id, expiresInHours])).rows[0];
        return send(res, 201, { id, token, username, role, activationMode, expiresAt: created.expires_at });
      }
      const revoke = pathname.match(/^\/api\/users\/invitations\/([^/]+)\/revoke$/);
      if (revoke && method === "POST") {
        const result = await activeClient.query("UPDATE account_invitations SET revoked_at=now() WHERE id=$1 AND consumed_at IS NULL AND revoked_at IS NULL RETURNING id", [revoke[1]]);
        if (!result.rowCount) return send(res, 404, { error: "可撤销的邀请不存在" });
        return send(res, 200, { revoked: true, id: revoke[1] });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    // ---- 账号管理（仅管理员）----
    const isUsersPath =
      pathname === "/api/users" || /^\/api\/users\/[^/]+(?:\/(?:restore|permanent))?$/.test(pathname);
    if (isUsersPath) {
      if (!canAccess(me, 'accounts', 'manage')) {
        return send(res, 403, { error: "需要管理员权限" });
      }

      if (pathname === "/api/users") {
        if (method === "GET") {
          const includeDeleted = url.searchParams.get("deleted") === "true";
          const items = db.users.filter(user => Boolean(user.deletedAt) === includeDeleted)
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
            .map(publicUser);
          return send(res, 200, { items });
        }
        if (method === "POST") {
          const body = await readBody(req);
          if (body.role === "super_admin") return send(res, 400, { error: "SuperAdmin 全局唯一，不能直接创建" });
          if (body.superAdminCandidate) return send(res, 400, { error: "请先创建管理员，再由 SuperAdmin 提名候选人" });
          const uname = String(body.username || "").trim();
          const pwd = String(body.password || "");
          if (!uname) return send(res, 400, { error: "username 为必填项" });
          if (!pwd) return send(res, 400, { error: "password 为必填项" });
          const passwordError = passwordPolicyError(pwd);
          if (passwordError) return send(res, 400, { error: passwordError });
          if (body.maxDevices !== undefined && (!Number.isInteger(body.maxDevices) || body.maxDevices < 1 || body.maxDevices > 10)) return send(res, 400, { error: "同时登录设备数需为 1–10" });
          const ipAllowlist = body.ipAllowlist === undefined ? [] : parseLoginIpAllowlist(body.ipAllowlist);
          if (!ipAllowlist) return send(res, 400, { error: "IP 白名单只允许最多 30 个完整 IPv4 或 IPv6 地址" });
          if (db.users.some((u) => u.username === uname)) {
            return send(res, 409, { error: "用户名已存在" });
          }
          const t = nowIso();
          const activationMode = ["immediate", "first_login", "manual"].includes(body.activationMode) ? body.activationMode : "immediate";
          const account = {
            id: newId(), username: uname, passwordHash: hashPassword(pwd),
            name: String(body.name || "").trim() || uname,
            role: body.role === "admin" ? "admin" : "member",
            activationMode,
            maxDevices: body.maxDevices ?? 3,
            ipAllowlist,
            status: body.status === "disabled" ? "disabled" : activationMode === "immediate" ? "active" : "pending",
            activatedAt: body.status === "disabled" || activationMode !== "immediate" ? null : t,
            createdAt: t, updatedAt: t,
          };
          db.users.push(account);
          saveDb(db);
          afterSave(async client => {
            await client.query("INSERT INTO password_history(user_id,password_hash) VALUES($1,$2)", [account.id, account.passwordHash]);
            await initializeUserReviews(client, account.id);
          });
          return send(res, 201, publicUser(account));
        }
        return send(res, 405, { error: "method not allowed" });
      }

      const um = pathname.match(/^\/api\/users\/([^/]+)(?:\/(?:restore|permanent))?$/);
      const index = db.users.findIndex((u) => u.id === um[1]);
      if (index === -1) return send(res, 404, { error: "user not found" });
      const target = db.users[index];
      res.__accountBefore = structuredClone(target);
      const adminCount = () => db.users.filter((u) => u.role === "admin" && !u.deletedAt).length;
      if (target.role === "super_admin" && !canAccess(me, 'accounts', 'update', { ownerId: target.id, targetRole: target.role })) {
        return send(res, 403, { error: "只有 SuperAdmin 本人可维护该账号" });
      }

      if (pathname.endsWith("/restore") && method === "POST") {
        if (!target.deletedAt) return send(res, 409, { error: "账号不在回收站" });
        target.status = target.statusBeforeDelete || "disabled";
        target.deletedAt = null;
        target.statusBeforeDelete = null;
        target.updatedAt = nowIso();
        if (target.status === "active") pauseAccountRecurrences(target.id, false);
        await activeClient.query("DELETE FROM login_security_state WHERE user_id=$1", [target.id]);
        saveDb(db);
        return send(res, 200, publicUser(target));
      }
      if (pathname.endsWith("/permanent") && method === "POST") {
        if (!target.deletedAt) return send(res, 409, { error: "请先将账号移入回收站" });
        const body = await readProjectBody(req);
        if (body.confirmUsername !== target.username) return send(res, 400, { error: "确认用户名不匹配" });
        db.recurringSeries = db.recurringSeries.filter(series => series.ownerId !== target.id);
        db.taskTemplates = db.taskTemplates.filter(template => template.ownerId !== target.id);
        await activeClient.query("DELETE FROM experiment_schedules WHERE owner_id=$1", [target.id]);
        db.users.splice(index, 1);
        saveDb(db);
        return send(res, 200, { purged: true, id: target.id });
      }
      if (target.deletedAt) return send(res, 410, { error: "账号已删除，请先恢复" });

      if (method === "PUT" || method === "PATCH") {
        const body = await readBody(req);
        if (body.role === "super_admin" && target.role !== "super_admin") return send(res, 400, { error: "SuperAdmin 全局唯一，不能直接授予" });
        if (target.role === "super_admin" && ((body.role && body.role !== "super_admin") || (body.status && body.status !== "active"))) {
          return send(res, 403, { error: "SuperAdmin 不能降级或停用" });
        }
        if (body.superAdminCandidate !== undefined) {
          if (!isSuperAdmin(me)) return send(res, 403, { error: "只有 SuperAdmin 可管理候选人" });
          if (typeof body.superAdminCandidate !== "boolean") return send(res, 400, { error: "候选人标记必须为布尔值" });
        }
        const nextRole = body.role === "admin" || body.role === "member" ? body.role : target.role;
        const nextCandidate = body.superAdminCandidate ?? Boolean(target.superAdminCandidate);
        if (nextCandidate && nextRole !== "admin") return send(res, 400, { error: "只有管理员账号可被提名为 SuperAdmin 候选人" });
        if (body.maxDevices !== undefined && (!Number.isInteger(body.maxDevices) || body.maxDevices < 1 || body.maxDevices > 10)) return send(res, 400, { error: "同时登录设备数需为 1–10" });
        const ipAllowlist = body.ipAllowlist === undefined ? undefined : parseLoginIpAllowlist(body.ipAllowlist);
        if (body.ipAllowlist !== undefined && !ipAllowlist) return send(res, 400, { error: "IP 白名单只允许最多 30 个完整 IPv4 或 IPv6 地址" });
        if (target.id === me.id && ipAllowlist?.length && !ipAllowlist.includes(requestLoginIp(req))) {
          return send(res, 400, { error: "当前连接 IP 不在白名单中，不能将自己锁在账号外" });
        }
        const changingPassword = typeof body.password === "string" && body.password.length > 0;
        if (changingPassword) {
          const passwordError = passwordPolicyError(body.password);
          if (passwordError) return send(res, 400, { error: passwordError });
          const recentPasswords = (await activeClient.query("SELECT password_hash FROM password_history WHERE user_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 5", [target.id])).rows;
          if (recentPasswords.some(row => verifyPassword(body.password, row.password_hash))) return send(res, 400, { error: "不能重复使用最近 5 次密码" });
        }
        if (typeof body.name === "string" && body.name.trim()) {
          target.name = body.name.trim();
        }
        if (body.maxDevices !== undefined) {
          target.maxDevices = body.maxDevices;
        }
        if (ipAllowlist) target.ipAllowlist = ipAllowlist;
        if (body.role === "admin" || body.role === "member") {
          if (target.role === "admin" && body.role !== "admin" && adminCount() <= 1) {
            return send(res, 400, { error: "不能降级唯一的管理员" });
          }
          if (target.role !== body.role) await revokeUserSessions(target.id);
          target.role = body.role;
        }
        if (body.superAdminCandidate !== undefined) target.superAdminCandidate = body.superAdminCandidate;
        if (body.status === "active" || body.status === "disabled") {
          if (target.username === me.username && body.status === "disabled") {
            return send(res, 400, { error: "不能禁用当前登录账号" });
          }
          target.status = body.status;
          if (body.status === "active" && !target.activatedAt) target.activatedAt = nowIso();
          pauseAccountRecurrences(target.id, body.status !== "active");
          // 禁用后失效其现有 token
          if (body.status === "disabled") {
            await revokeUserSessions(target.id);
            await activeClient.query("UPDATE experiment_schedules SET active=false WHERE owner_id=$1", [target.id]);
            await activeClient.query("UPDATE evaluation_schedules SET active=false WHERE owner_id=$1", [target.id]);
          }
        }
        if (changingPassword) {
          target.passwordHash = hashPassword(body.password);
          await activeClient.query("INSERT INTO password_history(user_id,password_hash) VALUES($1,$2)", [target.id, target.passwordHash]);
          await revokeUserSessions(target.id);
        }
        target.updatedAt = nowIso();
        db.users[index] = target;
        saveDb(db);
        if (body.maxDevices !== undefined) await enforceDeviceLimit(target);
        return send(res, 200, publicUser(target));
      }

      if (method === "DELETE") {
        if (target.role === "super_admin") return send(res, 403, { error: "SuperAdmin 不能删除" });
        if (target.username === me.username) {
          return send(res, 400, { error: "不能删除当前登录账号" });
        }
        if (target.role === "admin" && adminCount() <= 1) {
          return send(res, 400, { error: "不能删除唯一的管理员" });
        }
        target.statusBeforeDelete = target.status;
        target.status = "disabled";
        target.deletedAt = nowIso();
        target.updatedAt = target.deletedAt;
        pauseAccountRecurrences(target.id, true);
        await activeClient.query("UPDATE experiment_schedules SET active=false WHERE owner_id=$1", [target.id]);
        await activeClient.query("UPDATE evaluation_schedules SET active=false WHERE owner_id=$1", [target.id]);
        await revokeUserSessions(target.id);
        saveDb(db);
        return send(res, 200, { deleted: true, id: target.id });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    // A task ID must never bypass the same owner boundary through a subroute.
    const taskPath = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/|$)/);
    if (taskPath && !["bulk", "import", "import-csv", "dependency-options"].includes(taskPath[1])) {
      const target = db.tasks.find(task => task.id === taskPath[1]);
      if (!target || !visibleTask(target)) return send(res, 404, { error: "任务不存在" });
    }

    // ---- task templates ----
    if (pathname === "/api/task-templates") {
      if (method === "GET") return send(res, 200, { items: [...PRESET_TEMPLATES, ...db.taskTemplates.filter(item => item.ownerId === me.id)] });
      if (method === "POST") {
        const body = await readBody(req);
        const source = db.tasks.find(item => item.id === body.taskId);
        if (!source || !visibleTask(source)) return send(res, 404, { error: "来源任务不存在" });
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
        if (!name) return send(res, 400, { error: "模板名称不能为空" });
        const template = { id: newId(), ownerId: me.id, name, description: source.description || "", defaultPhase: source.phase || "基础", defaultPriority: source.priority || "medium", checklist: (source.checklist || []).map(item => item.text), suggestedResources: source.resources || [] };
        db.taskTemplates.push(template);
        saveDb(db);
        return send(res, 201, template);
      }
      return send(res, 405, { error: "method not allowed" });
    }

    if (pathname === "/api/tasks/dependency-options" && method === "GET") {
      const exclude = url.searchParams.get("exclude") || "";
      return send(res, 200, { items: projectTasks(db.tasks).filter(task => task.id !== exclude && canUseDependency(task, me)).map(task => ({ id: task.id, title: task.title, status: task.effectiveStatus })) });
    }

    // ---- recurring series ----
    if (pathname === "/api/recurring-series" && method === "POST") {
      const body = await readBody(req);
      const task = db.tasks.find(item => item.id === body.taskId);
      if (!task || !visibleTask(task)) return send(res, 404, { error: "任务不存在" });
      if (task.recurringSeriesId) return send(res, 409, { error: "该任务已有重复序列" });
      const series = createSeries(task, body);
      task.recurringSeriesId = series.id;
      task.recurrenceIndex = 1;
      task.version += 1;
      task.updatedAt = nowIso();
      db.recurringSeries.push(series);
      saveDb(db);
      scheduleRecurrences(0);
      return send(res, 201, seriesView(series));
    }
    const seriesRoute = pathname.match(/^\/api\/recurring-series\/([^/]+)(?:\/(stop))?$/);
    if (seriesRoute) {
      const series = db.recurringSeries.find(item => item.id === seriesRoute[1]);
      if (!series) return send(res, 404, { error: "重复序列不存在" });
      if (!canAccess(me, 'recurring_series', method === 'GET' ? 'read' : 'update', { ownerId: series.ownerId })) return send(res, 403, { error: "无权访问该重复序列" });
      if (method === "GET" && !seriesRoute[2]) return send(res, 200, seriesView(series));
      if (method === "POST" && seriesRoute[2] === "stop") {
        if (series.active) { series.active = false; series.version = (series.version || 1) + 1; series.updatedAt = nowIso(); saveDb(db); scheduleRecurrences(0); }
        return send(res, 200, seriesView(series));
      }
      if (method === "PUT" && !seriesRoute[2]) {
        if (!series.active) return send(res, 409, { error: "重复序列已停止" });
        const body = await readBody(req);
        if (body.version !== (series.version || 1)) return send(res, 409, { error: "重复配置已变化，请刷新后重试" });
        const source = db.tasks.find(item => item.id === body.taskId && item.recurringSeriesId === series.id);
        if (!source) return send(res, 400, { error: "请选择该序列中的任务作为复制来源" });
        const updated = updateSeries(series, body, source, { updateSnapshot: body.updateSnapshot === true });
        Object.assign(series, updated, { version: (series.version || 1) + 1 });
        saveDb(db);
        scheduleRecurrences(0);
        return send(res, 200, seriesView(series));
      }
      return send(res, 405, { error: "method not allowed" });
    }

    // ---- tasks ----
    if (pathname === "/api/tasks") {
      if (method === "GET") {
        const status = url.searchParams.get("status");
        const category = url.searchParams.get("category");
        const phase = url.searchParams.get("phase");
        const tags = url.searchParams.getAll("tag");
        const keyword = (url.searchParams.get("keyword") || "").trim().toLowerCase();
        let list = projectTasks(db.tasks).filter(visibleTask);
        if (status) list = list.filter((t) => t.effectiveStatus === status);
        if (category) list = list.filter((t) => t.category === category);
        if (phase) list = list.filter((t) => t.phase === phase);
        if (tags.length) list = list.filter(t => tags.every(tag => (t.tags || []).includes(tag)));
        if (keyword) {
          list = list.filter((t) =>
            t.title.toLowerCase().includes(keyword) ||
            (t.description || "").toLowerCase().includes(keyword) ||
            (t.notes || "").toLowerCase().includes(keyword));
        }
        list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        const ids = new Set(list.map(task => task.recurringSeriesId).filter(Boolean));
        return send(res, 200, { total: list.length, items: list.map(taskView), recurringSeries: Object.fromEntries(db.recurringSeries.filter(series => ids.has(series.id)).map(series => [series.id, seriesView(series)])), categories: [...new Set(accountTasks.map(task => task.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")), tags: [...new Set([...PRESET_TAGS, ...accountTasks.flatMap(task => task.tags || [])])] });
      }
      if (method === "POST") {
        const body = await readBody(req);
        const w = pickTaskWritable(body);
        if (!w.title) return send(res, 400, { error: "title 为必填项" });
        const dependencyIds = w.dependencyIds === undefined ? [] : w.dependencyIds;
        const dependencyError = validateDependencies(db.tasks, null, dependencyIds, me);
        if (dependencyError) return send(res, 400, { error: dependencyError });
        const planError = validatePlan(w.plannedStartDate, w.dueDate);
        if (planError) return send(res, 400, { error: planError });
        const t = nowIso();
        const task = {
          id: newId(), title: w.title, description: w.description || "",
          category: w.category || "未分类", phase: w.phase || "基础",
          status: w.status || "todo", progress: w.progress ?? 0,
          manualProgress: w.progress ?? 0, checklist: normalizeChecklist(body.checklist), version: 1,
          priority: w.priority || "medium", dueDate: w.dueDate || "",
          plannedStartDate: w.plannedStartDate || "", dependencyIds, ownerId: me.id,
          notes: w.notes || "", resources: w.resources || [], tags: w.tags || [],
          estimatedHours: w.estimatedHours ?? null, completionCycles: [], activeCycleStartedAt: t, legacyCompletionUnknown: false,
          createdAt: t, updatedAt: t,
        };
        applyCompletionTransition({ ...task, status: "todo" }, task, t);
        applyTaskProgress(task);
        if (body.recurrence?.enabled) {
          const series = createSeries(task, body.recurrence);
          task.recurringSeriesId = series.id;
          task.recurrenceIndex = 1;
          db.recurringSeries.push(series);
        }
        db.tasks.push(task);
        recordTaskTrendEvent(db, "create", task.id, t);
        if (task.status === "done") recordTaskTrendEvent(db, "complete", task.id, t);
        recordTaskTrendSnapshot(db, t);
        logAction("create", { taskId: task.id, title: task.title, detail: "创建任务" });
        saveDb(db);
        if (task.recurringSeriesId) scheduleRecurrences(0);
        return send(res, 201, taskView(projectTasks(db.tasks).find(item => item.id === task.id)));
      }
      return send(res, 405, { error: "method not allowed" });
    }

    if (method === "POST" && pathname === "/api/tasks/import-csv/preview") {
      const body = await readBody(req);
      const prepared = prepareCsvImport(db, body.rows, me, true);
      return send(res, 200, { importable: prepared.imported, invalid: prepared.skipped, errors: prepared.errors });
    }

    // CSV 专用批量导入；先完整校验，再一次性提交。
    if (method === "POST" && pathname === "/api/tasks/import-csv") {
      const body = await readBody(req);
      const prepared = prepareCsvImport(db, body.rows, me, body.skipInvalid === true);
      if (prepared.blocked) return send(res, 422, { error: "存在无效行，请修正或选择跳过", imported: 0, skipped: prepared.skipped, errors: prepared.errors });
      if (prepared.tasks.length) {
        db.tasks.push(...prepared.tasks);
        db.recurringSeries.push(...prepared.series);
        const at = nowIso();
        for (const task of prepared.tasks) {
          recordTaskTrendEvent(db, "create", task.id, at);
          if (task.status === "done") recordTaskTrendEvent(db, "complete", task.id, at);
        }
        recordTaskTrendSnapshot(db, at);
        logAction("create", { title: `CSV 导入 ${prepared.imported} 条任务`, detail: "CSV 批量导入", actor: me });
        saveDb(db);
      }
      return send(res, 200, { imported: prepared.imported, skipped: prepared.skipped, errors: prepared.errors });
    }

    // 批量导入
    if (method === "POST" && pathname === "/api/tasks/import") {
      const body = await readBody(req);
      const arr = Array.isArray(body.tasks) ? body.tasks : [];
      const t = nowIso();
      let added = 0;
      for (const raw of arr) {
        if (!raw || typeof raw.title !== "string" || !raw.title.trim()) continue;
        const w = pickTaskWritable(raw);
        if (validatePlan(w.plannedStartDate, w.dueDate)) continue;
        db.tasks.push({
          id: newId(), title: w.title, description: w.description || "",
          category: w.category || "未分类", phase: w.phase || "基础",
          status: w.status || "todo", progress: w.progress ?? 0,
          manualProgress: w.progress ?? 0, checklist: normalizeChecklist(raw.checklist), version: 1,
          priority: w.priority || "medium", dueDate: w.dueDate || "",
          plannedStartDate: w.plannedStartDate || "", dependencyIds: [], ownerId: me.id,
          notes: w.notes || "", resources: w.resources || [], tags: w.tags || [],
          estimatedHours: w.estimatedHours ?? null, completionCycles: [], activeCycleStartedAt: t, legacyCompletionUnknown: false,
          createdAt: t, updatedAt: t,
        });
        const imported = applyTaskProgress(db.tasks.at(-1));
        applyCompletionTransition({ ...imported, status: "todo" }, imported, t);
        recordTaskTrendEvent(db, "create", imported.id, t);
        if (imported.status === "done") recordTaskTrendEvent(db, "complete", imported.id, t);
        added++;
      }
      recordTaskTrendSnapshot(db, t);
      logAction("create", { title: `导入 ${added} 条任务`, detail: "批量导入" });
      saveDb(db);
      return send(res, 200, { added });
    }

    if (method === "POST" && pathname === "/api/tasks/bulk") {
      const body = await readBody(req);
      const ids = body.ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) {
        return send(res, 400, { error: "请选择不重复的任务" });
      }
      if (body.action !== "update" && body.action !== "delete") return send(res, 400, { error: "批量操作类型无效" });
      let values = null;
      if (body.action === "update") {
        const keys = Object.keys(body.changes || {});
        const allowed = ["status", "category", "phase", "priority", "dueDate"];
        if (keys.length !== 1 || !allowed.includes(keys[0])) return send(res, 400, { error: "每次只能批量修改一个支持的字段" });
        values = pickTaskWritable(body.changes);
        if (!Object.hasOwn(values, keys[0])) return send(res, 400, { error: "批量修改值无效" });
      }
      const issues = [];
      const original = new Map(db.tasks.map(task => [task.id, task]));
      const draft = structuredClone(db.tasks);
      for (const id of ids) {
        const before = original.get(id);
        if (!before || !visibleTask(before)) issues.push({ taskId: id, reason: "任务不存在" });
        else if (!Number.isInteger(body.versions?.[id]) || body.versions[id] !== before.version) issues.push({ taskId: id, reason: "任务版本已变化，请刷新后重试" });
        else if (body.action === "update") {
          try {
            const index = draft.findIndex(task => task.id === id);
            draft[index] = prepareTaskUpdate(draft[index], values, draft);
          } catch (error) {
            issues.push({ taskId: id, reason: error instanceof Error ? error.message : "校验失败" });
          }
        }
      }
      if (issues.length) return send(res, 409, { error: "整批操作已取消", successCount: 0, failedCount: ids.length, errors: issues });
      const previousStates = dependencyStates();
      const operationId = newId();
      const selected = new Set(ids);
      if (body.action === "update") {
        db.tasks = draft;
        for (const id of ids) {
          const before = original.get(id);
          const after = db.tasks.find(task => task.id === id);
          recordTaskChanges(db, before, after, me, { operationId });
          if (after.status === "done" && before.status !== "done") recordTaskTrendEvent(db, "complete", id, after.updatedAt);
          logAction(after.status === "done" && before.status !== "done" ? "complete" : "update", { taskId: id, title: after.title, detail: `批量修改 ${Object.keys(values)[0]}` });
        }
      } else {
        db.tasks = draft.filter(task => !selected.has(task.id));
        db.timeEntries = db.timeEntries.filter(entry => !selected.has(entry.taskId));
        for (const task of db.tasks) {
          const nextIds = (task.dependencyIds || []).filter(id => !selected.has(id));
          if (nextIds.length !== (task.dependencyIds || []).length) {
            const before = original.get(task.id);
            task.dependencyIds = nextIds;
            task.version += 1;
            task.updatedAt = nowIso();
            recordTaskChanges(db, before, task, me, { operationId });
          }
        }
        for (const id of ids) logAction("delete", { taskId: id, title: original.get(id).title, detail: "批量删除任务" });
      }
      recordTaskTrendSnapshot(db);
      logReleasedDependencies(previousStates);
      saveDb(db);
      return send(res, 200, { successCount: ids.length, failedCount: 0, errors: [] });
    }

    const single = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (single) {
      const id = single[1];
      const index = db.tasks.findIndex((t) => t.id === id);
      if (index === -1) return send(res, 404, { error: "task not found" });

      if (method === "GET") return send(res, 200, taskView(projectTasks(db.tasks)[index]));

      if (method === "PUT" || method === "PATCH") {
        const body = await readBody(req);
        const w = pickTaskWritable(body);
        const before = db.tasks[index];
        let after;
        try { after = prepareTaskUpdate(before, w); }
        catch (error) { return send(res, 400, { error: error.message }); }
        let nextSeries = null;
        let existingSeries = null;
        if (body.recurrence !== undefined) {
          if (!body.recurrence || typeof body.recurrence.enabled !== "boolean") return send(res, 400, { error: "重复配置无效" });
          existingSeries = db.recurringSeries.find(series => series.id === before.recurringSeriesId) || null;
          if (existingSeries && !isAdministrator(me) && existingSeries.ownerId !== me.id) return send(res, 403, { error: "无权修改该重复序列" });
          if (body.recurrence.enabled) {
            if (existingSeries && !existingSeries.active) return send(res, 409, { error: "重复序列已停止" });
            if (existingSeries && body.recurrence.version !== (existingSeries.version || 1)) return send(res, 409, { error: "重复配置已变化，请刷新后重试" });
            try { nextSeries = existingSeries ? updateSeries(existingSeries, body.recurrence, after, { updateSnapshot: body.recurrence.updateSnapshot === true }) : createSeries(after, body.recurrence); }
            catch (error) { return send(res, 400, { error: error.message }); }
          }
        }
        const previousStates = dependencyStates();
        if (body.recurrence !== undefined) {
          if (nextSeries && existingSeries) Object.assign(existingSeries, nextSeries, { version: (existingSeries.version || 1) + 1 });
          else if (nextSeries) { db.recurringSeries.push(nextSeries); after.recurringSeriesId = nextSeries.id; after.recurrenceIndex = 1; }
          else if (existingSeries && existingSeries.active) { existingSeries.active = false; existingSeries.version = (existingSeries.version || 1) + 1; existingSeries.updatedAt = nowIso(); }
        }
        db.tasks[index] = after;
        recordTaskChanges(db, before, after, me);
        if (after.status === "done" && before.status !== "done") recordTaskTrendEvent(db, "complete", id, after.updatedAt);
        recordTaskTrendSnapshot(db, after.updatedAt);
        if (w.status && w.status !== before.status) {
          logAction(w.status === "done" ? "complete" : "update", {
            taskId: id, title: after.title,
            detail: w.status === "done" ? "标记为已完成" : `状态改为 ${w.status}`,
          });
        } else {
          logAction("update", { taskId: id, title: after.title, detail: "更新任务" });
        }
        logReleasedDependencies(previousStates);
        saveDb(db);
        if (body.recurrence !== undefined) scheduleRecurrences(0);
        return send(res, 200, taskView(projectTasks(db.tasks)[index]));
      }

      if (method === "DELETE") {
        const previousStates = dependencyStates();
        const [removed] = db.tasks.splice(index, 1);
        for (const task of db.tasks) {
          if ((task.dependencyIds || []).includes(id)) {
            const before = structuredClone(task);
            task.dependencyIds = task.dependencyIds.filter(dependency => dependency !== id);
            task.version += 1;
            task.updatedAt = nowIso();
            recordTaskChanges(db, before, task, me);
          }
        }
        recordTaskTrendSnapshot(db);
        logAction("delete", { taskId: id, title: removed.title, detail: "删除任务" });
        logReleasedDependencies(previousStates);
        saveDb(db);
        return send(res, 200, { deleted: true, id: removed.id });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    const timeEntriesRoute = pathname.match(/^\/api\/tasks\/([^/]+)\/time-entries$/);
    if (timeEntriesRoute) {
      const task = db.tasks.find(item => item.id === timeEntriesRoute[1]);
      if (!task) return send(res, 404, { error: "任务不存在" });
      if (method === "GET") {
        const items = db.timeEntries.filter(item => item.taskId === task.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return send(res, 200, { items, actualMinutes: actualMinutes(db.timeEntries, task.id) });
      }
      if (method === "POST") {
        const body = await readBody(req);
        let values;
        try { values = normalizeTimeEntry(body); }
        catch (error) { return send(res, 400, { error: error.message }); }
        const at = nowIso();
        const entry = { id: newId(), taskId: task.id, recordedBy: me.id, recordedByName: me.name || me.username, ...values, createdAt: at, updatedAt: at };
        db.timeEntries.unshift(entry);
        saveDb(db);
        return send(res, 201, entry);
      }
      return send(res, 405, { error: "method not allowed" });
    }

    const timeEntryRoute = pathname.match(/^\/api\/tasks\/([^/]+)\/time-entries\/([^/]+)$/);
    if (timeEntryRoute) {
      const entry = db.timeEntries.find(item => item.taskId === timeEntryRoute[1] && item.id === timeEntryRoute[2]);
      if (!entry) return send(res, 404, { error: "工时记录不存在" });
      if (entry.recordedBy !== me.id && !isAdministrator(me)) return send(res, 403, { error: "只能修改自己的工时记录" });
      if (method === "PUT") {
        const body = await readBody(req);
        let values;
        try { values = normalizeTimeEntry(body); }
        catch (error) { return send(res, 400, { error: error.message }); }
        Object.assign(entry, values, { updatedAt: nowIso() });
        saveDb(db);
        return send(res, 200, entry);
      }
      if (method === "DELETE") {
        db.timeEntries = db.timeEntries.filter(item => item.id !== entry.id);
        saveDb(db);
        return send(res, 200, { deleted: true, id: entry.id });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    const checklistRoute = pathname.match(/^\/api\/tasks\/([^/]+)\/checklist$/);
    if (checklistRoute && method === "PUT") {
      const task = db.tasks.find(item => item.id === checklistRoute[1]);
      if (!task) return send(res, 404, { error: "task not found" });
      const body = await readBody(req);
      if (!Number.isInteger(body.version)) return send(res, 400, { error: "version 为必填整数" });
      if (body.version !== task.version) return send(res, 409, { error: "任务已被其他操作修改，请加载最新版本后重试", latest: task });
      const next = normalizeChecklist(body.checklist);
      const before = structuredClone(task);
      const after = prepareTaskUpdate(task, { checklist: next });
      db.tasks[db.tasks.indexOf(task)] = after;
      recordTaskChanges(db, before, after, me);
      recordTaskTrendSnapshot(db, after.updatedAt);
      logAction("update", { taskId: after.id, title: after.title, detail: before.status !== after.status ? "取消已完成检查项，状态恢复为进行中" : "更新检查清单" });
      saveDb(db);
      return send(res, 200, taskView(projectTasks(db.tasks).find(item => item.id === after.id)));
    }

    const tagsRoute = pathname.match(/^\/api\/tasks\/([^/]+)\/tags$/);
    if (tagsRoute && method === "PUT") {
      const task = db.tasks.find(item => item.id === tagsRoute[1]);
      if (!task) return send(res, 404, { error: "task not found" });
      const body = await readBody(req);
      if (!Number.isInteger(body.version)) return send(res, 400, { error: "version 为必填整数" });
      if (body.version !== task.version) return send(res, 409, { error: "任务已被其他操作修改，请加载最新版本后重试", latest: taskView(projectTasks(db.tasks).find(item => item.id === task.id)) });
      const before = structuredClone(task);
      const after = prepareTaskUpdate(task, { tags: body.tags });
      db.tasks[db.tasks.indexOf(task)] = after;
      recordTaskChanges(db, before, after, me);
      logAction("update", { taskId: after.id, title: after.title, detail: "更新任务标签" });
      saveDb(db);
      return send(res, 200, taskView(projectTasks(db.tasks).find(item => item.id === after.id)));
    }

    const historyRoute = pathname.match(/^\/api\/tasks\/([^/]+)\/change-logs$/);
    if (historyRoute && method === "GET") {
      const task = db.tasks.find(item => item.id === historyRoute[1]);
      if (!task) return send(res, 404, { error: "任务不存在" });
      const legacyIds = new Set(db.legacyActivityIds);
      return send(res, 200, {
        items: db.changeLogs.filter(item => item.taskId === task.id).sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
        legacyItems: db.activity.filter(item => item.taskId === task.id && legacyIds.has(item.id)),
      });
    }

    const rollbackRoute = pathname.match(/^\/api\/tasks\/([^/]+)\/change-logs\/([^/]+)\/rollback$/);
    if (rollbackRoute && method === "POST") {
      const task = db.tasks.find(item => item.id === rollbackRoute[1]);
      const entry = db.changeLogs.find(item => item.id === rollbackRoute[2] && item.taskId === rollbackRoute[1]);
      if (!task || !entry) return send(res, 404, { error: "任务或历史记录不存在" });
      const body = await readBody(req);
      if (!Number.isInteger(body.version) || body.version !== task.version) {
        return send(res, 409, { error: "任务已被其他操作修改，请刷新后重试", latest: taskView(projectTasks(db.tasks).find(item => item.id === task.id)) });
      }
      if (!AUDITED_TASK_FIELDS.includes(entry.fieldName)) return send(res, 400, { error: "该字段不可回滚" });
      if (JSON.stringify(task[entry.fieldName]) === JSON.stringify(entry.oldValue)) return send(res, 409, { error: "该字段当前已是目标值" });
      let after;
      try { after = prepareTaskUpdate(task, { [entry.fieldName]: structuredClone(entry.oldValue) }); }
      catch (error) { return send(res, 400, { error: error.message }); }
      const previousStates = dependencyStates();
      db.tasks[db.tasks.indexOf(task)] = after;
      recordTaskChanges(db, task, after, me, { action: "rollback", sourceEntryId: entry.id });
      if (after.status === "done" && task.status !== "done") recordTaskTrendEvent(db, "complete", task.id, after.updatedAt);
      recordTaskTrendSnapshot(db, after.updatedAt);
      logAction("update", { taskId: task.id, title: after.title, detail: `回滚 ${entry.fieldName}` });
      logReleasedDependencies(previousStates);
      saveDb(db);
      return send(res, 200, taskView(projectTasks(db.tasks).find(item => item.id === task.id)));
    }

    // 单任务审计
    const taskAct = pathname.match(/^\/api\/tasks\/([^/]+)\/activity$/);
    if (taskAct && method === "GET") {
      const list = db.activity.filter((a) => a.taskId === taskAct[1]);
      return send(res, 200, { items: list });
    }

    // ---- sessions ----
    const visibleSessionIds = async () => isAdministrator(me) ? null : new Set((await activeClient.query('SELECT id FROM sessions WHERE ingested_by=$1', [me.id])).rows.map(row => row.id));
    const sessionUsage = session => {
      const reported = session.messages.filter(item => item.role === 'assistant' && item.usage);
      if (!reported.length) return null;
      const promptTokens = reported.reduce((sum, item) => sum + item.usage.promptTokens, 0);
      const completionTokens = reported.reduce((sum, item) => sum + item.usage.completionTokens, 0);
      return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, reportedMessages: reported.length };
    };
    const sessionTitle = session => (session.messages.find(item => item.role === 'user')?.content || '（无标题）').slice(0, 40);
    const annotationRoute = pathname.match(/^\/api\/sessions\/([^/]+)\/messages\/([^/]+)\/annotation$/);
    if (annotationRoute && method === "POST") {
      const allowedSessions = await visibleSessionIds();
      if (allowedSessions && !allowedSessions.has(annotationRoute[1])) return send(res, 404, { error: '消息不存在' });
      const session = db.sessions.find(item => item.id === annotationRoute[1]);
      const target = session?.messages.find(item => item.id === annotationRoute[2]);
      if (!target) return send(res, 404, { error: "消息不存在" });
      if (target.role !== "assistant") return send(res, 422, { error: "只能标注 assistant 消息" });
      const body = await readBody(req);
      const allowedTags = ["准确", "不准确", "偏题", "幻觉", "过于冗长", "过于简略", "格式错误"];
      if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5 || !Array.isArray(body.tags) || body.tags.some(tag => !allowedTags.includes(tag))) return send(res, 422, { error: "评分或标签无效" });
      const tags = [...new Set(body.tags)];
      const at = nowIso();
      const result = await activeClient.query("INSERT INTO message_annotations(id,session_id,message_id,reviewer_id,rating,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT (session_id,message_id,reviewer_id) WHERE reviewer_id IS NOT NULL DO UPDATE SET rating=EXCLUDED.rating,updated_at=EXCLUDED.updated_at RETURNING id", [newId(), session.id, target.id, me.id, body.rating, at]);
      const id = result.rows[0].id;
      await activeClient.query("DELETE FROM annotation_tags WHERE annotation_id=$1", [id]);
      for (const tag of tags) await activeClient.query("INSERT INTO annotation_tags(annotation_id,tag) VALUES($1,$2)", [id, tag]);
      const messageIndex = session.messages.findIndex(item => item.id === target.id);
      const userIndex = session.messages.slice(0, messageIndex).findLastIndex(item => item.role === 'user');
      if (userIndex >= 0) await syncEvaluationCandidate(activeClient, { sourceType: 'session', annotationId: id, sourceEntityId: `${session.id}:${target.id}`, rating: body.rating, input: session.messages[userIndex].content, expected: target.content, context: session.messages.slice(0, userIndex).map(item => ({ role: item.role, parts: [{ type: 'text', text: item.content }] })), tags });
      const annotation = await annotationView(activeClient, session.id, target.id, me.id);
      return send(res, 200, annotation);
    }
    if (pathname === "/api/sessions" && method === "GET") {
      const allowedSessions = await visibleSessionIds();
      const quality = url.searchParams.get('quality');
      if (quality && !['rejection', 'excessive_length'].includes(quality)) return send(res, 400, { error: '质量标记类型无效' });
      const clusterId = url.searchParams.get('clusterId');
      const clusterRows = (await activeClient.query(`SELECT s.id,s.cluster_id,CASE WHEN $1 THEN c.label ELSE concat('主题 ',left(c.id,6)) END AS cluster_label FROM sessions s LEFT JOIN session_clusters c ON c.id=s.cluster_id`, [isAdministrator(me)])).rows;
      const clustersBySession = new Map(clusterRows.map(row => [row.id, row]));
      if (clusterId && !(await activeClient.query('SELECT 1 FROM session_clusters WHERE id=$1', [clusterId])).rowCount) return send(res, 400, { error: '主题聚类不存在' });
      const flagRows = (await activeClient.query("SELECT session_id,flag_type FROM session_quality_flags ORDER BY session_id, CASE flag_type WHEN 'rejection' THEN 0 ELSE 1 END")).rows;
      const qualityBySession = new Map();
      for (const row of flagRows) {
        if (!qualityBySession.has(row.session_id)) qualityBySession.set(row.session_id, new Set());
        qualityBySession.get(row.session_id).add(row.flag_type);
      }
      const items = db.sessions.filter(s => !allowedSessions || allowedSessions.has(s.id)).map(s => {
        const usage = sessionUsage(s);
        return { id: s.id, userId: s.userId, createdAt: s.createdAt, updatedAt: s.updatedAt,
          messageCount: s.messages.length, title: sessionTitle(s), totalTokens: usage?.totalTokens ?? null,
          qualityFlags: [...(qualityBySession.get(s.id) || [])], clusterId: clustersBySession.get(s.id)?.cluster_id || null,
          clusterLabel: clustersBySession.get(s.id)?.cluster_label || null };
      }).filter(item => (!quality || item.qualityFlags.includes(quality)) && (!clusterId || item.clusterId === clusterId));
      items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return send(res, 200, { items });
    }
    if (pathname === '/api/sessions/clusters' && method === 'GET') {
      const settings = (await activeClient.query('SELECT requested_k,last_built_at FROM session_cluster_settings WHERE id=1')).rows[0];
      const rows = isAdministrator(me)
        ? (await activeClient.query('SELECT id,label,auto_label,manually_labeled,member_count FROM session_clusters ORDER BY member_count DESC,label,id')).rows
        : (await activeClient.query('SELECT c.id,count(s.id)::int AS member_count FROM session_clusters c JOIN sessions s ON s.cluster_id=c.id AND s.ingested_by=$1 GROUP BY c.id ORDER BY member_count DESC,c.id', [me.id])).rows;
      const items = rows.map(row => ({ id: row.id, label: isAdministrator(me) ? row.label : `主题 ${row.id.slice(0, 6)}`, autoLabel: isAdministrator(me) ? row.auto_label : null, manuallyLabeled: isAdministrator(me) && row.manually_labeled, memberCount: row.member_count }));
      return send(res, 200, { requestedK: settings.requested_k || 'auto', lastBuiltAt: settings.last_built_at, items });
    }
    if (pathname === '/api/sessions/clusters/config' && method === 'PUT') {
      if (!isAdministrator(me)) return send(res, 403, { error: '仅管理员可配置主题聚类' });
      const body = await readBody(req);
      if (body.k !== 'auto' && (!Number.isInteger(body.k) || body.k < 1 || body.k > 20)) return send(res, 422, { error: 'K 必须为 auto 或 1–20 的整数' });
      await activeClient.query('UPDATE session_cluster_settings SET requested_k=$1 WHERE id=1', [body.k === 'auto' ? null : body.k]);
      const items = await rebuildSessionClusters(activeClient);
      return send(res, 200, { requestedK: body.k, count: items.length });
    }
    if (pathname === '/api/sessions/clusters/rebuild' && method === 'POST') {
      if (!isAdministrator(me)) return send(res, 403, { error: '仅管理员可重算主题聚类' });
      const items = await rebuildSessionClusters(activeClient);
      return send(res, 200, { count: items.length });
    }
    const clusterRoute = pathname.match(/^\/api\/sessions\/clusters\/([^/]+)$/);
    if (clusterRoute && method === 'PATCH') {
      if (!isAdministrator(me)) return send(res, 403, { error: '仅管理员可修改主题标签' });
      const body = await readBody(req);
      const label = typeof body.label === 'string' ? body.label.trim() : '';
      if (!label || label.length > 60) return send(res, 422, { error: '标签须为 1–60 字' });
      const updated = await activeClient.query('UPDATE session_clusters SET label=$1,manually_labeled=true WHERE id=$2 RETURNING id,label', [label, clusterRoute[1]]);
      return updated.rowCount ? send(res, 200, updated.rows[0]) : send(res, 404, { error: '主题聚类不存在' });
    }
    if (pathname === '/api/sessions/token-stats' && method === 'GET') {
      const allowedSessions = await visibleSessionIds();
      const reported = db.sessions.filter(session => !allowedSessions || allowedSessions.has(session.id)).map(session => ({ session, usage: sessionUsage(session) })).filter(item => item.usage);
      const totalTokens = reported.reduce((sum, item) => sum + item.usage.totalTokens, 0);
      const currentMonth = shanghaiDate(new Date()).slice(0, 7);
      const daily = new Map();
      let monthTokens = 0;
      for (const { session } of reported) for (const entry of session.messages) {
        if (!entry.usage) continue;
        const day = shanghaiDate(entry.at);
        const tokens = entry.usage.promptTokens + entry.usage.completionTokens;
        daily.set(day, (daily.get(day) || 0) + tokens);
        if (day.startsWith(currentMonth)) monthTokens += tokens;
      }
      return send(res, 200, {
        hasData: reported.length > 0,
        totalTokens: reported.length ? totalTokens : null,
        monthTokens: reported.length ? monthTokens : null,
        averagePerSession: reported.length ? totalTokens / reported.length : null,
        reportedSessions: reported.length,
        daily: [...daily].sort(([left], [right]) => left.localeCompare(right)).map(([date, tokens]) => ({ date, totalTokens: tokens })),
        topSessions: reported.sort((left, right) => right.usage.totalTokens - left.usage.totalTokens || left.session.id.localeCompare(right.session.id)).slice(0, 10).map(({ session, usage }) => ({ id: session.id, title: sessionTitle(session), totalTokens: usage.totalTokens })),
      });
    }
    const sess = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sess && method === "GET") {
      const allowedSessions = await visibleSessionIds();
      if (allowedSessions && !allowedSessions.has(sess[1])) return send(res, 404, { error: 'session not found' });
      const s = db.sessions.find((x) => x.id === sess[1]);
      if (!s) return send(res, 404, { error: "session not found" });
      const title = sessionTitle(s);
      const annotated = [];
      for (const item of s.messages) annotated.push(item.role === "assistant" ? { ...item, annotation: await annotationView(activeClient, s.id, item.id, me.id) } : item);
      const qualityFlags = (await activeClient.query("SELECT DISTINCT flag_type FROM session_quality_flags WHERE session_id=$1 ORDER BY flag_type DESC", [s.id])).rows.map(row => row.flag_type);
      const cluster = (await activeClient.query('SELECT s.cluster_id,c.label FROM sessions s LEFT JOIN session_clusters c ON c.id=s.cluster_id WHERE s.id=$1', [s.id])).rows[0];
      return send(res, 200, { ...s, messages: annotated, title, messageCount: s.messages.length, totalTokens: sessionUsage(s)?.totalTokens ?? null, qualityFlags, clusterId: cluster?.cluster_id || null, clusterLabel: cluster?.label || null });
    }
    // web 端上报会话（预留联动入口）
    if (pathname === "/api/sessions/ingest" && method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body.messages)) return send(res, 422, { error: "messages 必须是数组" });
      const existing = body.id ? db.sessions.find(item => item.id === body.id) : null;
      if (existing && !isAdministrator(me)) {
        const owner = (await activeClient.query("SELECT ingested_by FROM sessions WHERE id=$1", [existing.id])).rows[0]?.ingested_by;
        if (owner !== me.id) return send(res, 403, { error: "仅会话上报账号或管理员可追加消息" });
      }
      const seen = new Set();
      const incoming = [];
      for (const item of body.messages) {
        if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string" || (item.id !== undefined && (typeof item.id !== "string" || !item.id))) return send(res, 422, { error: "消息格式无效" });
        let usage;
        if (Object.hasOwn(item, 'usage')) {
          const value = item.usage;
          if (item.role !== 'assistant' || !value || typeof value !== 'object' || Array.isArray(value)
            || !Number.isInteger(value.promptTokens) || value.promptTokens < 0 || value.promptTokens > 2147483647
            || !Number.isInteger(value.completionTokens) || value.completionTokens < 0 || value.completionTokens > 2147483647
            || (value.model !== undefined && (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 120))) return send(res, 422, { error: 'assistant 用量必须包含非负整数 promptTokens / completionTokens，可选 model' });
          if (Number.isNaN(Date.parse(item.at || nowIso()))) return send(res, 422, { error: '上报用量的消息时间无效' });
          usage = { promptTokens: value.promptTokens, completionTokens: value.completionTokens, ...(value.model === undefined ? {} : { model: value.model.trim() }) };
        }
        if (existing && !item.id) return send(res, 422, { error: "再次上报会话时，消息必须携带首次返回的 ID" });
        const id = item.id || newId();
        if (seen.has(id)) return send(res, 409, { error: "同一会话内消息 ID 重复" });
        seen.add(id);
        incoming.push({ id, role: item.role, content: item.content, at: item.at || nowIso(), ...(usage ? { usage } : {}) });
      }
      if (existing) {
        for (const item of incoming) {
          const previous = existing.messages.find(message => message.id === item.id);
          if (previous && (previous.role !== item.role || previous.content !== item.content || previous.at !== item.at)) return send(res, 409, { error: `已有消息不能改写：${item.id}` });
          if (previous?.usage && item.usage && JSON.stringify(previous.usage) !== JSON.stringify(item.usage)) return send(res, 409, { error: `已有消息用量不能改写：${item.id}` });
        }
        const newlyReported = incoming.filter(item => item.usage && !existing.messages.find(previous => previous.id === item.id)?.usage);
        for (const item of incoming) {
          const previous = existing.messages.find(message => message.id === item.id);
          if (previous && !previous.usage && item.usage) previous.usage = item.usage;
        }
        existing.messages.push(...incoming.filter(item => !existing.messages.some(message => message.id === item.id)));
        if (newlyReported.length) afterSave(async client => { for (const item of newlyReported) await saveSessionPriceSnapshot(client, existing.id, item); });
        afterSave(client => saveSessionQuality(client, existing));
        afterSave(client => assignSessionCluster(client, existing));
        existing.updatedAt = nowIso();
        saveDb(db);
        return send(res, 200, existing);
      }
      const s = { id: body.id || newId(), userId: body.userId || "unknown", createdAt: nowIso(), updatedAt: nowIso(), messages: incoming };
      db.sessions.unshift(s);
      afterSave(client => client.query("UPDATE sessions SET ingested_by=$1 WHERE id=$2", [me.id, s.id]));
      if (incoming.some(item => item.usage)) afterSave(async client => { for (const item of incoming) await saveSessionPriceSnapshot(client, s.id, item); });
      afterSave(client => saveSessionQuality(client, s));
      afterSave(client => assignSessionCluster(client, s));
      saveDb(db);
      return send(res, 201, s);
    }

    // ---- note categories ----
    if (pathname === "/api/note-categories") {
      if (method === "GET") return send(res, 200, { items: db.noteCategories.map(item => ({ ...item, parentId: item.parentId || null })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")) });
      if (!canAccess(me, 'note_categories', 'manage')) return send(res, 403, { error: "仅管理员可管理笔记分类" });
      if (method === "POST") {
        const body = await readBody(req);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const parentId = body.parentId || null;
        if (!name || name.length > 60) return send(res, 400, { error: "分类名称须为 1–60 字" });
        if (parentId && !db.noteCategories.some(item => item.id === parentId)) return send(res, 400, { error: "父分类不存在" });
        if (db.noteCategories.some(item => (item.parentId || null) === parentId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return send(res, 409, { error: "同级分类名称已存在" });
        const at = nowIso();
        const category = { id: newId(), name, parentId, createdAt: at, updatedAt: at };
        db.noteCategories.push(category); saveDb(db);
        return send(res, 201, category);
      }
      return send(res, 405, { error: "method not allowed" });
    }
    const noteCategoryOne = pathname.match(/^\/api\/note-categories\/([^/]+)$/);
    if (noteCategoryOne) {
      if (method !== "GET" && !canAccess(me, 'note_categories', 'manage')) return send(res, 403, { error: "仅管理员可管理笔记分类" });
      const index = db.noteCategories.findIndex(item => item.id === noteCategoryOne[1]);
      if (index < 0) return send(res, 404, { error: "分类不存在" });
      if (method === "PATCH") {
        const body = await readBody(req);
        const current = db.noteCategories[index];
        const name = body.name === undefined ? current.name : typeof body.name === "string" ? body.name.trim() : "";
        const parentId = body.parentId === undefined ? current.parentId || null : body.parentId || null;
        if (!name || name.length > 60) return send(res, 400, { error: "分类名称须为 1–60 字" });
        if (parentId && !db.noteCategories.some(item => item.id === parentId)) return send(res, 400, { error: "父分类不存在" });
        if (parentId && categoryBranch(db.noteCategories, current.id).has(parentId)) return send(res, 409, { error: "分类不能移动到自身或子分类下" });
        if (db.noteCategories.some(item => item.id !== current.id && (item.parentId || null) === parentId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return send(res, 409, { error: "同级分类名称已存在" });
        db.noteCategories[index] = { ...current, name, parentId, updatedAt: nowIso() }; saveDb(db);
        return send(res, 200, db.noteCategories[index]);
      }
      if (method === "DELETE") {
        if (db.noteCategories.some(item => item.parentId === noteCategoryOne[1])) return send(res, 409, { error: "请先移动或删除子分类" });
        db.noteCategories.splice(index, 1);
        for (const note of db.notes) if (note.categoryId === noteCategoryOne[1]) note.categoryId = null;
        saveDb(db);
        return send(res, 200, { deleted: true, id: noteCategoryOne[1] });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    // ---- note tag catalog ----
    const noteTagView = tag => ({ ...tag, count: noteTagUsage(db.notes, tag.name) });
    if (pathname === "/api/note-tags") {
      if (method === "GET") return send(res, 200, { items: db.noteTagDefinitions.map(noteTagView).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN")) });
      if (method === "POST") {
        if (!isAdministrator(me)) return send(res, 403, { error: "仅管理员可管理笔记标签" });
        const body = await readBody(req);
        const name = validateNoteTagName(body.name);
        const normalizedKey = noteTagKey(name);
        if (db.noteTagDefinitions.some(tag => tag.normalizedKey === normalizedKey)) return send(res, 409, { error: "标签已存在" });
        const at = nowIso();
        const tag = { id: newId(), name, normalizedKey, createdAt: at, updatedAt: at };
        db.noteTagDefinitions.push(tag); saveDb(db);
        return send(res, 201, noteTagView(tag));
      }
      return send(res, 405, { error: "method not allowed" });
    }
    const noteTagMerge = pathname.match(/^\/api\/note-tags\/([^/]+)\/merge$/);
    const noteTagOne = pathname.match(/^\/api\/note-tags\/([^/]+)$/);
    if (noteTagMerge || noteTagOne) {
      if (!isAdministrator(me)) return send(res, 403, { error: "仅管理员可管理笔记标签" });
      const tag = db.noteTagDefinitions.find(item => item.id === (noteTagMerge || noteTagOne)[1]);
      if (!tag) return send(res, 404, { error: "标签不存在" });
      if (noteTagMerge && method === "POST") {
        const body = await readBody(req);
        const target = db.noteTagDefinitions.find(item => item.id === body.targetId);
        if (!target || target.id === tag.id) return send(res, 400, { error: "请选择另一个目标标签" });
        if (!Number.isInteger(body.expectedUsageCount) || body.expectedUsageCount < 0) return send(res, 400, { error: "请提供合并前的使用篇数" });
        const count = noteTagUsage(db.notes, tag.name);
        if (count !== body.expectedUsageCount) return send(res, 409, { error: `标签使用篇数已变为 ${count}，请重新确认` });
        const at = nowIso();
        for (const note of db.notes) if ((note.tags || []).includes(tag.name)) {
          note.tags = note.tags.includes(target.name) ? note.tags.filter(name => name !== tag.name) : note.tags.map(name => name === tag.name ? target.name : name);
          note.updatedAt = at;
        }
        db.noteTagDefinitions.splice(db.noteTagDefinitions.indexOf(tag), 1);
        saveDb(db);
        return send(res, 200, { sourceId: tag.id, target: noteTagView(target), affectedCount: count });
      }
      if (noteTagOne && method === "PATCH") {
        const body = await readBody(req);
        const name = validateNoteTagName(body.name);
        const normalizedKey = noteTagKey(name);
        if (db.noteTagDefinitions.some(item => item.id !== tag.id && item.normalizedKey === normalizedKey)) return send(res, 409, { error: "标签名称已存在，请使用合并" });
        const oldName = tag.name;
        tag.name = name; tag.normalizedKey = normalizedKey; tag.updatedAt = nowIso();
        for (const note of db.notes) if ((note.tags || []).includes(oldName)) {
          note.tags = note.tags.map(value => value === oldName ? name : value);
          note.updatedAt = tag.updatedAt;
        }
        saveDb(db);
        return send(res, 200, noteTagView(tag));
      }
      if (noteTagOne && method === "DELETE") {
        const expected = Number(url.searchParams.get("expectedUsageCount"));
        if (!url.searchParams.has("expectedUsageCount") || !Number.isInteger(expected) || expected < 0) return send(res, 400, { error: "请提供删除前的使用篇数" });
        const count = noteTagUsage(db.notes, tag.name);
        if (count !== expected) return send(res, 409, { error: `标签使用篇数已变为 ${count}，请重新确认` });
        const at = nowIso();
        for (const note of db.notes) if ((note.tags || []).includes(tag.name)) {
          note.tags = note.tags.filter(value => value !== tag.name);
          note.updatedAt = at;
        }
        db.noteTagDefinitions.splice(db.noteTagDefinitions.indexOf(tag), 1);
        saveDb(db);
        return send(res, 200, { deleted: true, id: tag.id, affectedCount: count });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    // ---- notes ----
    if (pathname === "/api/knowledge-graph" && method === "GET") return send(res, 200, buildKnowledgeGraph({ ...db, tasks: accountTasks, notes: db.notes.map(linkedRecordView) }));
    if (pathname === "/api/notes/graph" && method === "GET") {
      const nodes = db.notes.map(({ id, title }) => ({ id, title }));
      const edges = db.notes.flatMap(note => (note.links || []).map(link => ({ sourceId: note.id, targetId: link.targetId || null, targetRef: link.targetRef, label: link.label, reason: link.targetId ? null : link.reason || "missing" })));
      return send(res, 200, { nodes, edges });
    }
    const noteVersionsRoute = pathname.match(/^\/api\/notes\/([^/]+)\/versions(?:\/([^/]+))?$/);
    if (noteVersionsRoute && method === "GET") {
      if (!db.notes.some(note => note.id === noteVersionsRoute[1])) return send(res, 404, { error: "笔记不存在" });
      const items = db.noteVersions.filter(item => item.noteId === noteVersionsRoute[1]).sort((a, b) => b.versionNumber - a.versionNumber);
      if (noteVersionsRoute[2]) {
        const version = items.find(item => item.id === noteVersionsRoute[2]);
        return version ? send(res, 200, version) : send(res, 404, { error: "版本不存在" });
      }
      return send(res, 200, { items });
    }
    const restoreNote = pathname.match(/^\/api\/notes\/([^/]+)\/restore$/);
    if (restoreNote && method === "POST") {
      const note = db.notes.find(item => item.id === restoreNote[1]);
      if (!note) return send(res, 404, { error: "笔记不存在" });
      if (!canAccess(me, 'notes', 'update', { ownerId: note.ownerId })) return send(res, 403, { error: "只能恢复自己创建的笔记" });
      const body = await readBody(req);
      const version = db.noteVersions.find(item => item.id === body.versionId && item.noteId === note.id);
      if (!version) return send(res, 404, { error: "版本不存在" });
      note.title = version.title;
      const contentChanged = note.content !== version.content;
      note.content = version.content;
      note.updatedAt = nowIso();
      reconcileNoteLinks(note.id);
      snapshotNote(note, "restore");
      saveDb(db);
      if (contentChanged) afterSave(client => resetNoteReviews(client, note.id));
      return send(res, 200, linkedRecordView(note));
    }
    if (pathname === "/api/notes") {
      if (method === "GET") {
        const taskId = url.searchParams.get("taskId");
        if (taskId && !linkedTaskVisible(taskId)) return send(res, 404, { error: "任务不存在" });
        const keyword = (url.searchParams.get("keyword") || "").trim().toLocaleLowerCase();
        const categoryId = url.searchParams.get("categoryId");
        const categoryIds = categoryId ? categoryBranch(db.noteCategories, categoryId) : null;
        const tags = url.searchParams.getAll("tag").filter(Boolean).map(value => db.noteTagDefinitions.find(tag => tag.normalizedKey === noteTagKey(value))?.name || value);
        const items = db.notes.filter(note => (!taskId || note.taskId === taskId) && (!keyword || `${note.title || ""}\n${note.content || ""}`.toLocaleLowerCase().includes(keyword)) && (!categoryIds || categoryIds.has(note.categoryId)) && tags.every(tag => (note.tags || []).includes(tag))).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        const tagCounts = new Map();
        for (const note of db.notes) for (const tag of note.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        return send(res, 200, { items: items.map(linkedRecordView), total: items.length, tags: [...tagCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN")) });
      }
      if (method === "POST") {
        if (!canAccess(me, 'notes', 'create')) return send(res, 403, { error: "无权创建笔记" });
        const body = await readBody(req);
        if (!body.title || !String(body.title).trim()) return send(res, 400, { error: "title 为必填项" });
        const t = nowIso();
        const note = {
          id: newId(), title: String(body.title).trim(),
          ownerId: me.id,
          content: typeof body.content === "string" ? body.content : "",
          taskId: body.taskId || null,
          sourceSessionId: body.sourceSessionId || null,
          categoryId: body.categoryId || null,
          tags: body.tags === undefined ? [] : canonicalNoteTags(db.noteTagDefinitions, body.tags),
          createdAt: t, updatedAt: t,
        };
        if (!linkedTaskVisible(note.taskId)) return send(res, 404, { error: "任务不存在" });
        if (note.categoryId && !db.noteCategories.some(item => item.id === note.categoryId)) return send(res, 400, { error: "分类不存在" });
        if (note.sourceSessionId && !(await activeClient.query("SELECT 1 FROM sessions WHERE id=$1 AND ($2 OR ingested_by=$3)", [note.sourceSessionId, isAdministrator(me), me.id])).rowCount) return send(res, 404, { error: "来源会话不存在" });
        db.notes.unshift(note);
        reconcileNoteLinks();
        snapshotNote(note, "save");
        logAction("note", { taskId: note.taskId, title: note.title, detail: "新增学习笔记" });
        saveDb(db);
        afterSave(client => initializeNoteReviews(client, note.id));
        return send(res, 201, linkedRecordView(note));
      }
      return send(res, 405, { error: "method not allowed" });
    }
    const noteOne = pathname.match(/^\/api\/notes\/([^/]+)$/);
    if (noteOne) {
      const i = db.notes.findIndex((n) => n.id === noteOne[1]);
      if (i === -1) return send(res, 404, { error: "note not found" });
      if (method === "GET") {
        const note = db.notes[i];
        const links = (note.links || []).map(link => ({ ...link, targetTitle: db.notes.find(candidate => candidate.id === link.targetId)?.title || null, reason: link.targetId ? null : link.reason || "missing" }));
        const backlinks = db.notes.filter(candidate => (candidate.links || []).some(link => link.targetId === note.id)).map(candidate => ({ id: candidate.id, title: candidate.title }));
        return send(res, 200, { ...linkedRecordView(note), links, backlinks, sourceSessionMissing: Boolean(note.sourceSessionId && !db.sessions.some(session => session.id === note.sourceSessionId)) });
      }
      if (method === "PUT" || method === "PATCH") {
        if (!canAccess(me, 'notes', 'update', { ownerId: db.notes[i].ownerId })) return send(res, 403, { error: "只能修改自己创建的笔记" });
        const body = await readBody(req);
        if ("taskId" in body && !linkedTaskVisible(db.notes[i].taskId)) return send(res, 404, { error: "任务不存在" });
        const w = {};
        if (typeof body.title === "string") w.title = body.title.trim();
        if (typeof body.content === "string") w.content = body.content;
        if ("taskId" in body) {
          w.taskId = body.taskId || null;
          if (!linkedTaskVisible(w.taskId)) return send(res, 404, { error: "任务不存在" });
        }
        if ("categoryId" in body) {
          w.categoryId = body.categoryId || null;
          if (w.categoryId && !db.noteCategories.some(item => item.id === w.categoryId)) return send(res, 400, { error: "分类不存在" });
        }
        if ("tags" in body) w.tags = canonicalNoteTags(db.noteTagDefinitions, body.tags);
        const contentChanged = w.content !== undefined && w.content !== db.notes[i].content;
        const next = { ...db.notes[i], ...w, updatedAt: nowIso() };
        db.notes[i] = next;
        reconcileNoteLinks();
        snapshotNote(next, "save");
        saveDb(db);
        if (contentChanged) afterSave(client => resetNoteReviews(client, next.id));
        return send(res, 200, linkedRecordView(db.notes[i]));
      }
      if (method === "DELETE") {
        if (!canAccess(me, 'notes', 'delete', { ownerId: db.notes[i].ownerId })) return send(res, 403, { error: "只能删除自己创建的笔记" });
        if (!linkedTaskVisible(db.notes[i].taskId)) return send(res, 404, { error: "任务不存在" });
        const [rm] = db.notes.splice(i, 1);
        reconcileNoteLinks();
        saveDb(db);
        afterSave(client => client.query("UPDATE note_review_notifications SET read_at=coalesce(read_at,now()),email_status=CASE WHEN email_status IN ('pending','failed') THEN 'skipped' ELSE email_status END,email_next_attempt_at=NULL WHERE note_id=$1", [rm.id]));
        return send(res, 200, { deleted: true, id: rm.id });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    // ---- experiments ----
    if (pathname === "/api/experiments") {
      if (method === "GET") {
        if (!canAccess(me, 'experiments', 'read')) return send(res, 403, { error: '无权查看实验' });
        const taskId = url.searchParams.get("taskId");
        if (taskId && !linkedTaskVisible(taskId)) return send(res, 404, { error: "任务不存在" });
        let items = [...db.experiments];
        if (taskId) items = items.filter((e) => e.taskId === taskId);
        items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return send(res, 200, { items: items.map(linkedRecordView) });
      }
      if (method === "POST") {
        if (!canAccess(me, 'experiments', 'create')) return send(res, 403, { error: '无权创建实验' });
        const body = await readBody(req);
        if (!body.title || !String(body.title).trim()) return send(res, 400, { error: "title 为必填项" });
        const t = nowIso();
        const exp = {
          id: newId(), title: String(body.title).trim(),
          ownerId: me.id, recordKind: "manual",
          taskId: body.taskId || null,
          prompt: typeof body.prompt === "string" ? body.prompt : "",
          model: typeof body.model === "string" ? body.model : "",
          params: typeof body.params === "string" ? body.params : "",
          result: typeof body.result === "string" ? body.result : "",
          score: clampProgress(body.score ?? 0) > 5 ? 5 : Math.max(0, Math.round(Number(body.score) || 0)),
          createdAt: t, updatedAt: t,
        };
        if (!linkedTaskVisible(exp.taskId)) return send(res, 404, { error: "任务不存在" });
        db.experiments.unshift(exp);
        logAction("experiment", { taskId: exp.taskId, title: exp.title, detail: "记录一次实验" });
        saveDb(db);
        return send(res, 201, linkedRecordView(exp));
      }
      return send(res, 405, { error: "method not allowed" });
    }
    const expOne = pathname.match(/^\/api\/experiments\/([^/]+)$/);
    if (expOne) {
      const i = db.experiments.findIndex((e) => e.id === expOne[1]);
      if (i === -1) return send(res, 404, { error: "experiment not found" });
      if (method === "GET") return canAccess(me, 'experiments', 'read') ? send(res, 200, linkedRecordView(db.experiments[i])) : send(res, 403, { error: '无权查看实验' });
      if (method === "PUT" || method === "PATCH") {
        if (!canAccess(me, 'experiments', 'update', { ownerId: db.experiments[i].ownerId })) return send(res, 403, { error: "无权修改该实验" });
        if (db.experiments[i].recordKind === "definition") return send(res, 409, { error: "请使用实验定义接口修改" });
        const body = await readBody(req);
        const w = {};
        if (typeof body.title === "string") w.title = body.title.trim();
        if ("taskId" in body) {
          w.taskId = body.taskId || null;
          if (!linkedTaskVisible(w.taskId)) return send(res, 404, { error: "任务不存在" });
        }
        if (typeof body.prompt === "string") w.prompt = body.prompt;
        if (typeof body.model === "string") w.model = body.model;
        if (typeof body.params === "string") w.params = body.params;
        if (typeof body.result === "string") w.result = body.result;
        if (body.score !== undefined) w.score = Math.max(0, Math.min(5, Math.round(Number(body.score) || 0)));
        db.experiments[i] = { ...db.experiments[i], ...w, updatedAt: nowIso() };
        saveDb(db);
        return send(res, 200, linkedRecordView(db.experiments[i]));
      }
      if (method === "DELETE") {
        if (!canAccess(me, 'experiments', 'delete', { ownerId: db.experiments[i].ownerId })) return send(res, 403, { error: "无权删除该实验" });
        const [rm] = db.experiments.splice(i, 1);
        saveDb(db);
        afterSave(async client => {
          await client.query('UPDATE experiment_schedules SET active=false WHERE experiment_id=$1', [rm.id]);
          await client.query('UPDATE evaluation_schedules SET active=false WHERE experiment_id=$1', [rm.id]);
          await client.query('UPDATE experiment_shares SET revoked_at=coalesce(revoked_at,now()) WHERE experiment_id=$1', [rm.id]);
        });
        return send(res, 200, { deleted: true, id: rm.id });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, 400, { error: err instanceof Error ? err.message : "bad request" });
  }
}

async function withData(work) {
  return serialized(async () => {
    const client = await pool.connect();
    activeClient = client;
    dirty = false;
    afterSaveTasks = [];
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(748201)");
      db = await loadData(client);
      const before = structuredClone(db);
      const value = await work();
      const changed = dirty;
      if (changed) await saveData(client, before, db);
      for (const task of afterSaveTasks) await task(client);
      await client.query("COMMIT");
      return { value, changed };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      activeClient = null;
      db = null;
      client.release();
    }
  });
}

const server = http.createServer((req, res) => {
  if (new URL(req.url, 'http://localhost').pathname === '/api/client-errors') {
    if (req.method === 'OPTIONS') return sendImmediate(res, 204, {});
    void (async () => {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const me = await lookupSession(token);
      if (!me) return sendImmediate(res, 401, { error: '未登录或登录已过期' });
      if (req.method !== 'POST') return sendImmediate(res, 405, { error: 'method not allowed' });
      const result = await saveClientError(pool, me, await readProjectBody(req));
      return sendImmediate(res, result.status, result.data);
    })().catch(error => {
      if (!res.headersSent) sendImmediate(res, error.status || 500, { error: error.status ? error.message : '错误报告暂不可用' });
    });
    return;
  }
  if (new URL(req.url, 'http://localhost').pathname === '/api/search') {
    if (req.method === 'OPTIONS') return sendImmediate(res, 204, {});
    void (async () => {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const me = await lookupSession(token);
      if (!me) return sendImmediate(res, 401, { error: '未登录或登录已过期' });
      if (req.method !== 'GET') return sendImmediate(res, 405, { error: 'method not allowed' });
      const query = new URL(req.url, 'http://localhost').searchParams.get('query');
      const result = await searchGlobally(pool, me, query);
      return sendImmediate(res, result.status, result.data);
    })().catch(error => {
      console.error('[global-search] request failed:', error.message);
      if (!res.headersSent) sendImmediate(res, 500, { error: '全局搜索暂不可用' });
    });
    return;
  }
  const relatedRoute = new URL(req.url, 'http://localhost').pathname.match(/^\/api\/sessions\/([^/]+)\/related$/);
  if (relatedRoute) {
    if (req.method === 'OPTIONS') return sendImmediate(res, 204, {});
    void (async () => {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const me = await lookupSession(token);
      if (!me) return sendImmediate(res, 401, { error: '未登录或登录已过期' });
      if (req.method !== 'GET') return sendImmediate(res, 405, { error: 'method not allowed' });
      const result = await getRelatedSessions(pool, decodeURIComponent(relatedRoute[1]), me);
      return sendImmediate(res, result.status, result.data);
    })().catch(error => {
      console.error('[session-related] request failed:', error.message);
      if (!res.headersSent) sendImmediate(res, 500, { error: '相关会话查询暂不可用' });
    });
    return;
  }
  if (new URL(req.url, 'http://localhost').pathname === '/api/sessions/learning-path') {
    if (req.method === 'OPTIONS') return sendImmediate(res, 204, {});
    void (async () => {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const me = await lookupSession(token);
      if (!me) return sendImmediate(res, 401, { error: '未登录或登录已过期' });
      if (req.method !== 'GET') return sendImmediate(res, 405, { error: 'method not allowed' });
      const userId = new URL(req.url, 'http://localhost').searchParams.get('userId');
      const result = await getSessionLearningPath(pool, userId, me);
      return sendImmediate(res, result.status, result.data);
    })().catch(error => {
      console.error('[session-learning-path] request failed:', error.message);
      if (!res.headersSent) sendImmediate(res, 500, { error: '学习路径分析暂不可用' });
    });
    return;
  }
  if (new URL(req.url, 'http://localhost').pathname === '/api/sessions/export') {
    if (req.method === 'OPTIONS') return sendImmediate(res, 204, {});
    void (async () => {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const me = await lookupSession(token);
      if (!me) return sendImmediate(res, 401, { error: '未登录或登录已过期' });
      if (req.method !== 'POST') return sendImmediate(res, 405, { error: 'method not allowed' });
      const result = await exportSessions(pool, await readProjectBody(req), me);
      if (result.status !== 200) return sendImmediate(res, result.status, { error: result.error });
      res.writeHead(200, {
        'Content-Type': `${result.contentType}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      });
      res.end(result.content);
    })().catch(error => {
      if (!error.status) console.error('[session-export] request failed:', error.message);
      if (!res.headersSent) sendImmediate(res, error.status || 500, { error: error.status ? error.message : '会话导出失败' });
    });
    return;
  }
  if (new URL(req.url, 'http://localhost').pathname === '/api/sessions/search') {
    if (req.method === 'OPTIONS') return sendImmediate(res, 204, {});
    void (async () => {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const me = await lookupSession(token);
      if (!me) return sendImmediate(res, 401, { error: '未登录或登录已过期' });
      if (req.method !== 'GET') return sendImmediate(res, 405, { error: 'method not allowed' });
      const params = new URL(req.url, 'http://localhost').searchParams;
      const response = await searchSessions(pool, { query: params.get('query'), regex: params.get('regex') === 'true', page: Number(params.get('page') || 1), me });
      return sendImmediate(res, response.status, response.data);
    })().catch(error => {
      console.error('[session-search] request failed:', error.message);
      if (!res.headersSent) sendImmediate(res, 500, { error: '会话搜索服务不可用' });
    });
    return;
  }
  if (new URL(req.url, 'http://localhost').pathname.startsWith('/api/project-repositories')) {
    if (req.method === 'OPTIONS') return sendImmediate(res, 204, {});
    void (async () => {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const me = await lookupSession(token);
      if (!me) return sendImmediate(res, 401, { error: '未登录或登录已过期' });
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;
      const response = await handleProjectRequirementBaselines({ pathname, method: req.method, client: pool, me, readBody: () => readProjectBody(req) })
        || await handleProjectFindingFeedback({ pathname, method: req.method, client: pool, me, readBody: () => readProjectBody(req), req })
        || await handleProjectSuggestionAction({ pathname, method: req.method, client: pool, me, url, readBody: () => readProjectBody(req) })
        || await handleProjectAnalyses({ pathname, method: req.method, client: pool, me, url, readBody: () => readProjectBody(req) })
        || await handleProjectScans({ pathname, method: req.method, client: pool, me, url: new URL(req.url, 'http://localhost') })
        || await handleProjectRepositories({ pathname, method: req.method, client: pool, me, readBody: () => readProjectBody(req), req });
      sendImmediate(res, response?.status || 404, response?.data || { error: '项目接口不存在' });
      if (response?.status === 201 && pathname.endsWith('/accept')) notifyLive();
      return;
    })().catch(error => {
      if (!error.status) console.error('[projects] request failed:', error.message);
      if (!res.headersSent) sendImmediate(res, error.status || 500, { error: error.status ? error.message : '项目服务不可用' });
    });
    return;
  }
  if (new URL(req.url, 'http://localhost').pathname.startsWith('/api/settings/backups')) {
    void handleBackupRequest(req,res,pool,token=>lookupSession(token),notifyLive).catch(error=>{
      console.error('[backups] request failed:',error.message);
      if (!res.headersSent) { res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({error:'备份服务不可用'})); }
    });
    return;
  }
  if (isPromptSyncPath(new URL(req.url,"http://localhost").pathname)) {
    void handlePromptSync(req,res,pool,token=>lookupSession(token)).catch(error=>{
      console.error('[prompt-sync] request failed:',error);
      if (!res.headersSent) {res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'提示词同步服务不可用'}));}
    });
    return;
  }
  if (isPromptArchivePath(new URL(req.url,"http://localhost").pathname)) {
    void handlePromptArchive(req,res,pool,token=>lookupSession(token)).catch(error=>{
      console.error('[prompt-archive] request failed:',error);
      if (!res.headersSent) {res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'提示词归档服务不可用'}));}
    });
    return;
  }
  if (isPromptMediaPath(new URL(req.url,"http://localhost").pathname)) {
    void handlePromptMedia(req,res,pool,token=>lookupSession(token),(shareToken,assetId)=>canReadSharedEvaluationMedia(pool,shareToken,assetId)).catch(error=>{
      console.error('[prompt-media] request failed:',error);
      if (!res.headersSent) {res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'提示词媒体服务不可用'}));}
    });
    return;
  }
  if (isAssetPath(new URL(req.url, "http://localhost").pathname)) {
    void handleAssetRequest(req, res, pool, token => lookupSession(token), (shareToken, assetId) => canReadSharedExperimentAsset(pool, shareToken, assetId)).catch(error => {
      console.error("[assets] request failed:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "图片服务不可用" }));
      }
    });
    return;
  }
  void withData(async () => {
    await handleRequest(req, res);
    if (res.__accountBefore) res.__accountAfter = db.users.find(user => user.id === res.__accountBefore.id);
    await recordAccountAction(activeClient, req, res);
  }).then(({ changed }) => {
    const pending = res.__pending || { status: 500, payload: { error: "接口没有返回结果" } };
    send(res, pending.status, pending.payload);
    if (changed || (req.method === 'POST' && new URL(req.url, 'http://localhost').pathname === '/api/auth/login' && pending.status === 200)) notifyLive();
    if (req.method === 'POST' && new URL(req.url, 'http://localhost').pathname === '/api/alerts/channels/test' && pending.status === 201) notifyLive();
    if (req.method === 'PUT' && new URL(req.url, 'http://localhost').pathname.startsWith('/api/settings/') && pending.status === 200) notifyLive('settings_changed');
  }).catch(error => {
    console.error("[api] request failed:", error);
    send(res, 500, { error: "数据库操作失败" });
  });
});
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { void flushModelCallAudits().finally(() => pool.end().finally(() => process.exit(0))); });

// WebSocket 仅发送失效通知；数据仍由带鉴权的 /api/stats 读取。
const liveServer = new WebSocketServer({ noServer: true, maxPayload: 1024 });
const liveClients = new Map();
server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url, `http://127.0.0.1:${PORT}`).pathname !== "/api/live") {
    socket.destroy();
    return;
  }
  liveServer.handleUpgrade(req, socket, head, (ws) => liveServer.emit("connection", ws));
});
liveServer.on("connection", (ws) => {
  const authTimeout = setTimeout(() => ws.close(1008, "authentication required"), 5000);
  ws.on("message", async (raw) => {
    if (liveClients.has(ws)) return;
    let message;
    try { message = JSON.parse(String(raw)); } catch { ws.close(1008, "invalid authentication"); return; }
    let user = null;
    try { user = message?.type === "auth" ? await lookupSession(message.token) : null; }
    catch { ws.close(1011, "database unavailable"); return; }
    if (!user) { ws.close(1008, "invalid authentication"); return; }
    clearTimeout(authTimeout);
    liveClients.set(ws, message.token);
    ws.send(JSON.stringify({ type: "ready" }));
  });
  ws.on("close", () => { clearTimeout(authTimeout); liveClients.delete(ws); });
  ws.on("error", () => { clearTimeout(authTimeout); liveClients.delete(ws); });
});
notifyLive = (type = 'stats_changed') => {
  const payload = JSON.stringify({ type });
  for (const [ws, token] of liveClients) {
    void lookupSession(token).then(active => {
      if (!active) { ws.close(1008, "authentication expired"); liveClients.delete(ws); return; }
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }).catch(() => { ws.close(1011, "database unavailable"); liveClients.delete(ws); });
  }
};

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[mock] 端口 ${PORT} 已被占用：通常是有另一个 dev/mock 实例还在运行。\n` +
        `       请先停止它（关掉对应终端或 kill 占用进程）后重试；\n` +
        `       或换端口：MOCK_PORT=8002 npm run mock（需同步改 vite.config.ts 的 /api 代理 target）。`
    );
  } else {
    console.error("[mock] 启动失败：", err);
  }
  process.exit(1);
});

try {
  await assertSchemaCurrent();
  await recoverBackupJobs(pool);
  await resumeProjectScans(pool);
  await resumeProjectAnalyses(pool);
  if (process.env.EXPERIMENT_WORKER_MODE !== 'external') await recoverExperimentJobs(pool);
  const users = await pool.query("SELECT 1 FROM users LIMIT 1");
  if (!users.rowCount) throw new Error("数据库尚无账号；请先运行 npm run db:import");
  await ensureSessionClusters(pool);
  await withData(() => {
    if (reconcileNoteLinks()) saveDb(db);
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[mock] PostgreSQL API listening on http://127.0.0.1:${PORT}`);
    scheduleRecurrences(0);
    void cleanupAssets(pool).catch(error => console.error("[assets] cleanup failed:", error));
    setInterval(() => { void cleanupAssets(pool).catch(error => console.error("[assets] cleanup failed:", error)); }, 3600_000).unref();
    const cleanupExpired = () => { void runRetentionCleanup(pool).catch(error => console.error('[retention] cleanup failed:', error)); };
    cleanupExpired();
    setInterval(cleanupExpired, 60_000).unref();
    const remindExpiringPasswords = () => { void createPasswordExpiryReminders(pool).then(count => { if (count) notifyLive(); }).catch(error => console.error('[password-expiry] reminder failed:', error)); };
    remindExpiringPasswords();
    setInterval(remindExpiringPasswords, 3600_000).unref();
    const refreshInactiveAccounts = () => { void markInactiveAccounts(pool).catch(error => console.error('[accounts] inactivity refresh failed:', error)); };
    refreshInactiveAccounts();
    setInterval(refreshInactiveAccounts, 3600_000).unref();
    let webhookRunning = false;
    const runWebhooks = async () => {
      if (webhookRunning) return;
      webhookRunning = true;
      try { for (let i = 0; i < 10; i++) if (!await processOutboundWebhooks(pool)) break; }
      catch (error) { console.error('[webhooks] delivery failed:', error.message); }
      finally { webhookRunning = false; }
    };
    void runWebhooks();
    setInterval(() => { void runWebhooks(); }, 1000).unref();
    const checkModelHealth = () => { void processModelHealthAlerts(pool).catch(error => console.error('[model-health] alert check failed:', error)); };
    checkModelHealth();
    setInterval(checkModelHealth, 5000).unref();
    let collectingAlertMetrics = false;
    const collectMetrics = async () => {
      if (collectingAlertMetrics) return;
      collectingAlertMetrics = true;
      try { await collectAlertMetrics(pool); if (await evaluateAlertRules(pool)) notifyLive(); }
      catch (error) { console.error('[alerts] metric collection failed:', error); }
      finally { collectingAlertMetrics = false; }
    };
    void collectMetrics();
    setInterval(() => { void collectMetrics(); }, 60_000).unref();
    const runReviewJobs = async () => {
      try {
        const { value } = await withData(() => createDueReviewNotifications(activeClient));
        if (value) notifyLive();
        await deliverReviewEmails(pool);
        await deliverAppEmails(pool);
      } catch (error) { console.error("[reviews] reminder job failed:", error); }
      finally {
        const now = Date.now();
        const today = shanghaiDate(now);
        const todayReminder = reminderTime(today);
        const nextReminder = todayReminder > now ? todayReminder : reminderTime(addCalendarDays(today, 1));
        setTimeout(runReviewJobs, Math.max(1000, Math.min(60_000, nextReminder - now))).unref();
      }
    };
    runReviewJobs();
    const runExperiments = async () => {
      try { await runExperimentJobs(pool, notifyLive); }
      catch (error) { console.error("[experiments] runner failed:", error); }
    };
    if (process.env.EXPERIMENT_WORKER_MODE !== 'external') {
      void runExperiments();
      setInterval(() => { void runExperiments(); }, 1500).unref();
    }
    const runSchedules = async () => {
      try { if (await processDueModelRetirements(pool)) notifyLive(); if (await processDueExperimentSchedules(pool)) notifyLive(); }
      catch (error) { console.error("[experiments] schedule failed:", error); }
    };
    if (process.env.EXPERIMENT_WORKER_MODE !== 'external') {
      void runSchedules();
      setInterval(() => { void runSchedules(); void processDueEvaluationSchedules(pool).catch(error => console.error('[evaluation-schedules] processing failed:',error)); }, 1000).unref();
    }
  });
} catch (error) {
  console.error("[mock] PostgreSQL 不可用或尚未迁移：", error.message);
  await pool.end();
  process.exit(1);
}

let recurrenceTimer;
function scheduleRecurrences(delay) {
  clearTimeout(recurrenceTimer);
  recurrenceTimer = setTimeout(() => {
    void withData(() => {
      const before = db.tasks.length;
      const previousSequence = db.recurringSeries.map(series => series.nextSequence);
      const count = generateDueInstances(db, Date.now(), 100);
      if (count) {
        const at = nowIso();
        for (const task of db.tasks.slice(before)) {
          recordTaskTrendEvent(db, "create", task.id, at);
          logActivity("create", { taskId: task.id, title: task.title, detail: `自动生成第 ${task.recurrenceIndex} 次重复任务` });
        }
        recordTaskTrendSnapshot(db, at);
      }
      if (count || db.recurringSeries.some((series, index) => series.nextSequence !== previousSequence[index])) saveDb(db);
      const next = db.recurringSeries.filter(series => canGenerate(series, series.nextSequence))
        .map(series => Date.parse(occurrenceDueAt(series, series.nextSequence - 1)))
        .reduce((minimum, value) => Math.min(minimum, value), Infinity);
      return count === 100 ? 0 : Number.isFinite(next) ? Math.max(0, Math.min(60_000, next - Date.now())) : 60_000;
    }).then(({ value, changed }) => { if (changed) notifyLive(); scheduleRecurrences(value); })
      .catch(error => { console.error("[mock] recurrence failed:", error); scheduleRecurrences(60_000); });
  }, delay);
}
