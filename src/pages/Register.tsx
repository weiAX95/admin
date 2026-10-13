import { useEffect, useState } from 'react';
import { App, Button, Card, Form, Input, Spin, Typography } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { previewAccountInvitation, registerWithInvitation } from '../api/accounts';

type Preview = Awaited<ReturnType<typeof previewAccountInvitation>>;
type RegistrationForm = { name: string; password: string; confirmPassword: string };

export default function Register() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { message } = App.useApp();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState('');
  useEffect(() => {
    if (!token) { setError('邀请链接无效'); return; }
    void previewAccountInvitation(token).then(setPreview).catch(reason => setError(reason instanceof Error ? reason.message : '邀请链接不可用'));
  }, [token]);
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
    <Card title="接受账号邀请" style={{ width: '100%', maxWidth: 460 }}>
      {error ? <Typography.Paragraph type="danger">{error}。请联系管理员重新生成邀请。</Typography.Paragraph> : !preview ? <Spin tip="正在检查邀请"><div style={{ minHeight: 80 }} /></Spin> : completed ? <>
        <Typography.Paragraph>账号 <strong>{completed}</strong> 已创建。{preview.activationMode === 'manual' ? '请等待管理员激活后登录。' : '现在可以登录。'}</Typography.Paragraph>
        <Link to="/login">前往登录</Link>
      </> : <>
        <Typography.Paragraph type="secondary">用户名：{preview.username} · {preview.role === 'admin' ? '管理员' : '普通成员'}<br />邀请有效期至 {new Date(preview.expiresAt).toLocaleString('zh-CN', { hour12: false })}</Typography.Paragraph>
        <Form<RegistrationForm> layout="vertical" initialValues={{ name: preview.name }} onFinish={async values => {
          if (values.password !== values.confirmPassword) { message.error('两次输入的密码不一致'); return; }
          setSaving(true);
          try { const result = await registerWithInvitation(token, values.password, values.name); setCompleted(result.username); message.success('账号已创建'); }
          catch (reason) { message.error(reason instanceof Error ? reason.message : '注册失败'); }
          finally { setSaving(false); }
        }}>
          <Form.Item name="name" label="显示名称" rules={[{ required: true, message: '请输入显示名称' }]}><Input maxLength={30} autoComplete="name" /></Form.Item>
          <Form.Item name="password" label="设置密码" rules={[{ required: true, message: '请输入密码' }, { validator: async (_, value: string) => { if (value && !(value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value))) throw new Error('至少 8 位，包含大小写字母和数字'); } }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item name="confirmPassword" label="确认密码" rules={[{ required: true, message: '请确认密码' }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} block>创建账号</Button>
        </Form>
      </>}
    </Card>
  </main>;
}
