const entries = new Map<string, { value: unknown; savedAt: number }>();
const MAX_AGE_MS = 60_000;
const MAX_ENTRIES = 20;

export function cachedResponse<T>(key: string): T | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > MAX_AGE_MS) { entries.delete(key); return null; }
  return entry.value as T;
}

export function rememberResponse<T>(key: string, value: T): T {
  entries.delete(key);
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  entries.set(key, { value, savedAt: Date.now() });
  return value;
}

export function clearResponseCache() { entries.clear(); }
