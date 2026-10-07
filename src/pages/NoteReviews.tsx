import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Card, Empty, Form, Input, List, Space, Spin, Switch, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import { completeReview, getReviewSettings, listDueReviews, updateReviewSettings } from "../api/reviews";
import type { ReviewItem, ReviewSettings } from "../types";

const INTERVALS = [1, 2, 4, 7, 15, 30];

export default function NoteReviews() {
  const { message } = App.useApp();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [form] = Form.useForm<{ email: string; emailEnabled: boolean }>();
  const refresh = useCallback(async () => {
    try { const result = await listDueReviews(); setItems(result.items); setToday(result.today); }
    catch (error) { message.error(error instanceof Error ? error.message : "加载复习计划失败"); }
    finally { setLoading(false); }
  }, [message]);
  useEffect(() => {
    void refresh();
    void getReviewSettings().then(value => { setSettings(value); form.setFieldsValue(value); }).catch(() => message.error("加载邮件设置失败"));
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [refresh, form, message]);
  const complete = async (item: ReviewItem) => {
    setBusyId(item.noteId);
    try { await completeReview(item.noteId, item.generation); message.success("已记录复习，下一间隔已安排"); await refresh(); }
    catch (error) { message.error(error instanceof Error ? error.message : "记录复习失败"); await refresh(); }
    finally { setBusyId(null); }
  };
  const saveSettings = async (values: { email: string; emailEnabled: boolean }) => {
    setSavingSettings(true);
    try { const next = await updateReviewSettings(values.email || "", Boolean(values.emailEnabled)); setSettings(next); message.success("邮件设置已保存"); }
    catch (error) { message.error(error instanceof Error ? error.message : "保存设置失败"); }
    finally { setSavingSettings(false); }
  };
  const overdue = items.filter(item => item.dueOn < today).length;
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Card title="今日复习" extra={<Typography.Text type="secondary">待复习 {items.length} 篇 · 逾期 {overdue} 篇</Typography.Text>}>
      {loading ? <Spin /> : items.length ? <List dataSource={items} renderItem={item => <List.Item actions={[<Button key="done" type="primary" loading={busyId === item.noteId} disabled={busyId !== null} onClick={() => void complete(item)}>完成复习</Button>]}>
        <List.Item.Meta title={<Link to={`/notes/${item.noteId}`}>{item.title}</Link>} description={<Space wrap><span>到期 {item.dueOn}</span><span>当前间隔 {INTERVALS[item.step]} 天</span>{item.dueOn < today && <Tag color="orange">已逾期</Tag>}</Space>} />
      </List.Item>} /> : <Empty description="今天没有需要复习的笔记" />}
    </Card>
    <Card title="我的邮件提醒">
      {!settings ? <Spin /> : <>
        {!settings.smtpConfigured && <Alert type="info" showIcon message="当前服务未配置 SMTP；站内提醒正常可用，邮件将在配置后发送。" style={{ marginBottom: 16 }} />}
        <Form form={form} layout="vertical" onFinish={saveSettings} style={{ maxWidth: 480 }}>
          <Form.Item name="email" label="收件邮箱" rules={[{ type: "email", message: "请输入有效邮箱" }]}><Input placeholder="name@example.com" /></Form.Item>
          <Form.Item name="emailEnabled" label="邮件提醒" valuePropName="checked"><Switch /></Form.Item>
          <Button type="primary" htmlType="submit" loading={savingSettings}>保存设置</Button>
        </Form>
      </>}
    </Card>
  </Space>;
}
