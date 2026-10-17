# GitHub App 账号授权：当前交付边界

当前 `/project-analysis` 新增账号连接入口。管理员先在 GitHub 建立 GitHub App，设置用户授权回调为同源的 `/api/project-github/callback`，仅申请仓库 Metadata read 与 Contents read，并启用会过期的用户访问令牌。服务端配置 `GITHUB_APP_CLIENT_ID`、`GITHUB_APP_CLIENT_SECRET`、`GITHUB_APP_CALLBACK_URL` 与独立的 `GITHUB_APP_MASTER_KEY`。本地开发启动命令会生成主密钥；正式环境应由密钥管理系统提供，API 和后续扫描 worker 使用同一密钥。主密钥轮换可通过版本和旧密钥映射读取旧记录，完成逐条重加密后再移除旧密钥。

连接流程生成 256 位随机 `state`，数据库只存其 SHA-256，十分钟内仅可使用一次。回调以 `state` 找回管理端账号；GitHub 授权码只在服务端交换。服务端用用户访问令牌读取 `/user` 验证 GitHub 身份，并以 AES-256-GCM 加密保存访问与刷新令牌。加密附加数据绑定管理端账号、字段和密钥版本。状态接口只返回 GitHub 登录名和到期时间；断开连接删除该账号保存的令牌及未完成授权状态。管理端账号删除时通过外键清理凭证。调用 GitHub 前，服务端在访问令牌接近到期时以刷新令牌续期；刷新令牌失效或 GitHub 返回 401 时清除连接，要求重新授权。数据库行锁防止同一账号并发续期互相覆盖。

账号连接不等于已授权任意私有仓库。页面可通过当前账号的用户令牌列出 GitHub App 安装中可访问的仓库；当前最多读取 500 个并标记截断。用户可显式选择其中一个私有仓库登记到项目列表。服务端重新读取 `/repos/{owner}/{repo}`，确认当前用户令牌确实可访问且仓库为私有；登记、分支刷新和所有该仓库的详情请求重新核验权限，失权后列表隐藏该仓库，详情返回拒绝。公开仓库仍按原有无凭证路径读取。私有仓库扫描前后再次核验权限，读取树和 blob 均带当前账号的 App 用户令牌，禁用旧正文复用；授权失效会终止扫描并拒绝保存结果。正在进行的 GitHub HTTP 请求持有数据库共享锁，断开连接要等待这些请求结束；断开返回后不再启动新的私有读取。私有仓库的模型分析创建目前仍关闭，直到范围、供应商与数据去向确认以及分析 worker 的权限复核接通。GitHub 回调中的 `installation_id` 不作为权限凭据。断开本系统连接只删除本系统凭证；若需撤销 GitHub App 在 GitHub 的安装授权，还须在 GitHub 设置中操作。

对应表为 [120_project_github_connections.sql](../db/migrations/120_project_github_connections.sql) 的 `project_github_oauth_states` 和 `project_github_connections`。两表均以 `owner_id` 外键绑定 `users`，删除账号时级联删除；不与仓库数据建立假外键。[121_project_private_repositories.sql](../db/migrations/121_project_private_repositories.sql) 为仓库行标记 `is_private`，旧仓库默认公开。授权回调必须经前端同源 `/api` 反向代理，以便回到 `/project-analysis`；生产环境应使用 HTTPS。用户令牌只留在服务端，不得写入日志、API 响应或模型输入。

参考 GitHub 官方文档：[用户访问令牌授权](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[令牌续期](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)、[安装设置 URL 的安全说明](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)。
