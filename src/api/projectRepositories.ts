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
