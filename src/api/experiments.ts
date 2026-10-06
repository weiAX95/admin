import type { Experiment, ExperimentPayload } from "../types";
import { http } from "./client";

export const getExperiment = (id: string) => http.get<Experiment>(`/experiments/${encodeURIComponent(id)}`);

export const listExperiments = (taskId?: string) =>
  http.get<{ items: Experiment[] }>(
    `/experiments${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ""}`
  );

export const createExperiment = (payload: ExperimentPayload) =>
  http.post<Experiment>("/experiments", payload);

export const updateExperiment = (id: string, payload: ExperimentPayload) =>
  http.put<Experiment>(`/experiments/${id}`, payload);

export const deleteExperiment = (id: string) =>
  http.del<{ deleted: boolean; id: string }>(`/experiments/${id}`);
