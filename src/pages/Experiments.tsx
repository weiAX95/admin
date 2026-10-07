import { useCallback, useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import {
  createExperiment,
  deleteExperiment,
  listExperiments,
  updateExperiment,
} from "../api/experiments";
import { listTasks } from "../api/tasks";
import type { Experiment, ExperimentPayload, LearningTask } from "../types";
import MarkdownEditor from "../components/MarkdownEditor";
import { markdownSummary } from "../utils/markdown-summary";

function scoreColor(score: number): string {
  if (score >= 4) return "success";
  if (score >= 3) return "warning";
  return "error";
}

interface DrawerProps {
  open: boolean;
  initial: Experiment | null;
  tasks: LearningTask[];
  defaultTaskId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function ExperimentFormDrawer({ open, initial, tasks, defaultTaskId, onClose, onSaved }: DrawerProps) {
  const [form] = Form.useForm<ExperimentPayload>();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (initial) form.setFieldsValue(initial);
    else form.setFieldsValue({ title: "", taskId: defaultTaskId || null, score: 3, model: "", prompt: "", params: "", result: "" });
  }, [open, initial, defaultTaskId, form]);

  const handleFinish = async (values: ExperimentPayload) => {
    setSaving(true);
    try {
      if (initial) {
        await updateExperiment(initial.id, values);
        message.success("已更新实验记录");
      } else {
        await createExperiment(values);
        message.success("已创建实验记录");
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
      title={initial ? "编辑实验记录" : "新建实验记录"}
      width="min(1050px, 100vw)"
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
          label="实验标题"
          rules={[{ required: true, message: "请输入实验标题" }]}
        >
          <Input maxLength={60} placeholder="例如：ReAct vs 直接回答" />
        </Form.Item>
        <Form.Item name="taskId" label="关联学习任务">
          <Select
            allowClear
            placeholder="可选"
            options={tasks.map((t) => ({ value: t.id, label: t.title }))}
          />
        </Form.Item>
        <Form.Item name="model" label="模型">
          <Input placeholder="例如：gpt-4o-mini" />
        </Form.Item>
        <Form.Item name="prompt" label="Prompt">
          <MarkdownEditor rows={10} placeholder="本次实验使用的提示词" />
        </Form.Item>
        <Form.Item name="params" label="参数">
          <Input placeholder="例如：temperature=0.2, maxSteps=5" />
        </Form.Item>
        <Form.Item name="result" label="结果观察">
          <MarkdownEditor rows={10} placeholder="实验结果与观察" />
        </Form.Item>
        <Form.Item name="score" label="自评打分（0-5）">
          <InputNumber min={0} max={5} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

export default function Experiments() {
  const { message } = App.useApp();
  const [items, setItems] = useState<Experiment[]>([]);
  const [tasks, setTasks] = useState<LearningTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskFilter, setTaskFilter] = useState<string | undefined>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Experiment | null>(null);

  const load = useCallback(
    async (taskId?: string) => {
      setLoading(true);
      try {
        const res = await listExperiments(taskId);
        setItems(res.items);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "加载实验失败");
      } finally {
        setLoading(false);
      }
    },
    [message]
  );

  useEffect(() => {
    void load(taskFilter);
  }, [load, taskFilter]);

  useEffect(() => {
    listTasks({})
      .then((res) => setTasks(res.items))
      .catch(() => setTasks([]));
  }, []);

  const taskTitle = (id: string | null) =>
    id ? tasks.find((t) => t.id === id)?.title || "已删除任务" : null;

  const remove = async (exp: Experiment) => {
    try {
      await deleteExperiment(exp.id);
      message.success("已删除");
      void load(taskFilter);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const columns: ColumnsType<Experiment> = [
    {
      title: "实验",
      dataIndex: "title",
      key: "title",
      render: (v: string, e) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{v}</Typography.Text>
          {e.result && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {markdownSummary(e.result)}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: "关联任务",
      dataIndex: "taskId",
      key: "taskId",
      width: 200,
      render: (id: string | null) =>
        taskTitle(id) ? <Tag color="geekblue">{taskTitle(id)}</Tag> : <Tag>-</Tag>,
    },
    { title: "模型", dataIndex: "model", key: "model", width: 140 },
    {
      title: "自评",
      dataIndex: "score",
      key: "score",
      width: 80,
      render: (v: number) => <Tag color={scoreColor(v)}>{v} / 5</Tag>,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 170,
      render: (v: string) => new Date(v).toLocaleString("zh-CN", { hour12: false }),
    },
    {
      title: "操作",
      key: "actions",
      width: 130,
      render: (_, e) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditing(e);
              setDrawerOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm title="删除该实验记录？" okText="删除" cancelText="取消" onConfirm={() => void remove(e)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card className="collection-card" title={<span className="collection-title">实验列表<span className="collection-count">{items.length} 条</span></span>}>
      <Space className="collection-toolbar" wrap size={[10, 12]}>
        <Select
          placeholder="按任务筛选"
          allowClear
          style={{ width: 240 }}
          value={taskFilter}
          onChange={(v) => setTaskFilter(v)}
          options={tasks.map((t) => ({ value: t.id, label: t.title }))}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            setDrawerOpen(true);
          }}
        >
          新建实验
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        scroll={{ x: 900 }}
        pagination={{ pageSize: 8, showSizeChanger: false }}
      />
      <ExperimentFormDrawer
        open={drawerOpen}
        initial={editing}
        tasks={tasks}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => {
          setDrawerOpen(false);
          void load(taskFilter);
        }}
      />
    </Card>
  );
}
