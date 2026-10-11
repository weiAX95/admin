import { http } from './client';

export interface ProjectRepository {
  id: string;
  ownerId: string;
  fullName: string;
  url: string;
  branch: string;
  goal: string;
  requirementBaseline: string;
  commitSha: string;
  lastCheckedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const listProjectRepositories = () => http.get<{ items: ProjectRepository[] }>('/project-repositories');
export const createProjectRepository = (body: { url: string; branch?: string; goal: string; requirementBaseline?: string }) => http.post<ProjectRepository>('/project-repositories', body);
export const refreshProjectRepository = (id: string) => http.post<ProjectRepository>(`/project-repositories/${id}/refresh`, {});

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
  modelId: string; model: string; status: 'queued' | 'analyzing' | 'completed' | 'failed' | 'canceled';
  attempts: number; maxAttempts: number; canceledAt: string | null;
  errorCode: string | null; summary: string | null; selectedFileCount: number;
  availableFileCount: number; analysisCoverageComplete: boolean;
  promptTokens: number | null; completionTokens: number | null; costUsd: number | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
}
export interface ProjectAnalysisReport extends ProjectAnalysisJob {
  fullName: string; goal: string; requirementBaseline: string;
  modules: { moduleKey: string; indexedCount: number; readCount: number; selectedCount: number; truncatedCount: number; excludedCount: number; failedCount: number; unscannedCount: number }[];
  findings: { id: string; title: string; status: 'implemented' | 'partial' | 'not_found' | 'unverified'; detail: string; evidence: null | { type: 'code' | 'test' | 'document'; path: string; line: number; excerpt: string; gitSha: string } }[];
  suggestions: { id: string; findingId: string | null; topic: string; reason: string; practice: string; acceptance: string }[];
}
export const listProjectAnalyses = (repositoryId: string) => http.get<{ items: ProjectAnalysisJob[] }>(`/project-repositories/${repositoryId}/analyses`);
export const startProjectAnalysis = (repositoryId: string, scanId: string, modelId: string) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses`, { scanId, modelId });
export const getProjectAnalysis = (repositoryId: string, analysisId: string) => http.get<ProjectAnalysisReport>(`/project-repositories/${repositoryId}/analyses/${analysisId}`);
export const cancelProjectAnalysis = (repositoryId: string, analysisId: string) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses/${analysisId}/cancel`, {});
export const retryProjectAnalysis = (repositoryId: string, analysisId: string) => http.post<ProjectAnalysisJob>(`/project-repositories/${repositoryId}/analyses/${analysisId}/retry`, {});
