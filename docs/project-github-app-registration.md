# GitHub App 接入准备

本页记录 14.7 和 14.11 真实联调需要的外部配置。代码已提供授权、私有仓库读取和 Webhook 接收；**App 安装、管理端账号授权及所选公开仓库的读取已验收。私有仓库失权和真实 Webhook 交付尚未验收，14.7／14.11 仍保持未完成**。

## 注册 GitHub App

2026-10-29 已在 `weiAX95` 账号注册 `Agent Admin Project Analysis`（App ID `5521573`，Client ID `Iv23li95mK2Vlb5gAY9W`）。安装范围限该账号，Contents 与 GitHub 必需的 Metadata 均为只读；用户回调为 `http://localhost:5176/api/project-github/callback`，令牌过期功能开启。安装 ID 为 `176429406`。2026-10-30 已保存并重新读取安装设置，确认使用“Only select repositories”，唯一选中 `weiAX95/admin`，权限为代码与元数据只读。Client Secret、公开 Client ID、回调和本地加密主密钥已配置在本机被 Git 忽略的 `.env.local`；本项目当前只使用 GitHub App 用户令牌，不使用 App 私钥。当前没有公网 HTTPS 接收地址，Webhook 保持关闭。任何密钥都不应写入本文档。

2026-10-30 本地管理端账号已完成 GitHub App 用户 OAuth，数据库中该账号的连接含有效访问与刷新期限，连接页面显示 `weiAX95`。通过页面调用已授权仓库接口时，列表只返回 `weiAX95/admin`（公开仓库）。这验证了当前本地授权和仓库清单的实际读取路径；私有仓库、授权撤销及真实 Webhook 交付尚未联调。

在 GitHub 的 Developer settings 创建 GitHub App。仓库权限只申请 **Contents: Read**；GitHub 会同时赋予必需的 **Metadata: Read**。不要申请仓库写权限。启用会过期的用户访问令牌，并在安装时选择需要接入的仓库。用户授权回调设置为本系统同源的 `/api/project-github/callback`；本地可使用 `http://localhost:5176/api/project-github/callback`，正式环境使用 HTTPS 域名。当前尚无公网 HTTPS 接收地址时，先关闭 **Webhook Active**；部署好接收地址后再填入正式环境的 `https://<域名>/api/project-github/webhook`、配置独立 Webhook secret、订阅 **Push** 事件并开启 Webhook，不能使用仅本机可访问的 localhost 地址。

将 `GITHUB_APP_CLIENT_ID`、`GITHUB_APP_CLIENT_SECRET`、`GITHUB_APP_CALLBACK_URL`、`GITHUB_APP_MASTER_KEY` 配置在 API 服务环境中；启用 Webhook 时再配置 `GITHUB_APP_WEBHOOK_SECRET`。主密钥须是独立生成的 64 位十六进制值；Webhook secret 与主密钥分开。不要将密钥放入仓库、聊天消息或前端构建变量。服务重启后，项目分析页会显示缺失的授权配置项；提交后扫描的开关会单独检查 Webhook secret。

## 正式联调记录

在完整服务部署前，可按[受限 HTTPS 入口与反向隧道联调方案](project-github-webhook-live-check.md)让 GitHub 的真实交付到达本机接收端；该方案须有专用域名、有效证书和独立 Webhook secret，当前尚未启用。

完成配置后，按以下顺序记录实际结果：连接与断开账号；安装时选择一个私有仓库并确认另一未选仓库不可读；私有扫描及模型发送预览；撤销安装授权后再次读取被拒绝；有效 push 触发指定分支扫描；错误签名、重复交付、未开启分支和乱序交付均不产生重复或回退扫描；模型分析的费用和报告证据仍需另行核对。记录 GitHub App ID、仓库 ID、分支、交付 ID、扫描／报告 ID 和时间，**不记录令牌或密钥**。

当前服务器若尚无公网 HTTPS 入口，只能先做本地 OAuth 与公开仓库流程；Webhook 的真实交付验收须等公网入口可达。执行测试与页面验收前，`TODOLIST.md` 14.7／14.11 保持未完成。

协议依据：[GitHub App 用户访问令牌](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[Webhook 签名验证](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)。
