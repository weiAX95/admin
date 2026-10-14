import { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, Space, Spin, Typography } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { useNavigate } from 'react-router-dom';
import { beginMfaSetup, confirmMfaSetup, disableMfa, me, mfaStatus, type MfaStatus } from '../api/auth';
import { getToken, setAuth } from '../api/client';

export default function MfaPanel({ forced = false }: { forced?: boolean }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void mfaStatus().then(setStatus).catch(cause => setError(cause.message)); }, []);
  const finish = async () => {
    const user = await me();
    const token = getToken();
    if (token) setAuth(token, user);
    if (forced) navigate('/', { replace: true });
    else { setCodes(null); setSetup(null); setStatus(await mfaStatus()); }
  };
  const begin = async ({ currentPassword }: { currentPassword: string }) => {
    setBusy(true); setError('');
    try { setSetup(await beginMfaSetup(currentPassword)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '创建绑定密钥失败'); }
    finally { setBusy(false); }
  };
  const confirm = async ({ code }: { code: string }) => {
    setBusy(true); setError('');
    try { const result = await confirmMfaSetup(code.trim()); setCodes(result.recoveryCodes); setSetup(null); message.success('双因素认证已启用'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '验证码验证失败'); }
    finally { setBusy(false); }
  };
  const disable = async ({ currentPassword, code }: { currentPassword: string; code: string }) => {
    setBusy(true); setError('');
    try { await disableMfa(currentPassword, code.trim().toUpperCase()); setStatus(await mfaStatus()); message.success('双因素认证已关闭'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '关闭失败'); }
    finally { setBusy(false); }
  };
  if (!status && !error) return <Spin />;
  return <Space direction="vertical" size={16} style={{ display: 'flex' }}>
    {error && <Alert type="error" showIcon message={error} />}
    {codes ? <>
      <Alert type="warning" showIcon message="请现在保存这 8 个一次性恢复码" description="每个恢复码只能使用一次，关闭此页后将无法再次查看。请勿与验证码密钥保存在同一设备。" />
      <Typography.Text copyable={{ text: codes.join('\n') }}><pre style={{ whiteSpace: 'pre-wrap' }}>{codes.join('\n')}</pre></Typography.Text>
      <Button type="primary" onClick={() => void finish()}>我已保存恢复码，继续</Button>
    </> : status?.enabled ? <>
      <Typography.Text>双因素认证已启用，剩余 {status.recoveryCodesRemaining} 个恢复码。</Typography.Text>
      {forced && <Button type="primary" onClick={() => void finish()}>继续进入工作空间</Button>}
      {!status.required && <Form layout="vertical" onFinish={disable} style={{ maxWidth: 400 }}>
        <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
        <Form.Item name="code" label="验证码或恢复码" rules={[{ required: true }]}><Input autoComplete="one-time-code" maxLength={19} /></Form.Item>
        <Button danger htmlType="submit" loading={busy}>关闭双因素认证</Button>
      </Form>}
    </> : setup ? <>
      <Typography.Paragraph>使用 Google Authenticator、Authy 等身份验证器扫描二维码，再输入显示的 6 位验证码。也可手动输入下面的密钥。</Typography.Paragraph>
      <div style={{ background: '#fff', width: 'fit-content', padding: 12, borderRadius: 8 }}><QRCodeSVG value={setup.uri} size={192} level="M" /></div>
      <Typography.Text code copyable>{setup.secret}</Typography.Text>
      <Form layout="vertical" onFinish={confirm} style={{ maxWidth: 400 }}>
        <Form.Item name="code" label="6 位验证码" rules={[{ required: true, pattern: /^\d{6}$/, message: '请输入 6 位验证码' }]}><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>验证并启用</Button>
      </Form>
    </> : <>
      {status?.required && <Alert type="warning" showIcon message="管理员必须绑定双因素认证后才能访问工作空间" />}
      <Form layout="vertical" onFinish={begin} style={{ maxWidth: 400 }}>
        <Form.Item name="currentPassword" label="再次输入当前密码" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>开始绑定身份验证器</Button>
      </Form>
    </>}
  </Space>;
}
