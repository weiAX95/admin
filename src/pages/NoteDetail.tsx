import { useEffect, useState } from "react";
import { Alert, Button, Card, Descriptions, Spin, Typography } from "antd";
import { Link, useParams } from "react-router-dom";
import { getNote } from "../api/notes";
import type { Note } from "../types";

export default function NoteDetail() {
  const { id } = useParams();
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    getNote(id || "").then(value => { if (alive) setNote(value); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "加载笔记失败"); });
    return () => { alive = false; };
  }, [id]);
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!note) return <Spin className="task-detail-loading" />;
  return <Card title={note.title} extra={note.taskId ? <Link to={`/tasks/${note.taskId}`}>返回关联任务</Link> : <Link to="/notes">返回笔记列表</Link>}>
    <Descriptions column={1} items={[
      { key: "updated", label: "更新时间", children: new Date(note.updatedAt).toLocaleString("zh-CN", { hour12: false }) },
      { key: "source", label: "来源", children: note.sourceSessionId ? "会话沉淀" : "手动创建" },
    ]} />
    <Typography.Paragraph className="linked-detail-content">{note.content || "暂无内容"}</Typography.Paragraph>
    <Button href="/notes">查看全部笔记</Button>
  </Card>;
}
