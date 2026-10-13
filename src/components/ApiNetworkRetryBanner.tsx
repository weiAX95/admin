import { useEffect, useState } from "react";
import { Alert, Button } from "antd";
import { getNetworkRetryState, NETWORK_RETRY_NOW_EVENT, NETWORK_RETRY_STATE_EVENT, type NetworkRetryState } from "../api/client";

export default function ApiNetworkRetryBanner() {
  const [state, setState] = useState<NetworkRetryState>(getNetworkRetryState);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const update = (event: Event) => {
      setNow(Date.now());
      setState((event as CustomEvent<NetworkRetryState>).detail);
    };
    window.addEventListener(NETWORK_RETRY_STATE_EVENT, update);
    return () => window.removeEventListener(NETWORK_RETRY_STATE_EVENT, update);
  }, []);

  useEffect(() => {
    if (!state.pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state.pending]);

  if (!state.pending) return null;
  const seconds = Math.max(0, Math.ceil(((state.retryAt ?? now) - now) / 1000));
  return <div className="api-retry-banner" role="status">
    <Alert type="warning" showIcon message={<span>读取数据时连接中断，将自动重试<span aria-hidden="true">（{seconds} 秒）</span>{state.pending > 1 ? `，${state.pending} 个请求等待中` : ""}</span>}
      action={<Button size="small" onClick={() => window.dispatchEvent(new Event(NETWORK_RETRY_NOW_EVENT))}>立即重试</Button>} />
  </div>;
}
