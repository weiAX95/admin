import type { MessageAnnotationTag, MessageAnnotationView, SessionDetail, SessionSummary } from "../types";
import { http } from "./client";

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
