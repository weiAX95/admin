import type { SessionDetail, SessionSummary } from "../types";
import { http } from "./client";

export const listSessions = () =>
  http.get<{ items: SessionSummary[] }>("/sessions");

export const getSession = (id: string) =>
  http.get<SessionDetail>(`/sessions/${id}`);
