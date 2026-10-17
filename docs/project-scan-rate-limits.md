# GitHub 扫描限流与恢复

扫描器顺序请求固定 commit 的 Git 树和 blob，跨 API 进程使用 PostgreSQL 咨询锁保证同时只有一项扫描访问 GitHub。遇到 `429`，或带限流响应头／限流消息的 `403`，立即停止本轮读取，不把余下文件伪装成已扫描。普通权限错误与限流分开处理。

下次允许请求的时间优先取 `Retry-After`，其次在剩余额度为 0 时取 `x-ratelimit-reset`；无这两项时至少等待一分钟。为连续限流使用递增退避，最多自动重试三次；单次等待最多一天。扫描的重试次数、下次时间和 `GITHUB_RATE_LIMIT` 状态持久化在 PostgreSQL。服务启动会恢复排队任务，运行期间每五秒检查到期任务；超过上限后标为失败，可稍后新建扫描。重试会重新读取目标 commit 的索引，成功时将文件和差异作为一次事务保存。

上述时间选择依据 [GitHub REST API 最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)。即使限流最终解除，网络、权限、目录截断和文件预算仍可能让扫描失败或只覆盖部分文件；页面分别显示等待、失败和部分覆盖，不据此推断整个仓库。
