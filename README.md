# Agent Admin

Agent 学习管理端，使用 React、TypeScript、Vite 与 Ant Design，提供学习任务、笔记、实验、会话记录和统计看板。

## 本地运行

准备 Node.js 与 npm，执行：

```bash
npm ci
npm run dev
```

`npm run dev` 同时启动 mock API 与 Vite 开发服务器。管理端默认地址为 `http://localhost:5176`，API 默认端口为 `8002`。演示账号为 `admin`，密码为 `admin123`，仅供本地演示。

mock 服务首次运行会生成 `mock/db.json`。该文件保存本地学习数据，已从版本控制排除。开发端通过 Vite 代理访问 `/api`；本仓库的 mock 服务不作为生产后端。

## 验证与构建

```bash
npm test
npm run build
npm run lint
```

构建产物位于 `dist/`，不提交到仓库。字体文件及其授权说明位于 `public/fonts/`，用于中文 PDF 导出。

## 项目结构

- `src/`：页面、组件、接口调用与状态相关逻辑。
- `mock/`：本地 API 和示例数据生成逻辑。
- `tests/`：Node.js 测试。
- `scripts/`：开发启动脚本。
- `TODOLIST.md`：功能与迭代记录。
