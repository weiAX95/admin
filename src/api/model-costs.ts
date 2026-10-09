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
export interface ModelCostBudget { monthlyBudgetUsd: string; spentUsd: string; percentage: number | null; version: number; month: string }
export const getModelCostBudget = () => http.get<ModelCostBudget>('/model-cost-budget');
export const saveModelCostBudget = (monthlyBudgetUsd: number, version: number) => http.put<ModelCostBudget>('/model-cost-budget', { monthlyBudgetUsd, version });
