import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Select, Space, Spin, Tag, Timeline, Typography } from "antd";
import { getSessionLearningPath } from "../api/sessions";
import type { SessionLearningPath as Path } from "../api/sessions";

const colors: Record<string, string> = { basic: "blue", advanced: "purple", practical: "green", unknown: "gray" };

export default function SessionLearningPath({ userIds, onOpen }: { userIds: string[]; onOpen: (id: string) => void }) {
  const [userId, setUserId] = useState("");
  const [path, setPath] = useState<Path | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!userIds.includes(userId)) setUserId(userIds[0] || "");
  }, [userIds, userId]);
  useEffect(() => {
    let active = true;
    if (!userId) { setPath(null); return; }
    setLoading(true);
    setError("");
    void getSessionLearningPath(userId).then(result => { if (active) setPath(result); })
      .catch(cause => { if (active) { setPath(null); setError(cause instanceof Error ? cause.message : "学习路径加载失败"); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  return <Card className="collection-card" title="用户学习路径" style={{ marginTop: 20 }}>
    <Space wrap style={{ marginBottom: 16 }}><Typography.Text>聊天端用户</Typography.Text>
      <Select aria-label="选择聊天端用户" value={userId || undefined} placeholder="选择用户" style={{ minWidth: 220 }}
        onChange={setUserId} options={userIds.map(id => ({ value: id, label: id }))} />
      <Typography.Text type="secondary">依据提问关键词识别阶段与主题，可用于回看路径，不代表学习能力评分。</Typography.Text>
    </Space>
    {error && <Alert type="error" message={error} showIcon />}
    {loading ? <div className="session-detail-state"><Spin /> 正在分析路径…</div> : !error && path && <>
      <Space wrap style={{ marginBottom: 18 }}>
        <Tag>{path.sessions.length} 条会话</Tag><Tag>{path.recognizedCount} 条识别阶段</Tag><Tag>{path.topicCount} 个主题</Tag>
        {path.patterns.map(pattern => <Tag color="purple" key={pattern.id} title={pattern.detail}>{pattern.label}</Tag>)}
      </Space>
      {path.sessions.length ? <Timeline items={path.sessions.map(session => ({ color: colors[session.stage], children: <div>
        <Space wrap size={8}><Typography.Text type="secondary">{new Date(session.at).toLocaleString("zh-CN", { hour12: false })}</Typography.Text>
          <Tag color={colors[session.stage]}>{session.stageLabel}</Tag>
          {session.topics.map(topic => <Tag key={topic}>{topic}</Tag>)}
          <Button type="link" size="small" onClick={() => onOpen(session.sessionId)}>{session.title}</Button>
        </Space>
        <Typography.Text type="secondary" style={{ display: "block" }}>提问 {session.questionCount} 条</Typography.Text>
      </div> }))} /> : <Empty description="该用户暂无会话" />}
      {!path.patterns.length && path.sessions.length > 0 && <Typography.Text type="secondary">目前未识别出明确的演进模式。</Typography.Text>}
    </>}
    {!loading && !error && !path && <Empty description="暂无可分析的用户" />}
  </Card>;
}
