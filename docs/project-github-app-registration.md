# GitHub App 接入准备

本页记录 14.7 和 14.11 真实联调需要的外部配置。代码已提供授权、私有仓库读取和 Webhook 接收；**App 安装、管理端账号授权及指定私有仓库的直接读取已核对。私有仓库失权和真实 Webhook 交付尚未验收，14.7／14.11 仍保持未完成**。

## 注册 GitHub App

2026-10-29 已在 `weiAX95` 账号注册 `Agent Admin Project Analysis`（App ID `5521573`，Client ID `Iv23li95mK2Vlb5gAY9W`）。安装范围限该账号，Contents 与 GitHub 必需的 Metadata 均为只读；用户回调为 `http://localhost:5176/api/project-github/callback`，令牌过期功能开启。安装 ID 为 `176429406`。2026-11-13 已保存并重新读取安装设置，确认使用“Only select repositories”，仅选中 `weiAX95/admin` 和 `weiAX95/admin-private-integration-fixture`，权限为代码与元数据只读。Client Secret、公开 Client ID、回调和本地加密主密钥已配置在本机被 Git 忽略的 `.env.local`；本项目当前只使用 GitHub App 用户令牌，不使用 App 私钥。当前没有公网 HTTPS 接收地址，Webhook 保持关闭。任何密钥都不应写入本文档。

2026-10-30 本地管理端账号已完成 GitHub App 用户 OAuth，数据库中该账号的连接含有效访问与刷新期限，连接页面显示 `weiAX95`。当时通过页面调用已授权仓库接口，列表只返回 `weiAX95/admin`（公开仓库）。2026-11-13 扩展安装范围后，本地服务通过保存的 App 用户授权直接读取了私有联调仓库，确认 GitHub 返回 `private: true`、仓库 ID `1455339730`、默认分支 `main`。2026-11-14 重新调用管理端已授权仓库清单逻辑，返回公开 `weiAX95/admin` 和私有联调仓库两项。该仓库已接入本地项目列表（项目 ID `73ce6f92-c1eb-417d-82ed-3b09919a7dfa`），并基于 commit `66e3aa702e1c96869b5ee1c2001a354386ced822` 完成首次全量扫描（扫描 ID `5c51f39f-79fd-4b3d-a390-4232000451b5`）：4 个文件读取成功、覆盖完整、无读取错误。扫描到的 `requirements.md` 已保存为需求基线 v1（ID `89b16384-4bed-44c4-bb22-013dbd1aaf47`）。当前本地模型目录为空，尚未执行模型分析、撤销授权与失权拒绝流程，也未验收真实 Webhook 交付。

已连接账号可在“项目分析”页点击“在 GitHub 管理可读取的仓库”，进入 GitHub 的已安装 App 设置；在本 App 下选择仓库并保存后，返回页面点击“查看已授权仓库”重新读取清单。该入口不授予权限，实际授权仍由 GitHub 账号在其设置页完成。[GitHub 官方说明](https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps)列出个人账号修改安装仓库范围的步骤。

2026-11-12 已创建私有联调仓库 [`weiAX95/admin-private-integration-fixture`](https://github.com/weiAX95/admin-private-integration-fixture)，并加入 `requirements.md`、`backend/app.py`、`frontend/Tasks.tsx` 三个合成样例文件；固定基线 commit 为 `66e3aa702e1c96869b5ee1c2001a354386ced822`，不含 admin 项目代码或密钥。`REQ-CREATE` 在 API 和页面均有源码线索，`REQ-FILTER` 在 API 和页面均有源码线索，`REQ-DELETE` 在该完整小样例中没有实现。这里的预期仅供最终逐条评审，尚未运行扫描或模型分析，不能视为实际报告验收。2026-11-13 GitHub 身份验证后，已将该仓库加入 App 的选定仓库范围，未改成“所有仓库”；直接私有读取成功。撤销授权与后续拒绝行为尚未验收，不能将 14.7 标记完成。

该小仓库已经有提交，但 GitHub 仓库元数据仍返回 `size: 0`；接入逻辑已改为先读取目标分支，只有分支缺失时才额外查询提交接口以辨别空仓库。`size` 不再充当是否存在提交的依据。私有 App 用户令牌的仓库元数据读取与固定 commit 扫描已核对；模型报告仍待统一验收。

在 GitHub 的 Developer settings 创建 GitHub App。仓库权限只申请 **Contents: Read**；GitHub 会同时赋予必需的 **Metadata: Read**。不要申请仓库写权限。启用会过期的用户访问令牌，并在安装时选择需要接入的仓库。用户授权回调设置为本系统同源的 `/api/project-github/callback`；本地可使用 `http://localhost:5176/api/project-github/callback`，正式环境使用 HTTPS 域名。当前尚无公网 HTTPS 接收地址时，先关闭 **Webhook Active**；部署好接收地址后再填入正式环境的 `https://<域名>/api/project-github/webhook`、配置独立 Webhook secret、订阅 **Push** 事件并开启 Webhook，不能使用仅本机可访问的 localhost 地址。

将 `GITHUB_APP_CLIENT_ID`、`GITHUB_APP_CLIENT_SECRET`、`GITHUB_APP_CALLBACK_URL`、`GITHUB_APP_MASTER_KEY` 配置在 API 服务环境中；启用 Webhook 时再配置 `GITHUB_APP_WEBHOOK_SECRET` 和 `GITHUB_APP_WEBHOOK_URL=https://<专用公网域名>/api/project-github/webhook`。主密钥须是独立生成的 64 位十六进制值；Webhook secret 与主密钥分开。不要将密钥放入仓库、聊天消息或前端构建变量。服务重启后，项目分析页会显示缺失的授权配置项；提交后扫描的开关会分别检查 Webhook secret 和公网 HTTPS 地址。URL 格式校验不证明 GitHub 能实际送达，仍须按真实交付记录验收。

## 正式联调记录

在完整服务部署前，可按[受限 HTTPS 入口与反向隧道联调方案](project-github-webhook-live-check.md)让 GitHub 的真实交付到达本机接收端；该方案须有专用域名、有效证书和独立 Webhook secret，当前尚未启用。

完成配置后，按以下顺序记录实际结果：连接与断开账号；安装时选择一个私有仓库并确认另一未选仓库不可读；私有扫描及模型发送预览；撤销安装授权后再次读取被拒绝；有效 push 触发指定分支扫描；错误签名、重复交付、未开启分支和乱序交付均不产生重复或回退扫描；模型分析的费用和报告证据仍需另行核对。记录 GitHub App ID、仓库 ID、分支、交付 ID、扫描／报告 ID 和时间，**不记录令牌或密钥**。

当前没有可用的专用公网 HTTPS 入口，Webhook 的真实交付验收须等入口可达。2026-11-14 已为私有联调仓库开启每 5 分钟定时检查，首次检查于 01:45 UTC 完成且无错误；它会发现所选分支的新 commit 并排队扫描，自动模型分析保持关闭，不替代 Webhook 的真实交付验收。执行测试与页面验收前，`TODOLIST.md` 14.7／14.11 保持未完成。

协议依据：[GitHub App 用户访问令牌](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[Webhook 签名验证](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)。
