import { getToken, http } from './client';

export interface BackupJob { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; phase: string; fileSize: number | null; fileCount: number | null; errorCode: string | null; createdAt: string; finishedAt: string | null }
export const listBackups = () => http.get<{ items: BackupJob[] }>('/settings/backups');
export const createBackup = () => http.post<{ id: string; status: string }>('/settings/backups', {});
export async function downloadBackup(id: string): Promise<Blob> {
  const response = await fetch(`/api/settings/backups/${encodeURIComponent(id)}/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!response.ok) throw new Error((await response.json() as { error?: string }).error || '备份下载失败');
  return response.blob();
}
