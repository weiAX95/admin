import { useEffect, useState } from "react";
import { Alert, Button } from "antd";
import { getServerErrorState, SERVER_ERROR_STATE_EVENT, type ServerErrorState } from "../api/client";

export default function ApiServerErrorBanner() {
  const [state, setState] = useState<ServerErrorState>(getServerErrorState);

  useEffect(() => {
    const update = (event: Event) => setState((event as CustomEvent<ServerErrorState>).detail);
    window.addEventListener(SERVER_ERROR_STATE_EVENT, update);
    return () => window.removeEventListener(SERVER_ERROR_STATE_EVENT, update);
  }, []);

  if (state.status === null) return null;
  return <div className="api-server-error-banner" role="alert">
    <Alert type="error" showIcon message={`服务暂时无法完成请求（${state.status}）。请稍后刷新页面。`}
      action={<Button size="small" onClick={() => window.location.reload()}>刷新页面</Button>} />
  </div>;
}
