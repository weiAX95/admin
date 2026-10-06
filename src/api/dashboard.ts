import { http } from "./client";

export type QuickActionKind = "tasks" | "sessions" | "notes";
export interface QuickPreviewItem { id: string; title: string; }
export type QuickActionCounts = Record<QuickActionKind, number>;

export const getQuickActionCounts = () => http.get<QuickActionCounts>("/dashboard/quick-actions");
export const getQuickPreview = (kind: QuickActionKind) =>
  http.get<{ items: QuickPreviewItem[] }>("/dashboard/quick-preview", { kind });
