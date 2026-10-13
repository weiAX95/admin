import { useState } from 'react';
import { App, Button, Card, Form, Input, Typography } from 'antd';
import { Navigate, useNavigate } from 'react-router-dom';
import { changePassword, logout } from '../api/auth';
import { clearAuth, getToken, setAuth } from '../api/client';

interface PasswordForm { currentPassword: string; newPassword: string; confirmPassword: string }

export default function ChangePassword() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  if (!getToken()) return <Navigate to="/login" replace />;
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
    <Card title="密码已过期" style={{ width: '100%', maxWidth: 440 }}>
      <Typography.Paragraph type="secondary">为保护账号，请先修改密码，再继续使用工作空间。</Typography.Paragraph>
      <Form<PasswordForm> layout="vertical" onFinish={async values => {
        if (values.newPassword !== values.confirmPassword) { message.error('两次输入的新密码不一致'); return; }
        setSaving(true);
        try {
          const session = await changePassword(values.currentPassword, values.newPassword);
          setAuth(session.token, session.user);
          message.success('密码已更新');
          navigate('/', { replace: true });
        } catch (error) { message.error(error instanceof Error ? error.message : '修改密码失败'); }
        finally { setSaving(false); }
      }}>
        <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}><Input.Password autoComplete="current-password" /></Form.Item>
        <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { validator: async (_, value: string) => { if (value && !(value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value))) throw new Error('至少 8 位，包含大小写字母和数字'); } }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item name="confirmPassword" label="确认新密码" rules={[{ required: true, message: '请确认新密码' }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} block>修改密码并继续</Button>
      </Form>
      <Button type="link" onClick={() => { void logout().catch(() => undefined).finally(() => { clearAuth(); navigate('/login', { replace: true }); }); }}>退出登录</Button>
    </Card>
  </main>;
}
