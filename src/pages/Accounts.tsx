import { useSettings } from "../components/SettingsProvider";
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
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
} from "../api/accounts";
import { getStoredUser } from "../api/client";
import type { Account, AccountPayload, AuthUser } from "../types";

const ROLE_OPTIONS = [
  { value: "admin", label: "管理员" },
  { value: "member", label: "普通成员" },
];
const STATUS_OPTIONS = [
  { value: "active", label: "启用" },
  { value: "disabled", label: "禁用" },
];

interface DrawerProps {
  open: boolean;
  initial: Account | null;
  onClose: () => void;
  onSaved: () => void;
}

function AccountFormDrawer({ open, initial, onClose, onSaved }: DrawerProps) {
  const [form] = Form.useForm<AccountPayload>();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (initial) {
      form.setFieldsValue({
        username: initial.username,
        name: initial.name,
        role: initial.role,
        status: initial.status,
        password: "",
      });
    } else {
      form.setFieldsValue({
        username: "",
        name: "",
        role: "member",
        status: "active",
        password: "",
      });
    }
  }, [open, initial, form]);

  const handleFinish = async (values: AccountPayload) => {
    setSaving(true);
    try {
      if (initial) {
        // 编辑：密码留空则不提交（不修改）
        const payload: AccountPayload = { ...values };
        if (!payload.password) delete payload.password;
        await updateAccount(initial.id, payload);
        message.success("已更新账号");
      } else {
        await createAccount(values);
        message.success("已创建账号");
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
      title={initial ? "编辑账号" : "新建账号"}
      width={460}
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
          name="username"
          label="用户名"
          rules={[{ required: true, message: "请输入用户名" }]}
        >
          <Input maxLength={30} placeholder="登录用户名" disabled={!!initial} />
        </Form.Item>
        <Form.Item name="name" label="姓名 / 昵称">
          <Input maxLength={30} placeholder="展示名称" />
        </Form.Item>
        <Form.Item
          name="password"
          label={initial ? "重置密码" : "密码"}
          rules={
            initial
              ? []
              : [{ required: true, message: "请输入密码" }]
          }
        >
          <Input.Password
            maxLength={40}
            placeholder={initial ? "留空则不修改密码" : "登录密码"}
          />
        </Form.Item>
        <Form.Item name="role" label="角色">
          <Select options={ROLE_OPTIONS} />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select options={STATUS_OPTIONS} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

export default function Accounts() {
  const { pageSize } = useSettings();
  const { message } = App.useApp();
  const [items, setItems] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const current = getStoredUser<AuthUser>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAccounts();
      setItems(res.items);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载账号失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleStatus = async (acc: Account) => {
    const next = acc.status === "active" ? "disabled" : "active";
    try {
      await updateAccount(acc.id, { status: next });
      message.success(next === "active" ? "已启用" : "已禁用");
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  const remove = async (acc: Account) => {
    try {
      await deleteAccount(acc.id);
      message.success("已删除");
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const columns: ColumnsType<Account> = [
    {
      title: "用户名",
      dataIndex: "username",
      key: "username",
      render: (v: string, a) => (
        <Space size={6}>
          <Typography.Text strong>{v}</Typography.Text>
          {current?.username === a.username && <Tag color="blue">当前</Tag>}
        </Space>
      ),
    },
    { title: "姓名", dataIndex: "name", key: "name", width: 160 },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      width: 110,
      render: (v: Account["role"]) =>
        v === "admin" ? <Tag color="gold">管理员</Tag> : <Tag>普通成员</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (v: Account["status"]) =>
        v === "active" ? (
          <Tag color="success">启用</Tag>
        ) : (
          <Tag color="default">禁用</Tag>
        ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (v: string) =>
        new Date(v).toLocaleString("zh-CN", { hour12: false }),
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_, a) => {
        const isSelf = current?.username === a.username;
        return (
          <Space size={4}>
            <Button
              type="link"
              size="small"
              onClick={() => {
                setEditing(a);
                setDrawerOpen(true);
              }}
            >
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              disabled={isSelf}
              onClick={() => void toggleStatus(a)}
            >
              {a.status === "active" ? "禁用" : "启用"}
            </Button>
            <Popconfirm
              title="删除该账号？"
              okText="删除"
              cancelText="取消"
              disabled={isSelf}
              onConfirm={() => void remove(a)}
            >
              <Button type="link" size="small" danger disabled={isSelf}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <Card className="collection-card" title={<span className="collection-title">账号列表<span className="collection-count">{items.length} 条</span></span>}>
      <Space className="collection-toolbar" wrap size={[10, 12]}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            setDrawerOpen(true);
          }}
        >
          新建账号
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          仅管理员可管理账号；不能禁用或删除当前登录账号。
        </Typography.Text>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        scroll={{ x: 900 }}
        pagination={{ pageSize, showSizeChanger: false }}
      />
      <AccountFormDrawer
        open={drawerOpen}
        initial={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => {
          setDrawerOpen(false);
          void load();
        }}
      />
    </Card>
  );
}
