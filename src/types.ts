/** 学习任务状态 */
export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

/** 优先级 */
export type TaskPriority = "low" | "medium" | "high";

/** 学习阶段 / 路线 */
export type TaskPhase = "基础" | "进阶" | "实战" | "工程化";

/** 学习资料链接 */
export interface TaskResource {
  label: string;
  url: string;
}

export interface ChecklistItem { id: string; text: string; done: boolean; order: number; }
export interface CompletionCycle { startedAt: string; completedAt: string; }
export type TimeEntryInput =
  | { mode: "duration"; workDate: string; hours: number; note: string }
  | { mode: "interval"; startedAt: string; endedAt: string; note: string };
export interface TimeEntry {
  id: string;
  taskId: string;
  recordedBy: string;
  recordedByName: string;
  mode: "duration" | "interval";
  workDate: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}
export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  defaultPhase: string;
  defaultPriority: TaskPriority;
  checklist: string[];
  suggestedResources: TaskResource[];
  ownerId?: string;
}

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";
export type RecurrenceEndType = "never" | "count" | "date";
export interface RecurrenceInput {
  enabled: boolean;
  frequency?: RecurrenceFrequency;
  interval?: number;
  endType?: RecurrenceEndType;
  endCount?: number | null;
  endDate?: string | null;
  version?: number;
  updateSnapshot?: boolean;
}
export interface RecurringSeries extends Required<Pick<RecurrenceInput, "frequency" | "interval" | "endType">> {
  id: string;
  ownerId: string;
  firstTaskId: string;
  anchorDueAt: string;
  endCount: number | null;
  endDate: string | null;
  nextSequence: number;
  active: boolean;
  finished: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 一条 agent 学习任务 */
export interface LearningTask {
  id: string;
  title: string;
  description: string;
  category: string;
  phase: TaskPhase | string;
  status: TaskStatus;
  effectiveStatus: TaskStatus;
  blockedBy: { id: string; title: string }[];
  dependencyIds: string[];
  ownerId?: string;
  plannedStartDate: string;
  progress: number;
  manualProgress: number;
  estimatedHours: number | null;
  completionCycles: CompletionCycle[];
  activeCycleStartedAt: string | null;
  completedAt: string | null;
  legacyCompletionUnknown: boolean;
  checklist: ChecklistItem[];
  version: number;
  priority: TaskPriority;
  dueDate: string;
  notes: string;
  resources: TaskResource[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  recurringSeriesId?: string;
  recurrenceIndex?: number;
}

export interface TaskListResponse {
  total: number;
  items: LearningTask[];
  categories: string[];
  tags: string[];
  recurringSeries?: Record<string, RecurringSeries>;
}

export interface CsvImportRow { rowNumber: number; data: Record<string, unknown>; errors?: string[]; }
export interface CsvImportResult { imported: number; skipped: number; errors: { rowNumber: number; reason: string }[]; }

export interface TaskQuery {
  status?: TaskStatus | "";
  category?: string;
  phase?: string;
  keyword?: string;
  tags?: string[];
}

export type TaskPayload = Partial<Omit<LearningTask, "id" | "createdAt" | "updatedAt" | "version" | "manualProgress" | "effectiveStatus" | "blockedBy" | "ownerId" | "completionCycles" | "activeCycleStartedAt" | "completedAt" | "legacyCompletionUnknown" | "recurringSeriesId" | "recurrenceIndex">> & { recurrence?: RecurrenceInput };

export type BulkTaskField = "status" | "category" | "phase" | "priority" | "dueDate";
export interface BulkTaskResult {
  successCount: number;
  failedCount: number;
  errors: { taskId: string; reason: string }[];
}
export interface TaskChangeLog {
  id: string;
  operationId: string;
  taskId: string;
  changedBy: string;
  changedByName?: string;
  changedAt: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  action: "update" | "rollback";
  sourceEntryId?: string;
}

/* ------------------------------ 会话（web 端联动） ------------------------------ */

export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  annotation?: MessageAnnotationView;
}

export type MessageAnnotationTag = "准确" | "不准确" | "偏题" | "幻觉" | "过于冗长" | "过于简略" | "格式错误";
export interface MessageAnnotationView {
  mine: { rating: number; tags: MessageAnnotationTag[]; updatedAt: string } | null;
  summary: { averageRating: number | null; ratingCount: number; tags: { tag: MessageAnnotationTag; count: number }[] };
}

export interface SessionSummary {
  id: string;
  userId: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[];
}

/* ------------------------------ 学习笔记 ------------------------------ */

export interface Note {
  id: string;
  title: string;
  content: string;
  taskId: string | null;
  sourceSessionId: string | null;
  categoryId: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
export interface NoteCategory { id: string; name: string; parentId: string | null; createdAt: string; updatedAt: string; }
export interface NoteTagDefinition { id: string; name: string; normalizedKey: string; count: number; createdAt: string; updatedAt: string; }
export interface NoteListResponse { items: Note[]; total: number; tags: { name: string; count: number }[]; }
export interface NoteQuery { taskId?: string; keyword?: string; categoryId?: string; tags?: string[]; }
export interface NoteLink {
  label: string;
  targetId: string | null;
  targetRef: string;
  targetTitle?: string | null;
  reason: "missing" | "ambiguous" | null;
  order: number;
}
export interface NoteDetailData extends Note {
  links: NoteLink[];
  backlinks: { id: string; title: string }[];
}
export interface NoteGraphData {
  nodes: { id: string; title: string }[];
  edges: { sourceId: string; targetId: string | null; targetRef: string; label: string; reason: string | null }[];
}
export interface KnowledgeGraphData {
  nodes: { id: string; entityId: string; type: "note" | "task" | "session"; title: string; summary: string; referenceCount: number; missing: boolean }[];
  edges: { sourceId: string; targetId: string; type: "reference" | "association" | "source"; missing: boolean }[];
}
export interface NoteVersion { id: string; noteId: string; versionNumber: number; title: string; content: string; reason: "baseline" | "save" | "restore"; createdAt: string; }

export type NotePayload = Partial<Omit<Note, "id" | "createdAt" | "updatedAt">>;
export interface ReviewItem { noteId: string; title: string; step: number; generation: number; dueOn: string; lastReviewedAt: string | null; }
export interface ReviewNotification { id: string; kind?: string; noteId: string | null; title: string; body?: string; dueOn: string | null; targetUrl?: string; createdAt: string; readAt: string | null; emailStatus: "skipped" | "pending" | "sending" | "sent" | "failed"; }
export interface ReviewSettings { email: string; emailEnabled: boolean; smtpConfigured: boolean; }

/* ------------------------------ 实验记录 ------------------------------ */

export interface Experiment {
  id: string;
  title: string;
  taskId: string | null;
  prompt: string;
  model: string;
  params: string;
  result: string;
  score: number;
  ownerId?: string | null;
  recordKind?: "manual" | "definition";
  createdAt: string;
  updatedAt: string;
}

export type ExperimentPayload = Partial<
  Omit<Experiment, "id" | "createdAt" | "updatedAt">
>;

/* ------------------------------ 审计 / 统计 ------------------------------ */

export type ActivityType =
  | "create"
  | "update"
  | "complete"
  | "delete"
  | "note"
  | "experiment";

export interface Activity {
  id: string;
  type: ActivityType;
  userId?: string;
  username?: string;
  userName?: string;
  taskId: string | null;
  title: string;
  detail: string;
  at: string;
}

/** 分类中的单条任务摘要（用于雷达图 hover 明细） */
export interface CategoryTaskBrief {
  phase: string;
  id: string;
  title: string;
  status: TaskStatus;
  progress: number;
}

export interface CategoryStat {
  category: string;
  count: number;
  doneCount: number;
  avgProgress: number;
  tasks: CategoryTaskBrief[];
}

export interface OverdueTask {
  overdueDays: number;
  severity: "warning" | "moderate" | "severe";
  id: string;
  title: string;
  dueDate: string;
  status: TaskStatus;
}

export interface DayCount {
  date: string;
  count: number;
}

/** 时间窗口类型（仪表盘筛选器） */
export type TimeWindow = "today" | "week" | "month" | "30d" | "90d" | "365d" | "custom";

/** 时间窗口的值表示 */
export interface TimeWindowValue {
  preset: TimeWindow;
  start?: string; // ISO date string — custom 窗口时必填
  end?: string;   // ISO date string — custom 窗口时必填
}

export interface TaskTrendPoint {
  date: string;
  created: number;
  completed: number;
  avgProgress: number | null;
}

export interface TaskTrends {
  items: TaskTrendPoint[];
  progressHistoryStart: string | null;
}

export interface Stats {
  total: number;
  workVariance: { percent: number | null; taskCount: number; highlight: boolean };
  byStatus: Record<TaskStatus, number>;
  avgProgress: number;
  byCategory: CategoryStat[];
  overdue: OverdueTask[];
  dailyDone: DayCount[];
  trends: TaskTrends;
  heatmap: DayCount[];
  recentActivity: Activity[];
}

export interface StatsQuery {
  start?: string; // ISO date
  end?: string;   // ISO date
}

/* ------------------------------ 鉴权 / 账号 ------------------------------ */

export type AccountRole = "admin" | "member";
export type AccountStatus = "active" | "disabled";

/** 一个后台账号（对外不含密码） */
export interface Account {
  id: string;
  username: string;
  name: string;
  role: AccountRole;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

/** 创建/更新账号入参；password 编辑时留空表示不修改 */
export type AccountPayload = Partial<
  Omit<Account, "id" | "createdAt" | "updatedAt">
> & { password?: string };

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: AccountRole;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface ActivityPage {
  items: Activity[];
  total: number;
  nextCursor: string | null;
  users: { id: string; name: string; username: string }[];
}

export interface ActivityDay { date: string; completed: number; created: number; items: Activity[]; }
