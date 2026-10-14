import { useState } from "react";
import { App, Button, Form, Input } from "antd";
import { ArrowRightOutlined, ExperimentOutlined, LockOutlined, ProfileOutlined, RocketOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { login, verifyMfaLogin } from "../api/auth";
import { setAuth } from "../api/client";
import { useSettings } from "../components/SettingsProvider";
import { deviceFingerprint } from "../utils/deviceFingerprint";

interface LoginForm { username: string; password: string }
export default function Login() {
  const { brand, refresh } = useSettings();
  const [loading, setLoading] = useState(false);
  const [challengeToken, setChallengeToken] = useState('');
  const [challengeFingerprint, setChallengeFingerprint] = useState<string | undefined>();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const onFinish = async (values: LoginForm) => {
    setLoading(true);
    try {
      const fingerprint = await deviceFingerprint();
      const res = await login(values.username, values.password, fingerprint);
      if ('mfaRequired' in res) { setChallengeFingerprint(fingerprint); setChallengeToken(res.challengeToken); message.info('请输入身份验证器中的 6 位验证码，或一次性恢复码'); return; }
      setAuth(res.token, res.user);
      if (!res.user.passwordChangeRequired && !res.user.mfaSetupRequired) await refresh();
      message.success("登录成功");
      navigate(res.user.passwordChangeRequired ? "/change-password" : res.user.mfaSetupRequired ? '/mfa/setup' : "/", { replace: true });
    } catch (err) { message.error(err instanceof Error ? err.message : "登录失败"); }
    finally { setLoading(false); }
  };
  const verifyFactor = async (values: { code: string }) => {
    setLoading(true);
    try {
      const res = await verifyMfaLogin(challengeToken, values.code.trim().toUpperCase(), challengeFingerprint);
      setAuth(res.token, res.user);
      if (!res.user.passwordChangeRequired) await refresh();
      message.success('登录成功');
      navigate(res.user.passwordChangeRequired ? '/change-password' : '/', { replace: true });
    } catch (err) { message.error(err instanceof Error ? err.message : '验证失败'); }
    finally { setLoading(false); }
  };
  return (
    <main className="login-page">
      <div className="login-shell">
        <section className="login-story">
          <div className="login-brand"><span className="brand-mark">{brand.logoUrl ? <img src={brand.logoUrl} alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} /> : <RocketOutlined />}</span><strong>{brand.systemName}</strong></div>
          <div className="login-intro"><span className="page-eyebrow">YOUR LEARNING WORKSPACE</span>
            <h1>把每一次探索，<br />变成持续的进步<span>。</span></h1>
            <p>规划学习路径，沉淀对话与思考。<br />在一个工作空间里，连接目标、知识与实践。</p>
          </div>
          <div className="login-features">
            <div><ProfileOutlined /><span><strong>有序推进</strong><small>规划任务，追踪学习进度</small></span></div>
            <div><ExperimentOutlined /><span><strong>实践积累</strong><small>记录实验，沉淀可复用经验</small></span></div>
          </div>
          <span className="login-story-footer">保持好奇，让每一步都算数。</span>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <span className="login-panel-kicker">开始你的学习旅程</span>
          <h2 id="login-title">欢迎回来</h2>
          <p className="login-description">{challengeToken ? '请完成双因素认证。验证码每 30 秒更新；恢复码只能使用一次。' : '登录账号，继续你的学习与探索。'}</p>
          {challengeToken ? <Form<{ code: string }> layout="vertical" size="large" onFinish={verifyFactor} requiredMark={false}>
            <Form.Item name="code" label="验证码或恢复码" rules={[{ required: true, message: '请输入验证码或恢复码' }]}><Input autoComplete="one-time-code" maxLength={19} /></Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block className="login-submit">完成验证 <ArrowRightOutlined /></Button>
            <Button type="link" block onClick={() => { setChallengeToken(''); setChallengeFingerprint(undefined); }}>返回账号密码登录</Button>
          </Form> : <Form<LoginForm> layout="vertical" size="large" onFinish={onFinish} requiredMark={false}>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
              <Input prefix={<UserOutlined />} placeholder="请输入用户名" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block className="login-submit">登录工作空间 <ArrowRightOutlined /></Button>
          </Form>}
          <p className="login-panel-footer"><LockOutlined /> Agent 学习管理控制台</p>
        </section>
      </div>
    </main>
  );
}
