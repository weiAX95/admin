import { http } from './client';

export type ModelProvider = 'legacy' | 'openai' | 'qwen' | 'gemini';
export interface ModelConnection {
  id: string;
  provider: ModelProvider;
  name: string;
  baseUrl: string | null;
  keyMask: string;
  isDefault: boolean;
  active: boolean;
  version: number;
  hasCustomHeaders: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface ConnectionDraft {
  provider: ModelProvider;
  name: string;
  baseUrl?: string | null;
  apiKey?: string;
  headers?: Record<string, string>;
  isDefault: boolean;
  active: boolean;
  version?: number;
}
export const listModelConnections = () => http.get<{ items: ModelConnection[] }>('/settings/model-connections');
export const createModelConnection = (draft: ConnectionDraft) => http.post<ModelConnection>('/settings/model-connections', draft);
export const updateModelConnection = (id: string, draft: ConnectionDraft) => http.put<ModelConnection>(`/settings/model-connections/${id}`, draft);
export const testModelConnection = (id: string, modelId: string) => http.post<{ ok: boolean }>(`/settings/model-connections/${id}/test`, { modelId });
