import type { MessageAnnotationTag, MessageAnnotationView, SessionDetail, SessionSummary } from "../types";
import { ApiError, clearAuth, getToken, http } from "./client";

export const listSessions = (filters: { quality?: "rejection" | "excessive_length"; clusterId?: string } = {}) =>
  http.get<{ items: SessionSummary[] }>("/sessions", filters);

export interface SessionCluster { id: string; label: string; autoLabel: string; manuallyLabeled: boolean; memberCount: number }
export interface SessionClusters { requestedK: number | 'auto'; lastBuiltAt: string | null; items: SessionCluster[] }
export const listSessionClusters = () => http.get<SessionClusters>('/sessions/clusters');
export const configureSessionClusters = (k: number | 'auto') => http.put<{ requestedK: number | 'auto'; count: number }>('/sessions/clusters/config', { k });
export const renameSessionCluster = (id: string, label: string) => http.patch<{ id: string; label: string }>(`/sessions/clusters/${encodeURIComponent(id)}`, { label });

export interface SessionTokenStats {
  hasData: boolean;
  totalTokens: number | null;
  monthTokens: number | null;
  averagePerSession: number | null;
  reportedSessions: number;
  daily: { date: string; totalTokens: number }[];
  topSessions: { id: string; title: string; totalTokens: number }[];
}
export const getSessionTokenStats = () => http.get<SessionTokenStats>('/sessions/token-stats');

export type SessionPriceMode = 'current' | 'snapshot';
export type SessionCostGranularity = 'day' | 'week' | 'month';
export interface SessionCostRow { id: string; title: string; costUsd: number | null; knownCostUsd: number | null; pricedMessages: number; unpricedMessages: number }
export interface SessionCostStats {
  totalUsd: number | null;
  pricedMessages: number;
  unpricedMessages: number;
  trend: { date: string; costUsd: number }[];
  byModel: { model: string; costUsd: number }[];
  sessions: SessionCostRow[];
}
export interface SessionModelPrice { id: string; name: string; displayName: string; inputUsdPer1K: number; outputUsdPer1K: number; status: string }
export const getSessionCostStats = (priceMode: SessionPriceMode, granularity: SessionCostGranularity) => http.get<SessionCostStats>('/sessions/cost-stats', { priceMode, granularity });
export const getSessionModelPrices = () => http.get<{ items: SessionModelPrice[] }>('/sessions/model-prices');
export const updateSessionModelPrice = (id: string, inputUsdPer1K: number, outputUsdPer1K: number) => http.patch<SessionModelPrice>(`/sessions/model-prices/${encodeURIComponent(id)}`, { inputUsdPer1K, outputUsdPer1K });

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

export interface LearningPathSession {
  sessionId: string;
  at: string;
  title: string;
  questionCount: number;
  stage: "basic" | "advanced" | "practical" | "unknown";
  stageLabel: string;
  topics: string[];
}
export interface SessionLearningPath {
  userId: string;
  sessions: LearningPathSession[];
  patterns: { id: "linear" | "breadth" | "review"; label: string; detail: string }[];
  recognizedCount: number;
  topicCount: number;
}
export const getSessionLearningPath = (userId: string) =>
  http.get<SessionLearningPath>("/sessions/learning-path", { userId });

export interface RelatedSession { id: string; title: string; createdAt: string; score: number }
export const getRelatedSessions = (sessionId: string) =>
  http.get<{ items: RelatedSession[] }>(`/sessions/${encodeURIComponent(sessionId)}/related`);

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
