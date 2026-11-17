import type { Stats, StatsQuery } from "../types";
import { getToken, http } from "./client";

const cache = new Map<string, { value: Stats; savedAt: number }>();
const MAX_AGE_MS = 60_000;

function cacheKey(query?: StatsQuery) {
  const token = getToken();
  if (!token) return null;
  return `${token}:${query?.start || ''}:${query?.end || ''}`;
}

export function getCachedStats(query?: StatsQuery): Stats | null {
  const key = cacheKey(query);
  if (!key) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > MAX_AGE_MS) { cache.delete(key); return null; }
  return entry.value;
}

export async function getStats(query?: StatsQuery): Promise<Stats> {
  const data = await http.get<Stats>("/stats", query as Record<string, string | undefined>);
  const key = cacheKey(query);
  if (key) {
    if (cache.size >= 10) cache.delete(cache.keys().next().value!);
    cache.set(key, { value: data, savedAt: Date.now() });
  }
  return data;
}
