import { useState } from "react";
import { App, Button, Form, Input } from "antd";
import { ArrowRightOutlined, ExperimentOutlined, LockOutlined, ProfileOutlined, RocketOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { setAuth } from "../api/client";

interface LoginForm { username: string; password: string }
export default function Login() {
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const onFinish = async (values: LoginForm) => {
    setLoading(true);
    try {
      const res = await login(values.username, values.password);
      setAuth(res.token, res.user);
      message.success("登录成功");
      navigate("/", { replace: true });
    } catch (err) { message.error(err instanceof Error ? err.message : "登录失败"); }
    finally { setLoading(false); }
  };
  return (
    <main className="login-page">
      <div className="login-shell">
        <section className="login-story">
          <div className="login-brand"><span className="brand-mark"><RocketOutlined /></span><strong>Agent 学习管理端</strong></div>
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
          <p className="login-description">登录账号，继续你的学习与探索。</p>
          <Form<LoginForm> layout="vertical" size="large" initialValues={{ username: "admin", password: "admin123" }} onFinish={onFinish} requiredMark={false}>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
              <Input prefix={<UserOutlined />} placeholder="请输入用户名" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block className="login-submit">登录工作空间 <ArrowRightOutlined /></Button>
          </Form>
          <div className="login-demo"><span>演示账号</span><code>admin / admin123</code></div>
          <p className="login-panel-footer"><LockOutlined /> Agent 学习管理控制台</p>
        </section>
      </div>
    </main>
  );
}
