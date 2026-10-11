import type { MessageAnnotationTag, MessageAnnotationView, SessionDetail, SessionSummary } from "../types";
import { ApiError, clearAuth, getToken, http } from "./client";

export const listSessions = () =>
  http.get<{ items: SessionSummary[] }>("/sessions");

export interface SessionSearchHit {
  sessionId: string;
  messageId: string;
  role: "user" | "assistant";
  userId: string;
  sessionTitle: string;
  at: string;
  snippet: { before: string; match: string; after: string };
}

export const searchSessionMessages = (query: string, regex: boolean, page: number) =>
  http.get<{ items: SessionSearchHit[]; page: number; hasMore: boolean }>("/sessions/search", {
    query, regex: String(regex), page: String(page),
  });

export const getSession = (id: string) =>
  http.get<SessionDetail>(`/sessions/${id}`);

export const annotateSessionMessage = (sessionId: string, messageId: string, rating: number, tags: MessageAnnotationTag[]) =>
  http.post<MessageAnnotationView>(`/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/annotation`, { rating, tags });

export async function exportSelectedSessions(ids: string[], format: "json" | "markdown"): Promise<{ blob: Blob; filename: string }> {
  let response: Response;
  try {
    response = await fetch("/api/sessions/export", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: JSON.stringify({ ids, format }),
    });
  } catch {
    throw new ApiError(0, "无法连接 API，请确认服务已启动");
  }
  if (!response.ok) {
    if (response.status === 401) {
      clearAuth();
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(response.status, payload?.error || `导出失败（${response.status}）`, payload);
  }
  const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || `sessions.${format === "json" ? "json" : "md"}`;
  return { blob: await response.blob(), filename };
}
