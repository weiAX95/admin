import type { MessageAnnotationTag, MessageAnnotationView, SessionDetail, SessionSummary } from "../types";
import { http } from "./client";

export const listSessions = () =>
  http.get<{ items: SessionSummary[] }>("/sessions");

export const getSession = (id: string) =>
  http.get<SessionDetail>(`/sessions/${id}`);

export const annotateSessionMessage = (sessionId: string, messageId: string, rating: number, tags: MessageAnnotationTag[]) =>
  http.post<MessageAnnotationView>(`/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/annotation`, { rating, tags });
