import type { Stats, StatsQuery } from "../types";
import { getToken, http } from "./client";
import { cachedResponse, rememberResponse } from "./responseCache";

function cacheKey(query?: StatsQuery) {
  const token = getToken();
  if (!token) return null;
  return `stats:${query?.start || ''}:${query?.end || ''}`;
}

export function getCachedStats(query?: StatsQuery): Stats | null {
  const key = cacheKey(query);
  if (!key) return null;
  return cachedResponse<Stats>(key);
}

export async function getStats(query?: StatsQuery): Promise<Stats> {
  const token = getToken();
  const key = cacheKey(query);
  const data = await http.get<Stats>("/stats", query as Record<string, string | undefined>);
  if (key && token === getToken()) rememberResponse(key, data);
  return data;
}
