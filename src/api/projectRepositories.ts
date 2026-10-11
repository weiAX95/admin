import { http } from './client';

export interface ProjectRepository {
  id: string;
  ownerId: string;
  fullName: string;
  url: string;
  branch: string;
  goal: string;
  requirementBaseline: string;
  baselineVersionId: string | null;
  commitSha: string;
  lastCheckedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const listProjectRepositories = () => http.get<{ items: ProjectRepository[] }>('/project-repositories');
export const createProjectRepository = (body: { url: string; branch?: string; goal: string; requirementBaseline?: string }) => http.post<ProjectRepository>('/project-repositories', body);
export const refreshProjectRepository = (id: string) => http.post<ProjectRepository>(`/project-repositories/${id}/refresh`, {});
export interface ProjectRequirementBaseline { id: string; repositoryId: string; version: number; contentSha256: string; createdAt: string; content?: string }
export const listProjectRequirementBaselines = (repositoryId: string) => http.get<{ items: ProjectRequirementBaseline[] }>(`/project-repositories/${repositoryId}/baselines`);
export const getProjectRequirementBaseline = (repositoryId: string, baselineId: string) => http.get<ProjectRequirementBaseline>(`/project-repositories/${repositoryId}/baselines/${baselineId}`);
export const createProjectRequirementBaseline = (repositoryId: string, content: string, currentVersionId: string | null) => http.post<ProjectRequirementBaseline>(`/project-repositories/${repositoryId}/baselines`, { content, currentVersionId });

export interface ProjectScan {
  id: string;
  repositoryId: string;
  commitSha: string;
  treeSha: string | null;
  status: 'queued' | 'scanning' | 'completed' | 'partial' | 'failed';
  coverageComplete: boolean;
  readCount: number;
  attemptedCount: number;
  excludedCount: number;
  failedCount: number;
  unscannedCount: number;
  unscannedSubtrees: number;
  totalBytes: number;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface ProjectScanFile { path: string; gitSha: string; size: number | null; category: string; status: 'read' | 'excluded' | 'failed' | 'unscanned'; reason: string | null; contentSha256: string | null }
export const listProjectScans = (repositoryId: string) => http.get<{ items: ProjectScan[] }>(`/project-repositories/${repositoryId}/scans`);
export const startProjectScan = (repositoryId: string) => http.post<ProjectScan>(`/project-repositories/${repositoryId}/scans`, {});
export const getProjectScan = (repositoryId: string, scanId: string) => http.get<ProjectScan & { files: ProjectScanFile[] }>(`/project-repositories/${repositoryId}/scans/${scanId}`);
export const getProjectScanFile = (repositoryId: string, scanId: string, path: string) => http.get<{ path: string; gitSha: string; contentSha256: string | null; content: string }>(`/project-repositories/${repositoryId}/scans/${scanId}/files?path=${encodeURIComponent(path)}`);

export interface ProjectAnalysisJob {
  id: string; repositoryId: string; scanId: string; commitSha: string; branch: string;
  baselineVersionId: string | null;
  modelId: string; model: string; status: 'queued' | 'analyzing' | 'completed' | 'failed' | 'canceled';
  attempts: number; maxAttempts: number; canceledAt: string | null;
  errorCode: string | null; summary: string | null; selectedFileCount: number;
  availableFileCount: number; analysisCoverageComplete: boolean;
  promptTokens: number | null; completionTokens: number | null; costUsd: number | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
}
export interface ProjectAnalysisReport extends ProjectAnalysisJob {
  fullName: string; goal: string; requirementBaseline: string; staleReasons: string[];
  modules: { moduleKey: string; indexedCount: number; readCount: number; selectedCount: number; truncatedCount: number; excludedCount: number; failedCount: number; unscannedCount: number; summary: string | null }[];
  technologies: { name: string; packageName: string; evidence: { path: string; line: number; excerpt: string; gitSha: string } }[];
  findings: { id: string; moduleKey: string | null; title: string; status: 'implemented' | 'partial' | 'not_found' | 'unverified'; detail: string; evidence: null | { type: 'code' | 'test' | 'document'; path: string; line: number; excerpt: string; gitSha: string }; feedback: { id: string; correctedStatus: 'implemented' | 'partial' | 'not_found' | 'unverified'; reason: string; author: string; createdAt: string }[] }[];
  suggestions: { id: string; findingId: string | null; topic: string; reason: string; practice: string; acceptance: string; impact: 'high' | 'medium' | 'low' | null; impactReason: string | null; prerequisites: string[]; decision: null | { status: 'accepted' | 'ignored'; taskId: string | null; decidedAt: string } }[];
}
export const listProjectAnalyses = (repositoryId: string) => http.get<{ items: ProjectAnalysisJob[] }>(`/project-repositories/${repositoryId}/analyses`);
export const startProjectAnalysis = (repositoryId: string, scanId: string, modelId: string) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses`, { scanId, modelId });
export const getProjectAnalysis = (repositoryId: string, analysisId: string) => http.get<ProjectAnalysisReport>(`/project-repositories/${repositoryId}/analyses/${analysisId}`);
export const cancelProjectAnalysis = (repositoryId: string, analysisId: string) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses/${analysisId}/cancel`, {});
export const retryProjectAnalysis = (repositoryId: string, analysisId: string) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses/${analysisId}/retry`, {});
export const decideProjectSuggestion = (repositoryId: string, analysisId: string, suggestionId: string, action: 'accept' | 'ignore') => http.post<{ suggestionId: string; status: 'accepted' | 'ignored'; taskId: string | null; decidedAt: string }>(`/project-repositories/${repositoryId}/analyses/${analysisId}/suggestions/${suggestionId}/${action}`, {});
export const addProjectFindingFeedback = (repositoryId: string, analysisId: string, findingId: string, correctedStatus: ProjectAnalysisReport['findings'][number]['status'], reason: string) => http.post(`/project-repositories/${repositoryId}/analyses/${analysisId}/findings/${findingId}/feedback`, { correctedStatus, reason });
