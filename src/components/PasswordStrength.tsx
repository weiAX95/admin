import { Progress, Typography } from 'antd';

export default function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const valid = password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password);
  const strength = Math.min(100, 20 + Number(password.length >= 8) * 20
    + Number(/[A-Z]/.test(password) && /[a-z]/.test(password)) * 20
    + Number(/[0-9]/.test(password)) * 20
    + Number(password.length >= 12 || /[^A-Za-z0-9]/.test(password)) * 20);
  return <div aria-live="polite" style={{ marginTop: -16, marginBottom: 20 }}>
    <Progress percent={strength} showInfo={false} status={valid ? 'success' : 'normal'} size="small" />
    <Typography.Text type={valid ? 'success' : 'secondary'}>
      {!valid ? '弱' : strength >= 100 ? '强' : '中'} · 至少 8 位，包含大小写字母和数字
    </Typography.Text>
  </div>;
}
