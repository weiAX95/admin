import { http } from './client';

export interface GlobalSettings {
  version: number;
  systemName: string;
  logoUrl: string | null;
  defaultTimezone: string;
  defaultLanguage: 'zh-CN' | 'en-US';
  defaultDateFormat: 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';
  defaultPageSize: 10 | 20 | 50 | 100;
  sessionHours: number;
}
export interface Preferences {
  version: number;
  timezone: string | null;
  language: 'zh-CN' | 'en-US' | null;
  dateFormat: GlobalSettings['defaultDateFormat'] | null;
  theme: 'dark' | 'light';
  primaryColor: string;
  density: 'comfortable' | 'compact';
}
export type PublicSettings = Pick<GlobalSettings, 'systemName' | 'logoUrl' | 'defaultTimezone' | 'defaultLanguage' | 'defaultDateFormat' | 'defaultPageSize'>;
export const getPublicSettings = () => http.get<PublicSettings>('/settings/public');
export const getGlobalSettings = () => http.get<GlobalSettings>('/settings/global');
export const saveGlobalSettings = (data: GlobalSettings) => http.put<GlobalSettings>('/settings/global', data);
export const getPreferences = () => http.get<Preferences>('/settings/preferences');
export const savePreferences = (data: Preferences) => http.put<Preferences>('/settings/preferences', data);
