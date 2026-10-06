/**
 * 独立 mock API 层（零依赖，node:http 实现）。
 * 覆盖：登录鉴权、学习任务 CRUD + 审计、会话记录、学习笔记、实验记录、统计看板。
 * 数据持久化到同目录 db.json；token 仅存内存（重启需重新登录）。
 *
 * 启动：npm run mock   （默认端口 8001，可用 MOCK_PORT 覆盖）
 * 演示账号：admin / admin123
 */
import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { listActivity } from "./activity.mjs";
import { activityHeatmap, activityDay } from "./heatmap.mjs";
import { quickActionCounts, quickPreview } from "./quick-actions.mjs";
import { computeOverdueTasks } from "./overdue.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { initializeTaskTrends, recordTaskTrendEvent, recordTaskTrendSnapshot, computeTaskTrends, trendDateKey } from "./task-trends.mjs";
import { applyTaskProgress, clampProgress as normalizeProgress, normalizeChecklist } from "./task-checklist.mjs";
import { canUseDependency, projectTasks, validateDependencies, validatePlan } from "./task-dependencies.mjs";
import { AUDITED_TASK_FIELDS, recordTaskChanges } from "./task-change-log.mjs";
import { actualMinutes, applyCompletionTransition, initializeTaskWork, normalizeTimeEntry, workVariance } from "./task-worklog.mjs";
import { canGenerate, createSeries, generateDueInstances, occurrenceDueAt, updateSeries } from "./recurring.mjs";
import { prepareCsvImport } from "./task-csv-import.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.MOCK_DB_FILE || path.join(__dirname, "db.json");
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

function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      if (parsed && Array.isArray(parsed.tasks)) {
        // 兼容旧库：回填缺失的集合（如新增的 users）
        if (!Array.isArray(parsed.users)) parsed.users = buildSeed().users;
        if (!Array.isArray(parsed.taskTemplates)) parsed.taskTemplates = [];
        parsed.tasks.forEach(task => { applyTaskProgress(task); initializeTaskWork(task); if (!Array.isArray(task.tags)) task.tags = []; });
        return parsed;
      }
    } catch {
      // 损坏则回退种子
    }
  }
  const db = buildSeed();
  saveDb(db);
  return db;
}

let notifyLive = () => {};
function saveDb(db) {
  const temporary = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(temporary, DB_FILE);
  notifyLive();
}

let db = loadDb();
if (!Array.isArray(db.taskTemplates)) db.taskTemplates = [];
if (!Array.isArray(db.recurringSeries)) { db.recurringSeries = []; saveDb(db); }
db.tasks.forEach(task => { applyTaskProgress(task); initializeTaskWork(task); if (!Array.isArray(task.tags)) task.tags = []; });
if (!Array.isArray(db.timeEntries)) { db.timeEntries = []; saveDb(db); }
if (!Array.isArray(db.changeLogs) || !Array.isArray(db.legacyActivityIds)) {
  if (!Array.isArray(db.changeLogs)) db.changeLogs = [];
  if (!Array.isArray(db.legacyActivityIds)) db.legacyActivityIds = db.activity.map(item => item.id);
  saveDb(db);
}
if (initializeTaskTrends(db)) saveDb(db);

/** 内存 token 表：token -> username */
const tokens = new Map();

/** 对外返回账号时剔除密码字段 */
const publicUser = (u) => ({
  id: u.id, username: u.username, name: u.name,
  role: u.role, status: u.status,
  createdAt: u.createdAt, updatedAt: u.updatedAt,
});

/* ------------------------------ helpers ------------------------------ */

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
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

function authUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return tokens.get(token) || null;
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

function computeStats(tasks, { start, end } = {}) {
  const trends = computeTaskTrends(db, { start, end });
  const byStatus = { todo: 0, in_progress: 0, done: 0, blocked: 0 };
  const catMap = new Map();
  let progressSum = 0;
  const overdue = computeOverdueTasks(tasks);

  // 时间窗口过滤 activity：含 start/end 时只统计该区间内的 activity
  const activityInWindow = (!start && !end)
    ? db.activity
    : db.activity.filter((a) => {
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
    workVariance: workVariance(tasks, db.timeEntries),
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;
  const method = req.method || "GET";

  if (method === "OPTIONS") return send(res, 204, {});

  try {
    // ---- 登录（免鉴权）----
    if (method === "POST" && pathname === "/api/auth/login") {
      const body = await readBody(req);
      const account = db.users.find((u) => u.username === body.username);
      if (!account || account.password !== body.password) {
        return send(res, 401, { error: "用户名或密码错误" });
      }
      if (account.status !== "active") {
        return send(res, 403, { error: "账号已被禁用，请联系管理员" });
      }
      const token = newId();
      tokens.set(token, account.username);
      return send(res, 200, { token, user: publicUser(account) });
    }

    // ---- 其余接口需鉴权 ----
    const username = authUser(req);
    if (!username) return send(res, 401, { error: "未登录或登录已过期" });
    const me = db.users.find((u) => u.username === username) || null;
    if (!me) return send(res, 401, { error: "登录账号不存在，请重新登录" });

    if (method === "GET" && pathname === "/api/auth/me") {
      return send(res, 200, publicUser(me));
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
        return send(res, 200, { items: activityHeatmap(db.activity, url.searchParams.get("start"), url.searchParams.get("end")) });
      } catch (error) { return send(res, 400, { error: error.message }); }
    }
    if (method === "GET" && pathname === "/api/activity/day") {
      try {
        return send(res, 200, activityDay(db.activity, url.searchParams.get("date")));
      } catch (error) { return send(res, 400, { error: error.message }); }
    }

    if (method === "GET" && pathname === "/api/activity") {
      try {
        return send(res, 200, listActivity(db.activity, db.users, Object.fromEntries(url.searchParams)));
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
    }

    if (method === "GET" && pathname === "/api/dashboard/quick-actions") {
      return send(res, 200, quickActionCounts(db));
    }
    if (method === "GET" && pathname === "/api/dashboard/quick-preview") {
      try { return send(res, 200, quickPreview(db, url.searchParams.get("kind"))); }
      catch (error) { return send(res, 400, { error: error.message }); }
    }

    // ---- stats ----
    if (method === "GET" && pathname === "/api/stats") {
      const start = url.searchParams.get("start") || "";
      const end = url.searchParams.get("end") || "";
      return send(res, 200, computeStats(projectTasks(db.tasks).map(task => ({ ...task, status: task.effectiveStatus })), { start, end }));
    }

    // ---- 账号管理（仅管理员）----
    const isUsersPath =
      pathname === "/api/users" || /^\/api\/users\/[^/]+$/.test(pathname);
    if (isUsersPath) {
      if (me.role !== "admin") {
        return send(res, 403, { error: "需要管理员权限" });
      }

      if (pathname === "/api/users") {
        if (method === "GET") {
          const items = [...db.users]
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
            .map(publicUser);
          return send(res, 200, { items });
        }
        if (method === "POST") {
          const body = await readBody(req);
          const uname = String(body.username || "").trim();
          const pwd = String(body.password || "");
          if (!uname) return send(res, 400, { error: "username 为必填项" });
          if (!pwd) return send(res, 400, { error: "password 为必填项" });
          if (db.users.some((u) => u.username === uname)) {
            return send(res, 409, { error: "用户名已存在" });
          }
          const t = nowIso();
          const account = {
            id: newId(), username: uname, password: pwd,
            name: String(body.name || "").trim() || uname,
            role: body.role === "admin" ? "admin" : "member",
            status: body.status === "disabled" ? "disabled" : "active",
            createdAt: t, updatedAt: t,
          };
          db.users.push(account);
          saveDb(db);
          return send(res, 201, publicUser(account));
        }
        return send(res, 405, { error: "method not allowed" });
      }

      const um = pathname.match(/^\/api\/users\/([^/]+)$/);
      const index = db.users.findIndex((u) => u.id === um[1]);
      if (index === -1) return send(res, 404, { error: "user not found" });
      const target = db.users[index];
      const adminCount = () => db.users.filter((u) => u.role === "admin").length;

      if (method === "PUT" || method === "PATCH") {
        const body = await readBody(req);
        if (typeof body.name === "string" && body.name.trim()) {
          target.name = body.name.trim();
        }
        if (body.role === "admin" || body.role === "member") {
          if (target.role === "admin" && body.role !== "admin" && adminCount() <= 1) {
            return send(res, 400, { error: "不能降级唯一的管理员" });
          }
          target.role = body.role;
        }
        if (body.status === "active" || body.status === "disabled") {
          if (target.username === me.username && body.status === "disabled") {
            return send(res, 400, { error: "不能禁用当前登录账号" });
          }
          target.status = body.status;
          // 禁用后失效其现有 token
          if (body.status === "disabled") {
            for (const [tk, un] of tokens) if (un === target.username) tokens.delete(tk);
          }
        }
        if (typeof body.password === "string" && body.password) {
          target.password = body.password;
        }
        target.updatedAt = nowIso();
        db.users[index] = target;
        saveDb(db);
        return send(res, 200, publicUser(target));
      }

      if (method === "DELETE") {
        if (target.username === me.username) {
          return send(res, 400, { error: "不能删除当前登录账号" });
        }
        if (target.role === "admin" && adminCount() <= 1) {
          return send(res, 400, { error: "不能删除唯一的管理员" });
        }
        db.users.splice(index, 1);
        for (const [tk, un] of tokens) if (un === target.username) tokens.delete(tk);
        saveDb(db);
        return send(res, 200, { deleted: true, id: target.id });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    // ---- task templates ----
    if (pathname === "/api/task-templates") {
      if (method === "GET") return send(res, 200, { items: [...PRESET_TEMPLATES, ...db.taskTemplates.filter(item => item.ownerId === me.id)] });
      if (method === "POST") {
        const body = await readBody(req);
        const source = db.tasks.find(item => item.id === body.taskId);
        if (!source) return send(res, 404, { error: "来源任务不存在" });
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
      if (!task) return send(res, 404, { error: "任务不存在" });
      if (!canUseDependency(task, me)) return send(res, 403, { error: "无权修改该任务" });
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
      if (me.role !== "admin" && series.ownerId !== me.id) return send(res, 403, { error: "无权修改该重复序列" });
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
        let list = projectTasks(db.tasks);
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
        return send(res, 200, { total: list.length, items: list, recurringSeries: Object.fromEntries(db.recurringSeries.filter(series => ids.has(series.id)).map(series => [series.id, seriesView(series)])), categories: [...new Set(db.tasks.map(task => task.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")), tags: [...new Set([...PRESET_TAGS, ...db.tasks.flatMap(task => task.tags || [])])] });
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
        return send(res, 201, projectTasks(db.tasks).find(item => item.id === task.id));
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
        if (!before) issues.push({ taskId: id, reason: "任务不存在" });
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

      if (method === "GET") return send(res, 200, projectTasks(db.tasks)[index]);

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
          if (existingSeries && me.role !== "admin" && existingSeries.ownerId !== me.id) return send(res, 403, { error: "无权修改该重复序列" });
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
        return send(res, 200, projectTasks(db.tasks)[index]);
      }

      if (method === "DELETE") {
        const previousStates = dependencyStates();
        const [removed] = db.tasks.splice(index, 1);
        db.timeEntries = db.timeEntries.filter(entry => entry.taskId !== id);
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
      if (entry.recordedBy !== me.id && me.role !== "admin") return send(res, 403, { error: "只能修改自己的工时记录" });
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
      return send(res, 200, projectTasks(db.tasks).find(item => item.id === after.id));
    }

    const tagsRoute = pathname.match(/^\/api\/tasks\/([^/]+)\/tags$/);
    if (tagsRoute && method === "PUT") {
      const task = db.tasks.find(item => item.id === tagsRoute[1]);
      if (!task) return send(res, 404, { error: "task not found" });
      const body = await readBody(req);
      if (!Number.isInteger(body.version)) return send(res, 400, { error: "version 为必填整数" });
      if (body.version !== task.version) return send(res, 409, { error: "任务已被其他操作修改，请加载最新版本后重试", latest: projectTasks(db.tasks).find(item => item.id === task.id) });
      const before = structuredClone(task);
      const after = prepareTaskUpdate(task, { tags: body.tags });
      db.tasks[db.tasks.indexOf(task)] = after;
      recordTaskChanges(db, before, after, me);
      logAction("update", { taskId: after.id, title: after.title, detail: "更新任务标签" });
      saveDb(db);
      return send(res, 200, projectTasks(db.tasks).find(item => item.id === after.id));
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
        return send(res, 409, { error: "任务已被其他操作修改，请刷新后重试", latest: projectTasks(db.tasks).find(item => item.id === task.id) });
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
      return send(res, 200, projectTasks(db.tasks).find(item => item.id === task.id));
    }

    // 单任务审计
    const taskAct = pathname.match(/^\/api\/tasks\/([^/]+)\/activity$/);
    if (taskAct && method === "GET") {
      const list = db.activity.filter((a) => a.taskId === taskAct[1]);
      return send(res, 200, { items: list });
    }

    // ---- sessions ----
    if (pathname === "/api/sessions" && method === "GET") {
      const items = db.sessions.map((s) => ({
        id: s.id, userId: s.userId, createdAt: s.createdAt, updatedAt: s.updatedAt,
        messageCount: s.messages.length,
        title: (s.messages.find((m) => m.role === "user")?.content || "（无标题）").slice(0, 40),
      }));
      items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return send(res, 200, { items });
    }
    const sess = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sess && method === "GET") {
      const s = db.sessions.find((x) => x.id === sess[1]);
      if (!s) return send(res, 404, { error: "session not found" });
      const title = (s.messages.find((m) => m.role === "user")?.content || "（无标题）").slice(0, 40);
      return send(res, 200, { ...s, title, messageCount: s.messages.length });
    }
    // web 端上报会话（预留联动入口）
    if (pathname === "/api/sessions/ingest" && method === "POST") {
      const body = await readBody(req);
      const s = {
        id: body.id || newId(),
        userId: body.userId || "unknown",
        createdAt: nowIso(), updatedAt: nowIso(),
        messages: Array.isArray(body.messages) ? body.messages : [],
      };
      db.sessions.unshift(s);
      saveDb(db);
      return send(res, 201, s);
    }

    // ---- notes ----
    if (pathname === "/api/notes") {
      if (method === "GET") {
        const taskId = url.searchParams.get("taskId");
        const items = db.notes.filter(note => !taskId || note.taskId === taskId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        return send(res, 200, { items });
      }
      if (method === "POST") {
        const body = await readBody(req);
        if (!body.title || !String(body.title).trim()) return send(res, 400, { error: "title 为必填项" });
        const t = nowIso();
        const note = {
          id: newId(), title: String(body.title).trim(),
          content: typeof body.content === "string" ? body.content : "",
          taskId: body.taskId || null,
          sourceSessionId: body.sourceSessionId || null,
          createdAt: t, updatedAt: t,
        };
        db.notes.unshift(note);
        logAction("note", { taskId: note.taskId, title: note.title, detail: "新增学习笔记" });
        saveDb(db);
        return send(res, 201, note);
      }
      return send(res, 405, { error: "method not allowed" });
    }
    const noteOne = pathname.match(/^\/api\/notes\/([^/]+)$/);
    if (noteOne) {
      const i = db.notes.findIndex((n) => n.id === noteOne[1]);
      if (i === -1) return send(res, 404, { error: "note not found" });
      if (method === "GET") return send(res, 200, db.notes[i]);
      if (method === "PUT" || method === "PATCH") {
        const body = await readBody(req);
        const w = {};
        if (typeof body.title === "string") w.title = body.title.trim();
        if (typeof body.content === "string") w.content = body.content;
        if ("taskId" in body) w.taskId = body.taskId || null;
        db.notes[i] = { ...db.notes[i], ...w, updatedAt: nowIso() };
        saveDb(db);
        return send(res, 200, db.notes[i]);
      }
      if (method === "DELETE") {
        const [rm] = db.notes.splice(i, 1);
        saveDb(db);
        return send(res, 200, { deleted: true, id: rm.id });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    // ---- experiments ----
    if (pathname === "/api/experiments") {
      if (method === "GET") {
        const taskId = url.searchParams.get("taskId");
        let items = [...db.experiments];
        if (taskId) items = items.filter((e) => e.taskId === taskId);
        items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return send(res, 200, { items });
      }
      if (method === "POST") {
        const body = await readBody(req);
        if (!body.title || !String(body.title).trim()) return send(res, 400, { error: "title 为必填项" });
        const t = nowIso();
        const exp = {
          id: newId(), title: String(body.title).trim(),
          taskId: body.taskId || null,
          prompt: typeof body.prompt === "string" ? body.prompt : "",
          model: typeof body.model === "string" ? body.model : "",
          params: typeof body.params === "string" ? body.params : "",
          result: typeof body.result === "string" ? body.result : "",
          score: clampProgress(body.score ?? 0) > 5 ? 5 : Math.max(0, Math.round(Number(body.score) || 0)),
          createdAt: t, updatedAt: t,
        };
        db.experiments.unshift(exp);
        logAction("experiment", { taskId: exp.taskId, title: exp.title, detail: "记录一次实验" });
        saveDb(db);
        return send(res, 201, exp);
      }
      return send(res, 405, { error: "method not allowed" });
    }
    const expOne = pathname.match(/^\/api\/experiments\/([^/]+)$/);
    if (expOne) {
      const i = db.experiments.findIndex((e) => e.id === expOne[1]);
      if (i === -1) return send(res, 404, { error: "experiment not found" });
      if (method === "GET") return send(res, 200, db.experiments[i]);
      if (method === "PUT" || method === "PATCH") {
        const body = await readBody(req);
        const w = {};
        if (typeof body.title === "string") w.title = body.title.trim();
        if ("taskId" in body) w.taskId = body.taskId || null;
        if (typeof body.prompt === "string") w.prompt = body.prompt;
        if (typeof body.model === "string") w.model = body.model;
        if (typeof body.params === "string") w.params = body.params;
        if (typeof body.result === "string") w.result = body.result;
        if (body.score !== undefined) w.score = Math.max(0, Math.min(5, Math.round(Number(body.score) || 0)));
        db.experiments[i] = { ...db.experiments[i], ...w, updatedAt: nowIso() };
        saveDb(db);
        return send(res, 200, db.experiments[i]);
      }
      if (method === "DELETE") {
        const [rm] = db.experiments.splice(i, 1);
        saveDb(db);
        return send(res, 200, { deleted: true, id: rm.id });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, 400, { error: err instanceof Error ? err.message : "bad request" });
  }
});

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
  ws.on("message", (raw) => {
    if (liveClients.has(ws)) return;
    let message;
    try { message = JSON.parse(String(raw)); } catch { ws.close(1008, "invalid authentication"); return; }
    const username = message?.type === "auth" ? tokens.get(message.token) : null;
    const user = username ? db.users.find((item) => item.username === username && item.status === "active") : null;
    if (!user) { ws.close(1008, "invalid authentication"); return; }
    clearTimeout(authTimeout);
    liveClients.set(ws, message.token);
    ws.send(JSON.stringify({ type: "ready" }));
  });
  ws.on("close", () => { clearTimeout(authTimeout); liveClients.delete(ws); });
  ws.on("error", () => { clearTimeout(authTimeout); liveClients.delete(ws); });
});
notifyLive = () => {
  const payload = JSON.stringify({ type: "stats_changed" });
  for (const [ws, token] of liveClients) {
    const username = tokens.get(token);
    const active = username && db.users.some((user) => user.username === username && user.status === "active");
    if (!active) { ws.close(1008, "authentication expired"); liveClients.delete(ws); continue; }
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock] agent-admin API listening on http://127.0.0.1:${PORT}（demo: admin/admin123）`);
  scheduleRecurrences(0);
});

let recurrenceTimer;
function scheduleRecurrences(delay) {
  clearTimeout(recurrenceTimer);
  recurrenceTimer = setTimeout(() => {
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
    if (count === 100) return scheduleRecurrences(0);
    const next = db.recurringSeries
      .filter(series => canGenerate(series, series.nextSequence))
      .map(series => Date.parse(occurrenceDueAt(series, series.nextSequence - 1)))
      .reduce((minimum, value) => Math.min(minimum, value), Infinity);
    scheduleRecurrences(Number.isFinite(next) ? Math.max(0, Math.min(60_000, next - Date.now())) : 60_000);
  }, delay);
}
