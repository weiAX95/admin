import { http } from './client';

export interface MetricVersion { id: string; name: string; version: number; rule_type: string; pass_threshold: number; regression_threshold: number }
export interface Dataset { id: string; name: string; latest_version_id: string; latest_version: number; folder_id?: string | null; parent_version_id?: string | null }
export interface DatasetPart { type: 'text' | 'image' | 'audio' | 'video'; text?: string; assetId?: string }
export interface DatasetCase { caseKey: string; variables?: Record<string,string>; input?: string | { parts: DatasetPart[] }; expectedOutput?: string | { parts: DatasetPart[] }; referenceAnswer?: string; context?: { role: string; parts: DatasetPart[] }[]; tags?: string[]; difficulty?: number | string; category?: string; source?: 'manual' | 'session_extract' | 'qa_import'; expectedTools?: { name: string; arguments: Record<string,unknown> }[] }
export interface RegressionReport { batchId: string; status: string; datasetVersionId: string; baselineBatchId: string; metricVersionId: string; passThreshold: number; regressionThreshold: number; total: number; scored: number; passRate: number | null; box: { min: number; q1: number; median: number; q3: number; max: number; count: number } | null; histogram: { range: string; count: number }[]; statusDistribution: Record<string,number>; efficiency: { count: number; p50LatencyMs: number | null; p95LatencyMs: number | null; p99LatencyMs: number | null; averageOutputTokens: number | null }; degraded: { caseKey: string; variantId: string; score: number; baselineScore: number; delta: number; difficulty: string; category: string }[]; byDifficulty: { name: string; count: number; passRate: number | null; averageScore: number | null }[]; byCategory: { name: string; count: number; passRate: number | null; averageScore: number | null }[]; cases: { caseKey: string; variantId: string; variantLabel: string; score: number | null; baselineScore: number; delta: number | null; passed: boolean | null; status: string; difficulty: string; category: string; ruleScore: number | null; judgeScore: number | null; metricDetails?: Record<string,number> | null; input?: unknown; context?: unknown; expectedOutput?: unknown; requestMessages?: unknown; output?: string | null; outputParts?: DatasetPart[] | null; error?: string | null }[] }
export interface Annotation { mine: { rating: number; tags: string[] } | null; summary: { averageRating: number | null; ratingCount: number; tags: { tag: string; count: number }[] } }

export const listMetricVersions = () => http.get<{ items: MetricVersion[] }>('/experiment-metrics');
export const listDatasets = () => http.get<{ items: Dataset[] }>('/experiment-datasets');
export const listBaselines = (datasetVersionId: string, metricVersionId: string) => http.get<{ items: { id: string; created_at: string; experiment_title: string }[] }>('/experiment-baselines', { datasetVersionId, metricVersionId });
export const createDataset = (name: string, cases: DatasetCase[], folderId?: string) => http.post<{ id: string; version: { id: string } }>('/experiment-datasets', { name, cases, folderId });
export const getDatasetVersions = (id: string) => http.get<{ items: { id: string; version: number }[] }>(`/experiment-datasets/${id}/versions`);
export const getDatasetVersion = (id: string) => http.get<{ id: string; cases: Record<string,unknown>[] }>(`/experiment-dataset-versions/${id}`);
export const createDatasetVersion = (id: string, cases: DatasetCase[]) => http.post<{ id: string; version: number }>(`/experiment-datasets/${id}/versions`, { cases });
export const createDatasetSubset = (id: string, versionId: string, name: string, caseKeys: string[], folderId?: string) => http.post<{ id: string }>(`/evaluation/datasets/${id}/subset`, { versionId, name, caseKeys, folderId });
export const listEvaluationFolders = () => http.get<{ items: { id: string; name: string; parent_id: string | null }[] }>('/evaluation/folders');
export const createEvaluationFolder = (name: string, parentId?: string) => http.post<{ id: string }>('/evaluation/folders', { name, parentId });
export interface EvaluationSettings { global_media_bytes: string | number; dataset_media_bytes: string | number; min_free_percent: string | number }
export const getEvaluationSettings = () => http.get<EvaluationSettings>('/evaluation/settings');
export const updateEvaluationSettings = (value: { globalMediaBytes: number; datasetMediaBytes: number; minFreePercent: number }) => http.put<EvaluationSettings>('/evaluation/settings', value);
export interface RankedModel { modelId: string; apiModel: string; runCount: number; score: number; averageAccuracy: number; averageLatencyMs: number; averageOutputTokens: number }
export const getEvaluationLeaderboard = (datasetVersionId: string, metricVersionId: string, weights: Record<string,number>) => http.get<{ items: RankedModel[]; excluded: number }>('/evaluation/leaderboard', { datasetVersionId, metricVersionId, weights: JSON.stringify(weights) });
export const runDataset = (id: string, payload: { datasetVersionId: string; metricVersionId: string; variantIds?: string[] }) => http.post<{ batchId: string }>(`/experiment-definitions/${id}/dataset-run`, payload);
export const runRegression = (id: string, payload: { datasetVersionId: string; baselineBatchId: string; metricVersionId: string; variantIds?: string[] }) => http.post<{ batchId: string }>(`/experiment-definitions/${id}/regression`, payload);
export const getRegressionReport = (id: string) => http.get<RegressionReport>(`/experiment-batches/${id}/report`);
export const previewEvaluationReportShare = (id: string) => http.get<RegressionReport>(`/evaluation/reports/${id}/share-preview`);
export const listEvaluationReportShares = (id: string) => http.get<{ items: { id: string; expires_at: string | null; revoked_at: string | null; created_at: string }[] }>(`/evaluation/reports/${id}/shares`);
export const createEvaluationReportShare = (id: string, expiry: '1h'|'24h'|'7d'|'permanent') => http.post<{ id: string; token: string; path: string; expiresAt: string | null }>(`/evaluation/reports/${id}/shares`, { expiry });
export const revokeEvaluationReportShare = (id: string) => http.post(`/evaluation/report-shares/${id}/revoke`, {});
export const getSharedEvaluationReport = (token: string) => http.get<{ report: RegressionReport; expiresAt: string | null }>(`/public/evaluation-reports/${token}`);
export const getRunAnnotation = (id: string) => http.get<Annotation>(`/experiment-runs/${id}/annotation`);
export const saveRunAnnotation = (id: string, rating: number, tags: string[]) => http.post('/experiment-runs/' + id + '/annotation', { rating, tags });
export const getChainSuggestions = (id: string) => http.get<{ items: { id: string; title: string; similarity: number; chain_id: string | null }[] }>(`/experiments/${id}/chain-suggestions`);
export const confirmChain = (id: string, peerId: string) => http.post<{ chainId: string }>(`/experiments/${id}/chain`, { peerId });
export const getChain = (id: string) => http.get<{ id: string; title: string; items: { id: string; title: string; created_at: string; score: number | null; latency_ms: number | null; cost_usd: number | null }[] }>(`/experiment-chains/${id}`);
export const getExperimentCosts = () => http.get<{ monthTotalUsd: number; byModel: { api_model: string; cost: number }[]; top: { id: string; title: string; cost: number }[] }>('/experiment-costs');
