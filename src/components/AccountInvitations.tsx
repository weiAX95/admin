import { useEffect, useState } from 'react';
import { App, Button, Form, Input, List, Modal, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { createAccountInvitation, listAccountInvitations, revokeAccountInvitation, type AccountInvitation } from '../api/accounts';

type InviteForm = { username: string; name?: string; role: 'admin' | 'member'; activationMode: AccountInvitation['activationMode']; expiresInHours: number };

function invitationState(item: AccountInvitation) {
  if (item.consumedAt) return <Tag color="success">已使用</Tag>;
  if (item.revokedAt) return <Tag>已撤销</Tag>;
  if (new Date(item.expiresAt).getTime() <= Date.now()) return <Tag>已过期</Tag>;
  return <Tag color="processing">待注册</Tag>;
}

export default function AccountInvitations() {
  const { message } = App.useApp();
  const [form] = Form.useForm<InviteForm>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<AccountInvitation[]>([]);
  const [createdLink, setCreatedLink] = useState('');
  const load = async () => {
    try { setItems((await listAccountInvitations()).items); }
    catch (error) { message.error(error instanceof Error ? error.message : '邀请列表加载失败'); }
  };
  useEffect(() => { if (open) void load(); }, [open]);
  const close = () => { setOpen(false); setCreatedLink(''); };
  const create = async (values: InviteForm) => {
    setSaving(true);
    try {
      const result = await createAccountInvitation(values);
      setCreatedLink(`${window.location.origin}/register?token=${encodeURIComponent(result.token)}`);
      form.resetFields();
      await load();
      message.success('邀请已创建，链接仅在此处显示一次');
    } catch (error) { message.error(error instanceof Error ? error.message : '邀请创建失败'); }
    finally { setSaving(false); }
  };
  return <>
    <Button onClick={() => setOpen(true)}>邀请注册</Button>
    <Modal title="邀请注册" open={open} onCancel={close} footer={null} width={680} destroyOnClose>
      <Typography.Paragraph type="secondary">设置账号和激活方式后，将一次性链接交给受邀人。新建同名邀请会撤销旧链接。</Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ role: 'member', activationMode: 'first_login', expiresInHours: 24 }} onFinish={create}>
        <Space align="start" wrap>
          <Form.Item name="username" label="用户名" rules={[{ required: true, max: 30, message: '请输入 1–30 字符用户名' }]}><Input maxLength={30} /></Form.Item>
          <Form.Item name="name" label="显示名称"><Input maxLength={30} /></Form.Item>
          <Form.Item name="role" label="角色"><Select style={{ width: 110 }} options={[{ value: 'member', label: '普通成员' }, { value: 'admin', label: '管理员' }]} /></Form.Item>
          <Form.Item name="activationMode" label="激活方式"><Select style={{ width: 160 }} options={[{ value: 'immediate', label: '注册后立即激活' }, { value: 'first_login', label: '首次登录后激活' }, { value: 'manual', label: '管理员手动激活' }]} /></Form.Item>
          <Form.Item name="expiresInHours" label="有效期"><Select style={{ width: 110 }} options={[{ value: 1, label: '1 小时' }, { value: 24, label: '24 小时' }, { value: 168, label: '7 天' }]} /></Form.Item>
        </Space>
        <div><Button type="primary" htmlType="submit" loading={saving}>生成邀请链接</Button></div>
      </Form>
      {createdLink && <div style={{ marginTop: 20 }}>
        <Typography.Text strong>一次性邀请链接</Typography.Text>
        <Input.TextArea value={createdLink} readOnly autoSize={{ minRows: 2, maxRows: 3 }} aria-label="一次性邀请链接" />
        <Button style={{ marginTop: 8 }} onClick={() => { void navigator.clipboard.writeText(createdLink).then(() => message.success('链接已复制')).catch(() => message.error('复制失败，请手动复制')); }}>复制链接</Button>
      </div>}
      <Typography.Title level={5} style={{ marginTop: 24 }}>最近邀请</Typography.Title>
      <List size="small" dataSource={items} locale={{ emptyText: '暂无邀请' }} renderItem={item => <List.Item actions={!item.consumedAt && !item.revokedAt && new Date(item.expiresAt).getTime() > Date.now() ? [<Popconfirm key="revoke" title="撤销该邀请？" onConfirm={() => { void revokeAccountInvitation(item.id).then(() => { message.success('邀请已撤销'); void load(); }).catch(error => message.error(error instanceof Error ? error.message : '撤销失败')); }}><Button type="link" danger size="small">撤销</Button></Popconfirm>] : []}>
        <Space wrap><Typography.Text strong>{item.username}</Typography.Text>{invitationState(item)}<Typography.Text type="secondary">{item.role === 'admin' ? '管理员' : '普通成员'} · {new Date(item.expiresAt).toLocaleString('zh-CN', { hour12: false })} 到期</Typography.Text></Space>
      </List.Item>} />
    </Modal>
  </>;
}
