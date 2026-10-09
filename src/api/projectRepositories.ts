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
