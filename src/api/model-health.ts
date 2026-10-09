import { http } from './client';

export interface ModelHealthItem {
  id: string;
  displayName: string;
  status: 'active' | 'deprecated' | 'retired';
  sampleCount: number;
  qps: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  errorRate5xx: number | null;
  lastCallAt: string | null;
  health: 'healthy' | 'degraded' | 'unknown' | 'retired';
}
export interface ModelHealthReport { windowSeconds: number; measuredAt: string; items: ModelHealthItem[] }
export const getModelHealth = () => http.get<ModelHealthReport>('/model-health');
