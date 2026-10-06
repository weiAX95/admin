import type {
  Activity,
  LearningTask,
  TaskListResponse,
  TaskPayload,
  TaskQuery,
  TaskTemplate,
  ChecklistItem,
  BulkTaskField,
  BulkTaskResult,
  TaskChangeLog,
  TimeEntry,
  TimeEntryInput,
  RecurringSeries,
  RecurrenceInput,
  CsvImportRow,
  CsvImportResult,
} from "../types";
import { http } from "./client";

function buildQuery(params: TaskQuery): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.category) sp.set("category", params.category);
  if (params.phase) sp.set("phase", params.phase);
  if (params.keyword) sp.set("keyword", params.keyword);
  params.tags?.forEach(tag => sp.append("tag", tag));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const listTasks = (params: TaskQuery = {}) =>
  http.get<TaskListResponse>(`/tasks${buildQuery(params)}`);

export const getTask = (id: string) =>
  http.get<LearningTask>(`/tasks/${id}`);

export const createTask = (payload: TaskPayload) =>
  http.post<LearningTask>("/tasks", payload);

export const updateTask = (id: string, payload: TaskPayload) =>
  http.put<LearningTask>(`/tasks/${id}`, payload);

export const patchTask = (id: string, payload: TaskPayload) =>
  http.patch<LearningTask>(`/tasks/${id}`, payload);

export const deleteTask = (id: string) =>
  http.del<{ deleted: boolean; id: string }>(`/tasks/${id}`);

export const getRecurringSeries = (id: string) =>
  http.get<RecurringSeries>(`/recurring-series/${id}`);
export const createRecurringSeries = (taskId: string, input: RecurrenceInput) =>
  http.post<RecurringSeries>("/recurring-series", { taskId, ...input });
export const updateRecurringSeries = (id: string, taskId: string, input: RecurrenceInput) =>
  http.put<RecurringSeries>(`/recurring-series/${id}`, { taskId, ...input });
export const stopRecurringSeries = (id: string) =>
  http.post<RecurringSeries>(`/recurring-series/${id}/stop`, {});

export const bulkTasks = (ids: string[], versions: Record<string, number>, action: "update" | "delete", changes?: Partial<Record<BulkTaskField, string>>) =>
  http.post<BulkTaskResult>("/tasks/bulk", { ids, versions, action, changes });

export const taskChangeLogs = (id: string) =>
  http.get<{ items: TaskChangeLog[]; legacyItems: Activity[] }>(`/tasks/${id}/change-logs`);

export const rollbackTaskChange = (taskId: string, entryId: string, version: number) =>
  http.post<LearningTask>(`/tasks/${taskId}/change-logs/${entryId}/rollback`, { version });

/** 批量导入（JSON） */
export const importTasks = (tasks: unknown[]) =>
  http.post<{ added: number }>("/tasks/import", { tasks });
export const importTasksCsv = (rows: CsvImportRow[], skipInvalid: boolean) =>
  http.post<CsvImportResult>("/tasks/import-csv", { rows, skipInvalid });
export const previewTasksCsv = (rows: CsvImportRow[]) =>
  http.post<{ importable: number; invalid: number; errors: CsvImportResult["errors"] }>("/tasks/import-csv/preview", { rows });

/** 单任务变更历史 */
export const taskActivity = (id: string) =>
  http.get<{ items: Activity[] }>(`/tasks/${id}/activity`);

export const dependencyOptions = (exclude?: string) =>
  http.get<{ items: { id: string; title: string; status: string }[] }>(`/tasks/dependency-options${exclude ? `?exclude=${encodeURIComponent(exclude)}` : ""}`);

export const saveChecklist = (id: string, version: number, checklist: ChecklistItem[]) =>
  http.put<LearningTask>(`/tasks/${id}/checklist`, { version, checklist });

export const saveTaskTags = (id: string, version: number, tags: string[]) =>
  http.put<LearningTask>(`/tasks/${id}/tags`, { version, tags });

export const listTaskTemplates = () => http.get<{ items: TaskTemplate[] }>("/task-templates");
export const saveTaskTemplate = (taskId: string, name: string) =>
  http.post<TaskTemplate>("/task-templates", { taskId, name });

export const listTimeEntries = (taskId: string) =>
  http.get<{ items: TimeEntry[]; actualMinutes: number }>(`/tasks/${taskId}/time-entries`);
export const createTimeEntry = (taskId: string, input: TimeEntryInput) =>
  http.post<TimeEntry>(`/tasks/${taskId}/time-entries`, input);
export const updateTimeEntry = (taskId: string, entryId: string, input: TimeEntryInput) =>
  http.put<TimeEntry>(`/tasks/${taskId}/time-entries/${entryId}`, input);
export const deleteTimeEntry = (taskId: string, entryId: string) =>
  http.del<{ deleted: boolean; id: string }>(`/tasks/${taskId}/time-entries/${entryId}`);
