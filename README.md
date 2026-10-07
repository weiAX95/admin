# Agent Admin

Agent 学习管理端，使用 React、TypeScript、Vite 与 Ant Design，提供学习任务、笔记、实验、会话记录和统计看板。开发 API 使用 PostgreSQL 持久化。

## 本地运行

准备 Node.js、npm 和 Docker，首次运行依次执行：

```bash
npm ci
npm run db:up
npm run db:migrate
npm run db:import
npm run dev
```

`db:import` 仅用于从现有 `mock/db.json` 一次性迁移数据。如果没有旧数据，先运行 `npm run db:migrate`，再按需准备账号；服务不会从空库自动生成演示数据。导入要求目标库为空，在一个事务中保留旧记录 ID 与时间、转换账号密码，并核对记录及关联数量。导入前会将原文件备份到 `mock/db-backups/`，原文件也保留；再次导入会因目标库非空而失败。迁移完成后 API 只读写 PostgreSQL，不再回退或写入 JSON。

管理端默认地址为 `http://localhost:5176`，API 默认端口为 `8002`。旧演示数据的账号为 `admin`，密码为 `admin123`，仅供本地使用。`npm run dev` 同时启动 API 与 Vite。

Docker Compose 将开发库映射到本机 `55432` 端口，并初始化独立的 `agent_admin_test` 测试库。需要连接其他 PostgreSQL 实例时，设置 `DATABASE_URL`；测试使用 `TEST_DATABASE_URL`。示例连接串见 `.env.example`。迁移脚本需要先于 API 运行；数据库不可用或未迁移时，API 会明确报错。

## 数据迁移与备份

迁移前保留 `mock/db.json` 原件。首次执行 `npm run db:import` 时还会生成只允许当前用户读取的时间戳备份。若使用自定义文件，可运行 `npm run db:import -- /绝对路径/db.json`。导入失败会回滚 PostgreSQL 事务，检查数据后应在空库重试。

切换到 PostgreSQL 后，请用数据库备份工具保管新数据，例如：

```bash
docker compose exec -T postgres pg_dump -U admin -Fc agent_admin > agent_admin.dump
```

恢复前先确认目标数据库和备份版本，避免覆盖现有数据。开发库与测试库应保持隔离；不要把生产数据导入测试库。本仓库的 API 面向本地开发，本轮不包含生产部署。各页面的取数路径、63 张表的关系与外键边界见 [数据库关系图](docs/database-relationships.md)；迁移取舍见 [架构决策](docs/adr/001-postgresql-migration.md)。

Markdown 图片经 `/api/assets` 上传并保存到 `mock/uploads/`（可用 `ASSET_DIR` 调整）。图片仅登录后可读取，支持 PNG/JPEG/WebP/GIF，每张上限 10 MB；超过 24 小时且未被当前笔记、任务或实验内容引用的图片会自动清理。**备份时需同时保存 PostgreSQL 和附件目录**，只恢复数据库会导致图片 URL 失效。笔记引用以 `[[标题]]` 编写；唯一匹配时保存为 `[[标题|id:笔记ID]]`，改名仍指向同一笔记，删除目标后显示悬空占位。

笔记分类由 `/api/note-categories` 管理，可建立多级目录；笔记标签独立于任务标签。编辑笔记时可输入新标签，或从包含零使用标签的目录中选择；目录将英文大小写和首尾空格不同的名称归为同一标签。`GET /api/note-tags` 返回标签及使用篇数；管理员可通过 `POST /api/note-tags` 创建空标签、`PATCH /api/note-tags/:id` 重命名、`POST /api/note-tags/:id/merge` 合并及 `DELETE /api/note-tags/:id` 删除。合并请求体需包含 `targetId` 和 `expectedUsageCount`；删除请求需带同名查询参数，使用篇数变化时返回 409，页面需重新确认。`GET /api/notes` 支持 `keyword`、`categoryId`、可重复的 `tag` 和 `taskId` 参数，分类筛选包含子分类，多标签取交集。当前本地 API 在 PostgreSQL 请求工作集中过滤，后续定向 SQL 查询可再优化。会话行内选中文字后可创建带 `sourceSessionId` 的笔记。

`/notes/graph` 展示笔记、任务和会话的知识图谱；`GET /api/knowledge-graph` 从当前数据生成节点及引用、任务关联、来源会话三种边。笔记详情的“历史版本”读取 `/api/notes/:id/versions`，保存和回滚都会追加包含标题与正文的快照；旧笔记迁移时仅把当时内容作为第 1 版基线，不推断更早历史。笔记详情可下载 Markdown、HTML 或 PDF，笔记列表的 ZIP 导出覆盖当前搜索、分类和标签筛选结果的全部笔记，每篇为独立 Markdown 文件。HTML 会净化原生 HTML 并内嵌本地附件图片；PDF 使用中文字体分页绘制 Markdown 结构和语法高亮的代码行。

`/notes/reviews` 是每个账号独立的复习面板。新笔记与新账号自动建立计划；旧笔记在执行 `008_note_reviews` 迁移当天开始第一个周期。到期日按上海日历计算，服务在当天 09:00 生成站内通知；正文变化或正文回滚让所有账号从 1 天间隔重新开始，标题、分类和标签修改不重启。完成复习依次进入 2、4、7、15、30 天，之后保持 30 天。`GET /api/note-reviews` 查询今日及逾期项目，`POST /api/note-reviews/:noteId/complete` 带当前 `generation` 防止重复提交；`GET /api/notifications` 查询站内提醒，`POST /api/notifications/:id/read` 标记已读。

邮件提醒由账号在复习面板填写邮箱并启用，设置经 `/api/account/review-settings` 保存；SMTP 由 `.env.example` 中的 `SMTP_HOST`、`SMTP_PORT`、`SMTP_FROM`（可选 `SMTP_USER`、`SMTP_PASSWORD`）配置。未配置 SMTP 时站内提醒仍正常，待发送邮件保留并在服务配置后尝试发送；失败状态和错误保留在数据库并按退避间隔重试。邮件投递属于至少一次语义：服务在 SMTP 已接收但尚未记录成功时崩溃，重试可能产生重复邮件。**本地 API 必须持续运行才能在 09:00 准时触发**；停机期间遗漏的提醒会在下次启动补建。新建笔记还可选用五种内置 Markdown 模板，正文保存后可自由编辑。

实验平台的可执行定义与旧手工记录并存。管理员须在“实验 → 模型与预算配置”中加入模型及美元／百万 token 价格、设置每日预算和并发上限，并选择独立的 Judge 模型；服务端须配置 `MODEL_API_BASE_URL` 与 `MODEL_API_KEY`，密钥不返回浏览器。未配置时可保存定义，但不能执行。当前模型调用依赖兼容 `/chat/completions`、`choices[0].message.content` 和 `usage.prompt_tokens/completion_tokens` 的接口。提示词库支持版本化存储，五种内置实验模板只作为可修改的初始值。

实验定义可以单次执行、A/B 批量执行，也能选择有版本的数据集与指标版本进行回归。评分同时保存规则分、Judge 分和合成分，人工星级另存；缺少 Judge 评分的输入组不计入 A/B 胜率。数据集候选池来自人工标注，但须人工审核后才可进入正式数据集。回归报告可以导出带中文字体的 PDF。版本链先提出相似标题建议，用户确认后才建立稳定链 ID。分享公开页展示最新实验配置与结果，创建前应核对预览内容；令牌只以哈希形式存储，可设期限及撤销。

运行队列、批次和调度进度保存在 PostgreSQL。服务启动及运行期间会恢复超过 6 分钟未更新的运行中任务，避免过早重试仍在等待模型响应的请求；崩溃发生在模型已返回而结果尚未落库的窗口时，外部调用可能重复。调度按账号选择的 IANA 时区计算每天、每周或每月的本地执行时间；夏令时缺失时刻顺延到当天首个有效时刻，重复时刻取第一次。调度周期以唯一键去重，连续三个周期失败后自动暂停；站内通知不依赖邮件。实验邮件沿用 `SMTP_*` 环境变量，失败会重试。**本地 API 必须持续运行才会准时执行**，停机期间到期任务在恢复后补建。

提交批次前会按模型价格和 token 上限估算最大费用并核对每日预算；每次运行保留主模型和 Judge 的价格快照，实际成本按两者返回的 token 用量计算。预算估算用于限制提交，最终费用以供应商账单为准。实验成本页汇总本月费用、模型占比及最贵实验。50 条回归用例在本机 loopback 假模型、并发 10、无人工网络延迟条件下测得约 7.5 秒；真实模型和网络的耗时需在目标环境重测。

`/prompts` 已提供独立的提示词条目、目录、标签与版本页面。旧整数版本 N 迁移为 `0.0.N`，原版本 ID 与实验关联保留；新增版本默认 patch，可选择 minor 或 major，历史恢复会追加版本。所有登录账号可读取或创建，作者与管理员可编辑；文件夹及自定义敏感信息规则仅管理员管理。提示词保存扫描手机号、身份证号、邮箱及密钥模式：疑似密钥阻止保存，其他命中须明确确认。当前自定义正则限制长度和语法，不支持分组、分支及无界重复，以控制回溯风险。新提示词 API 位于 `/api/prompts`；旧 `/api/experiment-platform/prompts` 仍可读取。引用、全文检索、运行统计、多模态执行及外部同步将在后续阶段接入。

## 验证与构建

先启动 PostgreSQL，再执行：

```bash
npm test
npm run build
npm run lint
```

测试会在 `TEST_DATABASE_URL` 指向的实例中创建并删除独立临时数据库，不会修改开发库。构建产物位于 `dist/`。字体文件及授权说明位于 `public/fonts/`，用于中文 PDF 导出。

## 项目结构

- `src/`：页面、组件、接口调用与状态逻辑。
- `mock/`：本地 API 与一次性旧数据来源。
- `db/`：版本化 SQL 迁移及本地测试库初始化。
- `tests/`：Node.js 测试。
- `scripts/`：开发与数据库命令。
- `TODOLIST.md`：功能与迭代记录。
