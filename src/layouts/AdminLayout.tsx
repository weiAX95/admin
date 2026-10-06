import { useState } from "react";
import { Avatar, Button, Drawer, Layout, Menu, Space, Typography } from "antd";
import {
  DashboardOutlined, ExperimentOutlined, FileTextOutlined, LogoutOutlined,
  MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined, MessageOutlined,
  ProfileOutlined, RocketOutlined, TeamOutlined,
} from "@ant-design/icons";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearAuth, getStoredUser } from "../api/client";
import type { AuthUser } from "../types";

const { Header, Sider, Content } = Layout;
const MENU_ITEMS = [
  { key: "/", icon: <DashboardOutlined />, label: "学习仪表盘" },
  { key: "/tasks", icon: <ProfileOutlined />, label: "学习任务" },
  { key: "/sessions", icon: <MessageOutlined />, label: "会话记录" },
  { key: "/notes", icon: <FileTextOutlined />, label: "学习笔记" },
  { key: "/experiments", icon: <ExperimentOutlined />, label: "实验记录" },
];
const ACCOUNTS_ITEM = { key: "/accounts", icon: <TeamOutlined />, label: "账号管理" };
const PAGE_META: Record<string, { title: string; description: string; section: string }> = {
  "/": { title: "学习仪表盘", description: "看见每一步积累，掌握你的学习节奏。", section: "学习概览" },
  "/tasks": { title: "学习任务", description: "从目标到行动，让每一项学习计划有迹可循。", section: "学习工作台" },
  "/sessions": { title: "会话记录", description: "回顾与 Agent 的对话，将有价值的回答沉淀为知识。", section: "学习工作台" },
  "/notes": { title: "学习笔记", description: "整理思考、记录心得，建立自己的知识积累。", section: "学习工作台" },
  "/experiments": { title: "实验记录", description: "记录提示词、模型与结果，让每一次尝试都成为经验。", section: "学习工作台" },
  "/accounts": { title: "账号管理", description: "维护成员账号、角色与访问状态。", section: "系统管理" },
};

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = getStoredUser<AuthUser>();
  const menuItems = user?.role === "admin" ? [...MENU_ITEMS, ACCOUNTS_ITEM] : MENU_ITEMS;
  const selected = menuItems.map((m) => m.key)
    .filter((k) => k === "/" ? location.pathname === "/" : location.pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0] || "/";
  const page = PAGE_META[selected];
  const name = user?.name || user?.username || "未登录";
  const brand = (
    <div className="sidebar-brand">
      <span className="brand-mark"><RocketOutlined /></span>
      <div className="brand-copy"><strong>Agent 学习管理端</strong><span>LEARNING WORKSPACE</span></div>
    </div>
  );
  const menu = (
    <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={menuItems}
      onClick={({ key }) => { navigate(key); setMobileOpen(false); }} />
  );
  return (
    <Layout className="admin-shell">
      <Sider className="admin-sidebar" theme="dark" width={240} collapsedWidth={80}
        collapsed={collapsed} breakpoint="lg" onBreakpoint={setCollapsed}>
        {brand}
        <div className="sidebar-label">工作空间</div>
        {menu}
        <div className="sidebar-bottom">
          {!collapsed && <div className="sidebar-note"><span className="status-dot" />专注学习，持续进步</div>}
          <Button type="text" block icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"} onClick={() => setCollapsed(!collapsed)}>
            {!collapsed && "收起侧边栏"}
          </Button>
        </div>
      </Sider>
      <Drawer className="mobile-navigation" title={brand} placement="left" width={280}
        open={mobileOpen} onClose={() => setMobileOpen(false)}>{menu}</Drawer>
      <Layout className="admin-main">
        <Header className="admin-header">
          <Space size={12}>
            <Button className="mobile-menu-button" type="text" icon={<MenuOutlined />}
              aria-label="打开导航菜单" onClick={() => setMobileOpen(true)} />
            <span className="header-breadcrumb">工作空间 <span>/</span> <strong>{page.section}</strong></span>
          </Space>
          <Space size={14} className="header-account">
            <Avatar size={32} className="account-avatar">{name.slice(0, 1)}</Avatar>
            <div className="account-copy"><strong>{name}</strong><span>{user?.role === "admin" ? "管理员" : "普通成员"}</span></div>
            <Button type="text" icon={<LogoutOutlined />} onClick={() => { clearAuth(); navigate("/login", { replace: true }); }}>
              <span className="logout-label">退出</span>
            </Button>
          </Space>
        </Header>
        <Content className="admin-content">
          <div className="content-inner">
            <div className="page-heading">
              <div><span className="page-eyebrow">AGENT / {page.section}</span>
                <Typography.Title level={2}>{page.title}</Typography.Title>
                <Typography.Paragraph>{page.description}</Typography.Paragraph>
              </div>
              <div className="workspace-badge"><span className="status-dot" />学习工作空间</div>
            </div>
            <Outlet />
            <footer className="workspace-footer">Agent 学习管理端 <span>让学习与实践形成闭环</span></footer>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
