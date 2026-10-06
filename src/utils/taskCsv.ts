import type { LearningTask, RecurringSeries } from "../types";
import type { TaskColumnKey } from "./taskTable";

export const SNAPSHOT_FIELDS = ["id", "title", "description", "category", "phase", "status", "effectiveStatus", "blockedBy", "dependencyIds", "ownerId", "plannedStartDate", "progress", "manualProgress", "estimatedHours", "completionCycles", "activeCycleStartedAt", "completedAt", "legacyCompletionUnknown", "checklist", "version", "priority", "dueDate", "notes", "resources", "tags", "createdAt", "updatedAt", "recurringSeriesId", "recurrenceIndex", "recurrenceSeries"] as const;
export type SnapshotField = typeof SNAPSHOT_FIELDS[number];
export const IMPORT_FIELDS = ["id", "title", "description", "category", "phase", "status", "dependencyIds", "plannedStartDate", "progress", "manualProgress", "estimatedHours", "checklist", "priority", "dueDate", "notes", "resources", "tags", "recurringSeriesId", "recurrenceIndex", "recurrenceSeries"] as const;
export type ImportField = typeof IMPORT_FIELDS[number];
const COMPLEX = new Set<string>(["dependencyIds", "checklist", "resources", "tags", "recurrenceSeries"]);
const NUMERIC = new Set<string>(["progress", "manualProgress", "estimatedHours", "recurrenceIndex"]);
const ALIASES: Record<string, ImportField> = {
  "任务": "title", "任务标题": "title", "标题": "title", "描述": "description", "任务描述": "description",
  "分类": "category", "阶段": "phase", "状态": "status", "前置任务": "dependencyIds", "依赖": "dependencyIds",
  "计划开始日期": "plannedStartDate", "进度": "progress", "手动进度": "manualProgress", "预估工时": "estimatedHours",
  "检查清单": "checklist", "优先级": "priority", "到期": "dueDate", "到期日": "dueDate", "笔记": "notes",
  "学习资料": "resources", "标签": "tags", "原任务id": "id", "重复序列id": "recurringSeriesId", "重复次数": "recurrenceIndex", "重复配置": "recurrenceSeries",
};

export interface ParsedCsvRow { rowNumber: number; cells: string[]; }
export interface ParsedCsv { headers: string[]; rows: ParsedCsvRow[]; }
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, "");
  const rows: ParsedCsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else { cell += char; if (char === "\n") line++; }
    } else if (char === '"' && !cell) quoted = true;
    else if (char === ",") { cells.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell); cell = "";
      if (cells.some(value => value !== "")) rows.push({ rowNumber: rowStart, cells });
      cells = []; line++; rowStart = line;
    } else cell += char;
  }
  if (quoted) throw new Error(`第 ${rowStart} 行引号未闭合`);
  if (cell || cells.length) { cells.push(cell); rows.push({ rowNumber: rowStart, cells }); }
  if (!rows.length) throw new Error("CSV 文件为空");
  const headers = rows.shift()!.cells.map(value => value.trim());
  if (!headers.some(Boolean)) throw new Error("CSV 缺少表头");
  return { headers, rows };
}

export function decodeCsv(bytes: ArrayBuffer, encoding: "auto" | "utf-8" | "gbk" = "auto") {
  if (encoding !== "auto") return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" as const }; }
  catch { return { text: new TextDecoder("gbk", { fatal: true }).decode(bytes), encoding: "gbk" as const }; }
}

export function autoMapHeaders(headers: string[]): (ImportField | "")[] {
  return headers.map(header => {
    const normalized = header.trim().replace(/[\s_-]/g, "").toLowerCase();
    return ALIASES[normalized] || IMPORT_FIELDS.find(field => field.toLowerCase() === normalized) || "";
  });
}

function parseCell(field: ImportField, cell: string): unknown {
  const value = cell.replace(/^'(?=\s*[=+\-@])/, "");
  if (COMPLEX.has(field)) {
    if (!value.trim()) return field === "recurrenceSeries" ? null : [];
    try { return JSON.parse(value); } catch { throw new Error(`${field} 必须是有效 JSON`); }
  }
  if (NUMERIC.has(field)) {
    if (!value.trim()) return field === "estimatedHours" ? null : undefined;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${field} 必须是数字`);
    return number;
  }
  return value;
}

export function mapCsvRows(parsed: ParsedCsv, mapping: (ImportField | "")[]) {
  const duplicate = mapping.filter(Boolean).filter((field, index, all) => all.indexOf(field) !== index);
  if (duplicate.length) throw new Error(`同一字段不能映射多列：${duplicate.join("、")}`);
  return parsed.rows.map(row => {
    const data: Record<string, unknown> = {};
    const errors: string[] = [];
    mapping.forEach((field, index) => {
      if (!field) return;
      try { const value = parseCell(field, row.cells[index] || ""); if (value !== undefined) data[field] = value; }
      catch (error) { errors.push(error instanceof Error ? error.message : "字段无效"); }
    });
    if (typeof data.title !== "string" || !data.title.trim()) errors.push("缺少 title");
    return { rowNumber: row.rowNumber, data, errors };
  });
}

const VISIBLE_FIELDS: Record<TaskColumnKey, SnapshotField[]> = {
  title: ["title", "description", "tags"], category: ["category"], phase: ["phase"],
  status: ["status", "effectiveStatus", "blockedBy"], priority: ["priority"], progress: ["progress"],
  dueDate: ["dueDate"], createdAt: ["createdAt"], actions: [],
};
export function exportFields(visibleOnly: boolean, columns: TaskColumnKey[]): SnapshotField[] {
  return visibleOnly ? [...new Set(columns.flatMap(key => VISIBLE_FIELDS[key]))] : [...SNAPSHOT_FIELDS];
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function exportTaskCsv(tasks: LearningTask[], fields: SnapshotField[], series: Record<string, RecurringSeries> = {}) {
  const lines = [fields.map(csvCell).join(",")];
  for (const task of tasks) lines.push(fields.map(field => csvCell(field === "recurrenceSeries" ? task.recurringSeriesId ? series[task.recurringSeriesId] || null : null : task[field as keyof LearningTask])).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
