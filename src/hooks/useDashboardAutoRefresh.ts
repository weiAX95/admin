import { useEffect, useRef, useState } from "react";
import { getToken } from "../api/client";

export type RefreshSeconds = 0 | 30 | 60 | 120;
export type RefreshTransport = "off" | "paused" | "connecting" | "websocket" | "polling";
const STORAGE_KEY = "dashboard_auto_refresh_seconds";
const OPTIONS: RefreshSeconds[] = [0, 30, 60, 120];

function storedSeconds(): RefreshSeconds {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return OPTIONS.includes(value as RefreshSeconds) ? value as RefreshSeconds : 0;
  } catch { return 0; }
}

export function useDashboardAutoRefresh(onRefresh: () => void) {
  const [seconds, setSeconds] = useState<RefreshSeconds>(storedSeconds);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const [transport, setTransport] = useState<RefreshTransport>(seconds ? "connecting" : "off");
  const wasVisible = useRef(visible);

  useEffect(() => {
    const onVisibility = () => {
      const next = document.visibilityState === "visible";
      if (next && !wasVisible.current && seconds) onRefresh();
      wasVisible.current = next;
      setVisible(next);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [seconds, onRefresh]);

  useEffect(() => {
    if (!seconds) { setTransport("off"); return; }
    if (!visible) { setTransport("paused"); return; }
    let active = true;
    let socket: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let authTimer: ReturnType<typeof setTimeout> | undefined;
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    const stopPolling = () => { if (pollTimer) clearInterval(pollTimer); pollTimer = undefined; };
    const startPolling = () => {
      if (!active) return;
      setTransport("polling");
      if (!pollTimer) pollTimer = setInterval(onRefresh, seconds * 1000);
    };
    const connect = () => {
      if (!active || !getToken() || typeof WebSocket === "undefined") { startPolling(); return; }
      if (!pollTimer) setTransport("connecting");
      const url = new URL("/api/live", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      try { socket = new WebSocket(url); } catch { startPolling(); return; }
      const current = socket;
      let ready = false;
      authTimer = setTimeout(() => { if (!ready) current.close(); }, 5000);
      current.onopen = () => current.send(JSON.stringify({ type: "auth", token: getToken() }));
      current.onmessage = event => {
        let message: { type?: string };
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.type === "ready") {
          ready = true;
          if (authTimer) clearTimeout(authTimer);
          stopPolling();
          setTransport("websocket");
        } else if (message.type === "stats_changed" && ready) {
          if (changeTimer) clearTimeout(changeTimer);
          changeTimer = setTimeout(onRefresh, 200);
        }
      };
      current.onerror = () => current.close();
      current.onclose = () => {
        if (authTimer) clearTimeout(authTimer);
        if (!active) return;
        startPolling();
        retryTimer = setTimeout(connect, Math.min(seconds * 1000, 10_000));
      };
    };
    connect();
    return () => {
      active = false;
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
      if (authTimer) clearTimeout(authTimer);
      if (changeTimer) clearTimeout(changeTimer);
      if (socket) socket.close();
    };
  }, [seconds, visible, onRefresh]);

  const changeSeconds = (value: RefreshSeconds) => {
    setSeconds(value);
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* 无存储权限时仅本次页面生效 */ }
  };
  return { seconds, changeSeconds, transport };
}
