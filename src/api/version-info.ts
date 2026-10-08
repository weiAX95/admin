import { http } from './client';

export interface ChangelogEntry { version: string; date: string; zh: { title: string; changes: string[] }; en: { title: string; changes: string[] } }
export interface VersionInfo { currentVersion: string; latest: { version: string; url: string } | null; changelog: ChangelogEntry[] }
export const getVersionInfo = () => http.get<VersionInfo>('/settings/version');
