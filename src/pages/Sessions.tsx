import { useCallback, useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { LinkOutlined, FileTextOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { listSessions, getSession } from "../api/sessions";
import { createNote } from "../api/notes";
import { listTasks } from "../api/tasks";
import type { LearningTask, SessionDetail, SessionMessage, SessionSummary } from "../types";

export default function Sessions() {
  const { message } = App.useApp();
  const [items, setItems] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [tasks, setTasks] = useState<LearningTask[]>([]);
  const [linkMsg, setLinkMsg] = useState<SessionMessage | null>(null);
  const [linkTaskId, setLinkTaskId] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSessions();
      setItems(res.items);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载会话失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
    listTasks({})
      .then((res) => setTasks(res.items))
      .catch(() => setTasks([]));
  }, [load]);

  const openDetail = async (id: string) => {
    try {
      const d = await getSession(id);
      setDetail(d);
      setDetailOpen(true);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载会话详情失败");
    }
  };

  /** 沉淀为笔记：taskId 为空=独立笔记；传入 taskId=关联到任务 */
  const sinkNote = async (msg: SessionMessage, taskId: string | null) => {
    if (!detail) return;
    try {
      await createNote({
        title: msg.content.slice(0, 30) || "会话沉淀",
        content: msg.content,
        taskId,
        sourceSessionId: detail.id,
      });
      message.success(taskId ? "已关联到学习任务并沉淀为笔记" : "已沉淀为学习笔记");
      setLinkMsg(null);
      setLinkTaskId(undefined);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "沉淀失败");
    }
  };

  const columns: ColumnsType<SessionSummary> = [
    {
      title: "会话主题",
      dataIndex: "title",
      key: "title",
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    { title: "用户", dataIndex: "userId", key: "userId", width: 140 },
    {
      title: "消息数",
      dataIndex: "messageCount",
      key: "messageCount",
      width: 90,
      render: (v: number) => <Tag>{v}</Tag>,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (v: string) => new Date(v).toLocaleString("zh-CN", { hour12: false }),
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => void openDetail(row.id)}>
          查看
        </Button>
      ),
    },
  ];

  return (
    <Card className="collection-card" title={<span className="collection-title">会话列表<span className="collection-count">{items.length} 条</span></span>}>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        scroll={{ x: 760 }}
        pagination={{ pageSize: 8, showSizeChanger: false }}
      />

      <Drawer
        title={detail ? `会话 · ${detail.title}` : "会话详情"}
        width={560}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        {detail && detail.messages.length === 0 && <Empty description="暂无消息" />}
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {detail?.messages.map((m) => (
            <div key={m.id} className={`session-message ${m.role === "user" ? "session-message-user" : ""}`}>
              <Space size={8} style={{ marginBottom: 6 }}>
                <Tag color={m.role === "user" ? "purple" : "cyan"}>
                  {m.role === "user" ? "用户" : "Agent"}
                </Tag>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {new Date(m.at).toLocaleString("zh-CN", { hour12: false })}
                </Typography.Text>
              </Space>
              <div className="session-message-content">{m.content}</div>
              {m.role === "assistant" && (
                <Space size={8} style={{ marginTop: 8 }}>
                  <Button
                    size="small"
                    icon={<FileTextOutlined />}
                    onClick={() => void sinkNote(m, null)}
                  >
                    沉淀为笔记
                  </Button>
                  <Button
                    size="small"
                    icon={<LinkOutlined />}
                    onClick={() => setLinkMsg(m)}
                  >
                    关联任务
                  </Button>
                </Space>
              )}
            </div>
          ))}
        </Space>
      </Drawer>

      <Modal
        title="关联到学习任务"
        open={linkMsg !== null}
        onCancel={() => {
          setLinkMsg(null);
          setLinkTaskId(undefined);
        }}
        onOk={() => linkMsg && void sinkNote(linkMsg, linkTaskId || null)}
        okText="确认关联"
        cancelText="取消"
      >
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            将把该条 Agent 回答沉淀为笔记并挂到所选任务下；不选任务则为独立笔记。
          </Typography.Text>
          <Select
            placeholder="选择学习任务（可选）"
            allowClear
            style={{ width: "100%" }}
            value={linkTaskId}
            onChange={(v) => setLinkTaskId(v)}
            options={tasks.map((t) => ({ value: t.id, label: t.title }))}
          />
        </Space>
      </Modal>
    </Card>
  );
}
