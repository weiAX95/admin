import { useCallback, useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { createNote, deleteNote, listNotes, updateNote } from "../api/notes";
import { listTasks } from "../api/tasks";
import type { LearningTask, Note, NotePayload } from "../types";

interface Props {
  open: boolean;
  initial: Note | null;
  tasks: LearningTask[];
  defaultTaskId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function NoteFormDrawer({ open, initial, tasks, defaultTaskId, onClose, onSaved }: Props) {
  const [form] = Form.useForm<NotePayload>();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (initial) form.setFieldsValue(initial);
    else form.setFieldsValue({ title: "", content: "", taskId: defaultTaskId || null });
  }, [open, initial, defaultTaskId, form]);

  const handleFinish = async (values: NotePayload) => {
    setSaving(true);
    try {
      if (initial) {
        await updateNote(initial.id, values);
        message.success("已更新笔记");
      } else {
        await createNote(values);
        message.success("已创建笔记");
      }
      onSaved();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={initial ? "编辑笔记" : "新建笔记"}
      width={480}
      open={open}
      onClose={onClose}
      extra={
        <Button type="primary" loading={saving} onClick={() => form.submit()}>
          保存
        </Button>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, message: "请输入标题" }]}
        >
          <Input maxLength={60} placeholder="笔记标题" />
        </Form.Item>
        <Form.Item name="taskId" label="关联学习任务">
          <Select
            allowClear
            placeholder="不关联则为独立笔记"
            options={tasks.map((t) => ({ value: t.id, label: t.title }))}
          />
        </Form.Item>
        <Form.Item name="content" label="内容">
          <Input.TextArea rows={8} placeholder="学习笔记内容" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

export default function Notes() {
  const { message } = App.useApp();
  const [items, setItems] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<LearningTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listNotes();
      setItems(res.items);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载笔记失败");
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

  const taskTitle = (id: string | null) =>
    id ? tasks.find((t) => t.id === id)?.title || "已删除任务" : null;

  const remove = async (note: Note) => {
    try {
      await deleteNote(note.id);
      message.success("已删除");
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const columns: ColumnsType<Note> = [
    {
      title: "标题",
      dataIndex: "title",
      key: "title",
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    },
    {
      title: "关联任务",
      dataIndex: "taskId",
      key: "taskId",
      width: 220,
      render: (id: string | null) =>
        taskTitle(id) ? <Tag color="geekblue">{taskTitle(id)}</Tag> : <Tag>独立</Tag>,
    },
    {
      title: "来源",
      key: "source",
      width: 110,
      render: (_, n) =>
        n.sourceSessionId ? <Tag color="purple">会话沉淀</Tag> : <Tag>手动</Tag>,
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
      width: 130,
      render: (_, n) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditing(n);
              setDrawerOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm title="删除该笔记？" okText="删除" cancelText="取消" onConfirm={() => void remove(n)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card className="collection-card" title={<span className="collection-title">笔记列表<span className="collection-count">{items.length} 条</span></span>}>
      <Space className="collection-toolbar" wrap size={[10, 12]}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            setDrawerOpen(true);
          }}
        >
          新建笔记
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        scroll={{ x: 760 }}
        pagination={{ pageSize: 8, showSizeChanger: false }}
      />
      <NoteFormDrawer
        open={drawerOpen}
        initial={editing}
        tasks={tasks}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => {
          setDrawerOpen(false);
          void load();
        }}
      />
    </Card>
  );
}
