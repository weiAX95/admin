import { App, Button, Card, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import MfaPanel from '../components/MfaPanel';
import { logout } from '../api/auth';
import { clearAuth } from '../api/client';

export default function MfaSetup() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const leave = async () => {
    try { await logout(); } catch { message.warning('退出请求失败，本地登录信息已清除'); }
    clearAuth(); navigate('/login', { replace: true });
  };
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
    <Card title="绑定双因素认证" style={{ width: 'min(100%, 560px)' }} extra={<Button onClick={() => void leave()}>退出登录</Button>}>
      <Space direction="vertical" size={16} style={{ display: 'flex' }}>
        <Typography.Paragraph type="secondary">管理员账号需要先完成身份验证器绑定。绑定前，账号只能访问认证相关页面。</Typography.Paragraph>
        <MfaPanel forced />
      </Space>
    </Card>
  </main>;
}
