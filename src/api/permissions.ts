import { http } from './client';

export interface PermissionMatrixResponse {
  roles: { id: string; label: string }[];
  operations: { id: string; label: string }[];
  resources: { id: string; label: string; description: string }[];
  scopes: Record<string, string>;
  cells: Record<string, Record<string, Record<string, string>>>;
}

export const getPermissionMatrix = () => http.get<PermissionMatrixResponse>('/permissions/matrix');
