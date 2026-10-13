/**
 * 轻量 fetch 封装：统一 baseURL、JSON 头、鉴权头与错误处理。
 * baseURL 走 Vite proxy（/api -> mock server），替换真实后端无需改这里。
 */
const BASE = "/api";

export const TOKEN_KEY = "admin_token";
export const USER_KEY = "admin_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setAuth(token: string, user: unknown) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function getStoredUser<T>(): T | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export const NETWORK_RETRY_STATE_EVENT = "admin:api-network-retry-state";
export const NETWORK_RETRY_NOW_EVENT = "admin:api-network-retry-now";
export type NetworkRetryState = { pending: number; retryAt: number | null };

const pendingRetries = new Map<number, number>();
let nextRetryId = 0;

export function getNetworkRetryState(): NetworkRetryState {
  return { pending: pendingRetries.size, retryAt: pendingRetries.size ? Math.min(...pendingRetries.values()) : null };
}

function announceNetworkRetry() {
  window.dispatchEvent(new CustomEvent<NetworkRetryState>(NETWORK_RETRY_STATE_EVENT, { detail: getNetworkRetryState() }));
}

function waitBeforeRetry(seconds: number): Promise<void> {
  return new Promise(resolve => {
    const id = ++nextRetryId;
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener(NETWORK_RETRY_NOW_EVENT, finish);
      pendingRetries.delete(id);
      announceNetworkRetry();
      resolve();
    };
    const timer = setTimeout(finish, seconds * 1000);
    window.addEventListener(NETWORK_RETRY_NOW_EVENT, finish);
    pendingRetries.set(id, Date.now() + seconds * 1000);
    announceNetworkRetry();
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response | undefined;
  const method = (init?.method || "GET").toUpperCase();
  for (let attempt = 0; attempt < (method === "GET" ? 3 : 1); attempt++) {
    try {
      res = await fetch(`${BASE}${path}`, { ...init, headers });
      break;
    } catch (cause) {
      if (init?.signal?.aborted || (cause instanceof Error && cause.name === "AbortError")) throw cause;
      if (method === "GET" && attempt < 2) {
        await waitBeforeRetry(2 ** (attempt + 1));
        continue;
      }
      throw new ApiError(0, "无法连接 API，请检查网络连接或确认本地服务已启动（npm run dev）");
    }
  }

  if (!res) throw new ApiError(0, "无法连接 API");

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    // 登录接口自身的 401 是“密码错误”，不跳转；其余 401 视为登录态失效
    if (res.status === 401 && !path.startsWith("/auth/login")) {
      clearAuth();
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }
    const msg =
      (data as { error?: string } | null)?.error || `请求失败（${res.status}）`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export const http = {
  get: <T>(path: string, query?: Record<string, string | undefined>) => request<T>(buildUrl(path, query)),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body: body===undefined?undefined:JSON.stringify(body) }),
};
