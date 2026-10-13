import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getToken } from '../api/client';

type Props = { children: ReactNode };
type State = { failed: boolean };

function componentNames(info: ErrorInfo) {
  return (info.componentStack || '').split('\n').map(line => /^\s*at ([A-Za-z][A-Za-z0-9_.-]*)/.exec(line)?.[1]).filter((name): name is string => Boolean(name)).slice(0, 12);
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    let token: string | null;
    try { token = getToken(); }
    catch { return; }
    if (!token) return;
    const errorName = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : 'Error';
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: window.location.pathname, errorName, components: componentNames(info) }),
      keepalive: true,
    }).catch(() => undefined);
  }

  render() {
    if (this.state.failed) return <div className="render-error" role="alert">
      <strong>页面暂时无法显示</strong>
      <p>遇到未预期的页面错误。可以重试，或刷新页面重新加载。</p>
      <div><button type="button" onClick={() => this.setState({ failed: false })}>重试</button><button type="button" onClick={() => window.location.reload()}>刷新页面</button></div>
    </div>;
    return this.props.children;
  }
}
