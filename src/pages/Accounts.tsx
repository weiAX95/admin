import { useSettings } from "../components/SettingsProvider";
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
  Progress,
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
  purgeAccount,
  restoreAccount,
  updateAccount,
} from "../api/accounts";
import { getStoredUser } from "../api/client";
import type { Account, AccountPayload, AuthUser } from "../types";
import AccountInvitations from "../components/AccountInvitations";

const ROLE_OPTIONS = [
  { value: "admin", label: "管理员" },
  { value: "member", label: "普通成员" },
];
const STATUS_OPTIONS = [
  { value: "active", label: "启用" },
  { value: "disabled", label: "禁用" },
  { value: "pending", label: "待激活", disabled: true },
];
const ACTIVATION_OPTIONS = [
  { value: "immediate", label: "立即激活" },
  { value: "first_login", label: "首次登录后激活" },
  { value: "manual", label: "管理员手动激活" },
];
const meetsPasswordPolicy = (value: string) => value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value);
const passwordRule = { validator: async (_: unknown, value: string) => {
  if (value && !meetsPasswordPolicy(value)) throw new Error("至少 8 位，包含大小写字母和数字");
} };

interface DrawerProps {
  open: boolean;
  initial: Account | null;
  onClose: () => void;
  onSaved: () => void;
}

function AccountFormDrawer({ open, initial, onClose, onSaved }: DrawerProps) {
  const [form] = Form.useForm<AccountPayload>();
  const password = Form.useWatch("password", form) || "";
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  const validPassword = meetsPasswordPolicy(password);
  const strength = !password ? 0 : Math.min(100, 20 + Number(password.length >= 8) * 20 + Number(/[A-Z]/.test(password) && /[a-z]/.test(password)) * 20 + Number(/[0-9]/.test(password)) * 20 + Number(password.length >= 12 || /[^A-Za-z0-9]/.test(password)) * 20);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (initial) {
      form.setFieldsValue({
        username: initial.username,
        name: initial.name,
        role: initial.role,
        status: initial.status,
        activationMode: initial.activationMode || "immediate",
        maxDevices: initial.maxDevices || 3,
        ipAllowlist: initial.ipAllowlist || [],
        password: "",
      });
    } else {
      form.setFieldsValue({
        username: "",
        name: "",
        role: "member",
        status: "active",
        activationMode: "immediate",
        maxDevices: 3,
        ipAllowlist: [],
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
            initial ? [passwordRule] : [{ required: true, message: "请输入密码" }, passwordRule]
          }
        >
          <Input.Password
            maxLength={40}
            placeholder={initial ? "留空则不修改密码" : "登录密码"}
          />
        </Form.Item>
        {password && <div aria-live="polite" style={{ marginTop: -18, marginBottom: 20 }}>
          <Progress percent={strength} showInfo={false} status={validPassword ? "success" : "normal"} size="small" />
          <Typography.Text type={validPassword ? "success" : "secondary"}>{!validPassword ? "弱" : strength >= 100 ? "强" : "中"} · 至少 8 位，包含大小写字母和数字</Typography.Text>
        </div>}
        <Form.Item name="role" label="角色">
          <Select options={ROLE_OPTIONS} />
        </Form.Item>
        {!initial && <Form.Item name="activationMode" label="激活方式" extra="首次登录或手动激活时，账号会先处于待激活状态。">
          <Select options={ACTIVATION_OPTIONS} />
        </Form.Item>}
        <Form.Item name="status" label="状态">
          <Select options={STATUS_OPTIONS} />
        </Form.Item>
        <Form.Item name="maxDevices" label="最多同时登录设备" rules={[{ required: true, message: '请选择 1–10 台设备' }]}>
          <InputNumber min={1} max={10} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="ipAllowlist" label="登录 IP 白名单" extra="留空允许所有地址；输入完整 IPv4 或 IPv6 后按回车。配置前请确认自己当前的连接 IP。">
          <Select mode="tags" tokenSeparators={[',']} placeholder="例如 203.0.113.10" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

export default function Accounts() {
  const { pageSize } = useSettings();
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const current = getStoredUser<AuthUser>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAccounts(showDeleted);
      setItems(res.items);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载账号失败");
    } finally {
      setLoading(false);
    }
  }, [message, showDeleted]);

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
      message.success("已移入回收站，可恢复");
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };
  const restore = async (acc: Account) => {
    try {
      await restoreAccount(acc.id);
      message.success('账号已恢复');
      void load();
    } catch (err) { message.error(err instanceof Error ? err.message : '恢复失败'); }
  };
  const purge = (acc: Account) => {
    modal.confirm({ title: `永久删除账号「${acc.username}」？`, okText: '永久删除', okType: 'danger',
      content: '此操作不可恢复；该账号的个人项目仓库、分析、复习记录及登录记录将按数据库外键删除，其他历史中的账号归属可能被清空。',
      onOk: async () => { try { await purgeAccount(acc.id, acc.username); message.success('账号已永久删除'); await load(); }
        catch (error) { message.error(error instanceof Error ? error.message : '永久删除失败'); return Promise.reject(error); } },
    });
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
      render: (v: Account["status"], account) =>
        account.deletedAt ? <Tag color="default">回收站</Tag> : v === "pending" ? <Tag color="processing">待激活</Tag> : v === "active" ? (
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
        if (a.deletedAt) return <Space size={4}><Button type="link" size="small" onClick={() => void restore(a)}>恢复</Button><Button type="link" size="small" danger onClick={() => purge(a)}>永久删除</Button></Space>;
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
              {a.status === "pending" ? "激活" : a.status === "active" ? "禁用" : "启用"}
            </Button>
            <Popconfirm
              title="将该账号移入回收站？"
              okText="移入回收站"
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
        <Button type={showDeleted ? 'primary' : 'default'} onClick={() => setShowDeleted(value => !value)}>{showDeleted ? '返回账号列表' : '查看回收站'}</Button>
        <AccountInvitations />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          仅管理员可管理账号；不能禁用或删除当前登录账号。回收站账号满 30 天自动永久清理。
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
