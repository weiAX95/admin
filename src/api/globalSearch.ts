import { http } from './client';

export type GlobalSearchType = 'task' | 'note' | 'session' | 'experiment' | 'prompt' | 'case';
export interface GlobalSearchHit {
  type: GlobalSearchType;
  id: string;
  title: string;
  preview: string;
  href: string;
}

export const searchGlobally = (query: string) =>
  http.get<{ items: GlobalSearchHit[] }>('/search', { query });
