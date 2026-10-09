import { http } from './client';

export type CostDimension = 'model' | 'user' | 'module';
export interface ModelCostsReport {
  start: string;
  end: string;
  dimension: CostDimension;
  timezone: 'UTC';
  totalUsd: string;
  breakdown: { key: string; name: string; costUsd: string; runParts: number }[];
  trend: { day: string; costUsd: string }[];
  filters: { models: { id: string; name: string }[]; users: { id: string; name: string }[] };
}
export const getModelCosts = (params: { start: string; end: string; dimension: CostDimension; modelId?: string; userId?: string; module?: string }) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => Boolean(value)) as [string, string][]);
  return http.get<ModelCostsReport>(`/model-costs?${query}`);
};
