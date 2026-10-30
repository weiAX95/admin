# GitHub Webhook 真实交付联调

本页是 14.11 的**临时联调方案**，不代表生产部署或验收完成。当前 API 与 PostgreSQL 在本机运行；公网主机只为 GitHub App 的 Webhook 提供一个 HTTPS 路径。域名、有效证书、GitHub App Webhook secret 和受限隧道账号准备好以后才能执行。

## 网络边界

```text
GitHub Push Webhook
  -> https://<专用域名>/api/project-github/webhook
  -> Nginx 精确路径匹配
  -> 公网主机 127.0.0.1:18002
  -> SSH 反向隧道
  -> 本机 127.0.0.1:8002 的 admin API
  -> PostgreSQL 交付记录与扫描队列
```

公网主机不运行 admin API，也不直接暴露本机数据库。Nginx 只代理这一条路径，其余路径返回 404。SSH 反向转发必须绑定公网主机的 `127.0.0.1`，不能绑定 `0.0.0.0`。使用单独的低权限隧道账号和受限 SSH 密钥；不要用 root 密码维持长期隧道。现有站点的 Nginx 配置与证书保持独立，启用前先核对专用域名的归属和 DNS。

## 准备配置

1. 在本机 API 的私有环境文件设置 `GITHUB_APP_WEBHOOK_SECRET`，使用独立随机值；在 GitHub App 的 Webhook 设置中填入相同值。此值不写入仓库、命令历史或联调记录。
2. GitHub App Webhook URL 填 `https://<专用域名>/api/project-github/webhook`，只订阅 `Push`，确认安装仍只覆盖用户允许的仓库。
3. 为专用域名取得有效 HTTPS 证书。在公网主机上创建只允许远程端口转发的隧道账号，检查 SSH 服务允许该账号转发，并让本机以受限密钥连接。
4. 在公网主机为专用域名配置 Nginx。下面只展示关键 `location`，应放在该域名自己的 TLS `server` 中；该 `server` 的其他路径返回 404：

   ```nginx
   client_max_body_size 1m;
   location = /api/project-github/webhook {
       limit_except POST { deny all; }
       proxy_pass http://127.0.0.1:18002;
       proxy_request_buffering on;
       proxy_set_header Host $host;
   }
   ```

5. 本机 API 已在 `127.0.0.1:8002` 监听后，启动反向隧道。`<隧道账号>` 和 `<公网主机>` 由部署时确定：

   ```sh
   ssh -N -T -o ExitOnForwardFailure=yes -R 127.0.0.1:18002:127.0.0.1:8002 <隧道账号>@<公网主机>
   ```

如果隧道中断，Nginx 返回上游不可用，GitHub 可重新投递；数据库交付 ID 去重。临时联调结束后，关闭 GitHub App Webhook、断开隧道并移除临时 Nginx 入口。正式部署须以持续运行的 API、数据库、备份和监控替代这条临时隧道。

## 验收记录

先通过页面开启指定仓库、分支的提交后扫描，再用 GitHub App 的真实 `Push` 交付记录核对：有效交付入库并排队；重复交付只处理一次；错误签名拒绝；未开启的仓库或分支不扫描；乱序旧交付不回退当前分支；没有有效文件变化时不重复生成报告。记录仓库 ID、分支、交付 ID、扫描 ID、时间、结果和 GitHub Delivery 状态；不得记录签名、密钥、令牌或完整私有代码。模型分析仍须按页面的费用与发送范围确认，并单独验收。

这些结果尚未取得，`TODOLIST.md` 中的 14.11 及其 AC 保持未完成。
