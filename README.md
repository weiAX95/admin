# Agent Admin

管理员可在 `/settings` 修改品牌、默认显示参数和新登录有效期；每个账号可在同页修改自己的主题、主色及密度。`032_system_settings.sql` 会在 `npm run db:migrate` 中执行。会话有效期默认为 24 小时，仅影响新登录；旧令牌保留原到期时间。设置写入使用版本号，遇到冲突请刷新后重试。全站英文文案、统一日期展示及完整亮色图表适配仍在后续开发中。

更新日志保存在 `CHANGELOG.json`，每个当前版本都必须有中英文标题及变更列表；`npm run build` 会校验。页面从服务端获取 GitHub 最新正式 Release，缓存 30 分钟；无 Release 或离线时不会显示更新提示。

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

恢复前先确认目标数据库和备份版本，避免覆盖现有数据。开发库与测试库应保持隔离；不要把生产数据导入测试库。本仓库的 API 面向本地开发，本轮不包含生产部署。各页面的取数路径、85 张表的关系与外键边界见 [数据库关系图](docs/database-relationships.md)；迁移取舍见 [架构决策](docs/adr/001-postgresql-migration.md)。

管理员可在“系统设置 → 数据保留策略”调整安全审计（默认 90 天）、会话（默认 180 天）和核心内容回收站（默认 30 天）保留期，以及系统时区下的每日清理时间（默认 03:00）。API 运行时自动执行，停机后在当天设定时间之后启动会补做一次。删除会话时，未审核的会话评测候选随之清理，已审核候选和摘录笔记保留；笔记详情提示“原会话已清理”。删除任务、笔记、实验或提示词后，管理员可从回收站恢复或永久删除；设为 0 天时立即永久删除。恢复任务不会重建删除时已从其他任务移除的依赖边；实验恢复后原调度和分享保持停用，需手动重新配置。若外键阻止永久删除，清理器记录失败并保留该条目。

Markdown 图片经 `/api/assets` 上传并保存到 `mock/uploads/`（可用 `ASSET_DIR` 调整）。图片仅登录后可读取，支持 PNG/JPEG/WebP/GIF，每张上限 10 MB；超过 24 小时且未被当前笔记、任务或实验内容引用的图片会自动清理。**备份时需同时保存 PostgreSQL 和附件目录**，只恢复数据库会导致图片 URL 失效。笔记引用以 `[[标题]]` 编写；唯一匹配时保存为 `[[标题|id:笔记ID]]`，改名仍指向同一笔记，删除目标后显示悬空占位。

笔记分类由 `/api/note-categories` 管理，可建立多级目录；笔记标签独立于任务标签。编辑笔记时可输入新标签，或从包含零使用标签的目录中选择；目录将英文大小写和首尾空格不同的名称归为同一标签。`GET /api/note-tags` 返回标签及使用篇数；管理员可通过 `POST /api/note-tags` 创建空标签、`PATCH /api/note-tags/:id` 重命名、`POST /api/note-tags/:id/merge` 合并及 `DELETE /api/note-tags/:id` 删除。合并请求体需包含 `targetId` 和 `expectedUsageCount`；删除请求需带同名查询参数，使用篇数变化时返回 409，页面需重新确认。`GET /api/notes` 支持 `keyword`、`categoryId`、可重复的 `tag` 和 `taskId` 参数，分类筛选包含子分类，多标签取交集。当前本地 API 在 PostgreSQL 请求工作集中过滤，后续定向 SQL 查询可再优化。会话行内选中文字后可创建带 `sourceSessionId` 的笔记。

`/notes/graph` 展示笔记、任务和会话的知识图谱；`GET /api/knowledge-graph` 从当前数据生成节点及引用、任务关联、来源会话三种边。笔记详情的“历史版本”读取 `/api/notes/:id/versions`，保存和回滚都会追加包含标题与正文的快照；旧笔记迁移时仅把当时内容作为第 1 版基线，不推断更早历史。笔记详情可下载 Markdown、HTML 或 PDF，笔记列表的 ZIP 导出覆盖当前搜索、分类和标签筛选结果的全部笔记，每篇为独立 Markdown 文件。HTML 会净化原生 HTML 并内嵌本地附件图片；PDF 使用中文字体分页绘制 Markdown 结构和语法高亮的代码行。

`/notes/reviews` 是每个账号独立的复习面板。新笔记与新账号自动建立计划；旧笔记在执行 `008_note_reviews` 迁移当天开始第一个周期。到期日按上海日历计算，服务在当天 09:00 生成站内通知；正文变化或正文回滚让所有账号从 1 天间隔重新开始，标题、分类和标签修改不重启。完成复习依次进入 2、4、7、15、30 天，之后保持 30 天。`GET /api/note-reviews` 查询今日及逾期项目，`POST /api/note-reviews/:noteId/complete` 带当前 `generation` 防止重复提交；`GET /api/notifications` 查询站内提醒，`POST /api/notifications/:id/read` 标记已读。

邮件提醒由账号在复习面板填写邮箱并启用，设置经 `/api/account/review-settings` 保存；SMTP 由 `.env.example` 中的 `SMTP_HOST`、`SMTP_PORT`、`SMTP_FROM`（可选 `SMTP_USER`、`SMTP_PASSWORD`）配置。未配置 SMTP 时站内提醒仍正常，待发送邮件保留并在服务配置后尝试发送；失败状态和错误保留在数据库并按退避间隔重试。邮件投递属于至少一次语义：服务在 SMTP 已接收但尚未记录成功时崩溃，重试可能产生重复邮件。**本地 API 必须持续运行才能在 09:00 准时触发**；停机期间遗漏的提醒会在下次启动补建。新建笔记还可选用五种内置 Markdown 模板，正文保存后可自由编辑。

实验平台的可执行定义与旧手工记录并存。管理员须在“实验 → 模型与预算配置”中加入模型及美元／百万 token 价格、设置每日预算和并发上限，并选择独立的 Judge 模型。管理员可在“系统设置 → 模型连接”中为同一供应商建立多条加密连接，再为模型显式绑定。未绑定模型优先使用该供应商的默认数据库连接；缺失时才读取旧环境变量。服务端须设置 `MODEL_CONNECTION_MASTER_KEY`（32 字节随机密钥的十六进制表示）；API 与独立 worker 使用相同密钥。轮换主密钥时用 `MODEL_CONNECTION_KEY_VERSION` 标识新版本，并在 `MODEL_CONNECTION_PREVIOUS_KEYS` 中保留旧版本密钥，逐条重新加密连接后才能移除旧密钥。数据库只存密文、随机 nonce、认证标签及脱敏显示值。旧兼容 `/chat/completions` 文本调用可继续使用 `MODEL_API_BASE_URL` 与 `MODEL_API_KEY`；OpenAI、千问和 Gemini 原生适配器可使用各自环境变量。未配置时可保存定义，但不能执行。连接测试会用选定模型发出一次最小请求，可能产生少量费用。提示词库支持版本化存储，五种内置实验模板只作为可修改的初始值。

评测自定义 Python 指标在 `/evaluation/metrics` 登记，源码须定义 `score(payload)` 并返回 0–1 或 `None`。先在运行 API 的主机构建镜像：`docker build -f docker/evaluation-python.Dockerfile -t agent-eval-python:local .`，再将 `EVALUATION_PYTHON_IMAGE=agent-eval-python:local` 加入环境。容器以禁网、只读文件系统、非 root、无 Linux capabilities、有限 CPU／内存／进程数运行；单用例 30 秒超时。API 进程需要 Docker daemon 访问权限，实际部署宜将此 worker 移至独立主机。镜像不存在时，页面和接口会显示不可用，不允许创建或运行对应指标。[Docker 运行限制参考](https://docs.docker.com/reference/cli/docker/container/run)。

BERTScore 使用独立的 `docker/evaluation-bertscore.Dockerfile`，预装多语模型，通过官方 [BERTScore 实现](https://github.com/Tiiiger/bert_score)在 CPU 上计算。该镜像和模型不适合 2 GB 目标主机，默认禁用；在更大内存的 worker 上构建后才配置 `EVALUATION_BERTSCORE_IMAGE` 和 `EVALUATION_BERTSCORE_ENABLED=true`。目前 BERTScore 适配与模拟服务测试已完成，真实模型镜像的运行和吞吐仍待单独验收。

实验定义可以单次执行、A/B 批量执行，也能选择有版本的数据集与指标版本进行回归。评分同时保存规则分、Judge 分和合成分，人工星级另存；缺少 Judge 评分的输入组不计入 A/B 胜率。数据集候选池来自人工标注，但须人工审核后才可进入正式数据集。回归报告可以导出带中文字体的 PDF。版本链先提出相似标题建议，用户确认后才建立稳定链 ID。分享公开页展示最新实验配置与结果，创建前应核对预览内容；令牌只以哈希形式存储，可设期限及撤销。

运行队列、批次和调度进度保存在 PostgreSQL。服务启动及运行期间会恢复超过 6 分钟未更新的运行中任务，避免过早重试仍在等待模型响应的请求；崩溃发生在模型已返回而结果尚未落库的窗口时，外部调用可能重复。调度按账号选择的 IANA 时区计算每天、每周或每月的本地执行时间；夏令时缺失时刻顺延到当天首个有效时刻，重复时刻取第一次。调度周期以唯一键去重，连续三个周期失败后自动暂停；站内通知不依赖邮件。实验邮件沿用 `SMTP_*` 环境变量，失败会重试。**本地 API 必须持续运行才会准时执行**，停机期间到期任务在恢复后补建。

评测执行可与 HTTP API 分进程运行：在 API 环境设置 `EXPERIMENT_WORKER_MODE=external`，再用相同的 `DATABASE_URL`、模型凭据和评测容器配置启动 `npm run worker`。API 只写入持久队列；worker 处理实验、数据集评测与两类调度，重启后恢复超时任务。两个进程须使用相同数据库，且不要同时让 API 的内嵌运行器处理同一队列。详情页的运行进度使用数据库中全部条目的汇总计数，运行明细只展示最近 1,000 条；回归报告运行中每 2 秒读取轻量进度，终态才加载完整逐用例报告。可运行 `npm run benchmark:evaluation` 复测本地模拟 100 用例：2026-10-08 在 macOS arm64、10 CPU、16 GiB、并发 10、127.0.0.1 无外部网络延迟的假模型及 Judge 上，提交至 100 条全部完成耗时 14,852 ms；真实模型与目标服务器须另测。

`npm run benchmark:evaluation-report` 在临时数据库中生成 10,000 条已完成的合成基线与回归结果，测量 HTTP 报告生成和传输。2026-10-08 同一台 macOS arm64、10 CPU、16 GiB 主机的本地 API 耗时 501 ms，JSON 响应 5,626,120 字节；这不包含模型调用、浏览器解析或图表渲染。报告详情仍一次取全量逐用例数据，目标服务器和浏览器的交互性能需另行验收。

提交批次前会按模型价格和 token 上限估算最大费用并核对每日预算；每次运行保留主模型和 Judge 的价格快照，实际成本按两者返回的 token 用量计算。预算估算用于限制提交，最终费用以供应商账单为准。实验成本页汇总本月费用、模型占比及最贵实验。50 条回归用例在本机 loopback 假模型、并发 10、无人工网络延迟条件下测得约 7.5 秒；真实模型和网络的耗时需在目标环境重测。

`/prompts` 已提供独立的提示词条目、目录、标签与版本页面。旧整数版本 N 迁移为 `0.0.N`，原版本 ID 与实验关联保留；新增版本默认 patch，可选择 minor 或 major，历史恢复会追加版本。所有登录账号可读取或创建，作者与管理员可编辑；文件夹及自定义敏感信息规则仅管理员管理。提示词保存扫描手机号、身份证号、邮箱及密钥模式：疑似密钥阻止保存，其他命中须明确确认。当前自定义正则限制长度和语法，不支持分组、分支及无界重复，以控制回溯风险。新提示词 API 位于 `/api/prompts`；旧 `/api/experiment-platform/prompts` 仍可读取。目前可按最新版本或历史版本搜索名称、正文和标签；固定版本引用在运行时展开，直接及间接版本均记录实验调用事实。提示词库可批量导出 JSON/YAML，导入先预览再确认；疑似密钥版本跳过，其他敏感命中需确认，重复来源和版本不会再复制。含媒体的提示词可导出“清单＋附件”ZIP，通过 `/api/prompts/archive` 下载；回导先预览再确认，校验附件大小、类型和 SHA-256，跨库导入重新分配媒体 ID，同来源重复导入不会复制。归档最大 1 GiB，导入期间需要足够的临时磁盘空间。LangSmith/LangFuse 已提供管理员手动只读同步与逐条跳过报告；目前仅导入可无损映射的文本版本，外部媒体版本跳过。

管理员在 `.env` 中配置 `PROMPT_SYNC_LANGFUSE_*` 或 `PROMPT_SYNC_LANGSMITH_*` 后，可从提示词库“外部同步”先预览再确认。服务端分别使用 [LangFuse 提示词 REST API](https://api.reference.langfuse.com) 的分页列表与逐版本读取、[LangSmith 仓库／提交 API](https://api.smith.langchain.com/redoc) 的分页列表；来源不变时重复执行不会复制版本。预览和确认之间外部内容变化会拒绝提交；密钥命中跳过，其他敏感内容需确认。自托管主机需显式加入 `PROMPT_SYNC_ALLOWED_HOSTS`，凭据仅在服务端使用。仅能无损映射的文本及简单聊天版本会导入，复杂消息／媒体、配置或模板语法逐条跳过并展示原因；真实外部服务与媒体复制需配置凭据后另行验收。

提示词版本支持有序文本、图片、音频和视频消息片段。`POST /api/prompt-media` 使用登录令牌与 `x-media-kind` 上传原始字节；图片上限 10 MB，音频 50 MB／10 分钟，视频 500 MB／10 分钟，可用环境变量调低。服务端按内容识别文件并用内置 ffprobe 核对时长；附件保存在 `PROMPT_MEDIA_DIR`（默认 `mock/prompt-media/`），备份时须连同 PostgreSQL 保存。附件仅允许登录账号读取。当前适配器对 OpenAI 使用 Responses、对千问使用 Chat Completions 的多模态内容、对 Gemini 使用 generateContent；按模型声明的能力在批次提交前检查，工具调用只记录，不自动执行。当前执行支持文本，以及经模型能力声明的 Gemini 图片输出（最多 4 张）和 OpenAI Responses 图片生成工具输出（单张）；执行前按供应商上限预留预算，实际生成文件单独存储、按张数和价格快照计费。OpenAI 图片生成不能与自定义工具同时配置。Gemini TTS 音频输出仅接受纯文本用户输入、无 system prompt；执行前按最多 10 分钟预留预算，成功后验证 WAV 文件、按实际时长及价格快照计费，详情页可播放。输出图片可由具备图片输入能力且配置图片输入价格的 Judge 评分；语音可由同样配置音频能力及价格的 Gemini Judge 评分。评分调用和媒体费用按提交时的价格快照计入；媒体结果不适用文本参考答案规则指标。没有兼容 Judge 或评分失败时保留人工标注，自动评分保持空值。视频输出尚未接通，OpenAI 视频输入不开放；Gemini 超过 20 MB 的音视频输入改走 Files API 并等待处理完成；其他供应商仍需满足每件媒体 20 MB 内联请求上限。真实供应商连通需各自凭据，自动测试使用本地模拟服务。

搜索基准可运行 `node scripts/benchmark-prompts.mjs`：它在临时测试库写入 1 万条提示词、每条 3 版及 3 个标签，测量 30 次 HTTP 查询后自动删库。本机一次测量中，普通搜索 p95 为 90.35 ms，受限正则 p95 为 52.06 ms；其他设备与数据分布需重新测量。

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
