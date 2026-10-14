import { http } from './client';

export interface AccountActivityItem {
  id: string; rank: number; username: string; name: string; role: string; status: string;
  lastLoginAt: string | null; lastActiveAt: string | null; inactiveSince: string | null;
  loginDays: number; operationCount: number; pageViews: number;
  mostVisitedModule: string | null; activityScore: number;
}
export const accountActivity = () => http.get<{ items: AccountActivityItem[]; windowDays: number; timezone: string }>('/account-activity');
export const recordPageView = (path: string) => http.post<{ recorded: boolean }>('/account-activity/page-view', { path });
