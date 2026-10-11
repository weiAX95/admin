import { useEffect, useState } from "react";
import { Alert, Button, Empty, Space, Spin, Tag, Typography } from "antd";
import { getRelatedSessions } from "../api/sessions";
import type { RelatedSession } from "../api/sessions";

export default function RelatedSessions({ sessionId, onOpen }: { sessionId: string; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<RelatedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void getRelatedSessions(sessionId).then(result => { if (active) setItems(result.items); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "相关会话加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sessionId]);
  return <div className="session-related" style={{ marginTop: 20 }}>
    <Typography.Title level={5}>相关会话</Typography.Title>
    <Typography.Paragraph type="secondary">仅比较同一聊天端用户的提问内容，按共同词汇比例排序。</Typography.Paragraph>
    {loading ? <Spin size="small" /> : error ? <Alert type="warning" message={error} showIcon /> : items.length ?
      <Space direction="vertical" size={4}>{items.map(item => <Space key={item.id} wrap>
        <Button type="link" size="small" onClick={() => onOpen(item.id)}>{item.title}</Button>
        <Tag>相似度 {Math.round(item.score * 100)}%</Tag>
        <Typography.Text type="secondary">{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</Typography.Text>
      </Space>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无相似会话" />}
  </div>;
}
