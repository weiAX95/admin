# 会话 Token 用量

聊天端通过现有 `POST /api/sessions/ingest` 上报会话消息。首次上报需要管理端登录凭证；服务端记录这次上报所用账号，只有该账号或管理员能继续上报同一会话。迁移前的旧会话没有可信上报账号，只允许管理员续传。assistant 消息可增加 `usage: { promptTokens, completionTokens, model? }`；两个 token 字段必须为非负整数，`model` 可选。首次上报后，也可携带服务端返回的会话 ID、消息 ID、原始 role／content／at 补报用量。重复上报同一用量幂等；已有用量与新值不一致时返回 409，不允许悄悄改写。user 消息不能带用量。输入中没有 `usage` 的旧客户端仍可正常上报。

```json
{
  "id": "session-123",
  "messages": [{
    "id": "assistant-message-456",
    "role": "assistant",
    "content": "回答正文",
    "at": "2026-10-12T09:00:00.000Z",
    "usage": { "promptTokens": 120, "completionTokens": 30, "model": "model-name" }
  }]
}
```

服务只统计上报事实，不对旧消息按字符长度估算 token。`GET /api/sessions` 给每条会话返回 `totalTokens`，未上报为 `null`；`GET /api/sessions/token-stats` 返回本月、总计、每日趋势、平均值及 Top 10。每日和本月按消息时间的**上海日历日**归属；平均值分母只包含至少有一条用量记录的会话。没有任何记录时，汇总值为 `null`，页面显示「需接入 token 统计」。总 token 包含输入和输出；本月是本月消息用量，不按会话创建时间截断。已有消息不会因为重复上报而重复计数。

会话 JSON／Markdown 导出也包含已上报的消息用量；没有上报的消息不会填充估计值。

数据库迁移 [062_session_token_usage.sql](../db/migrations/062_session_token_usage.sql) 给 `session_messages` 增加可空的输入、输出 token 和模型字段，保持旧会话与旧数据导入兼容。当前管理端未代理聊天模型请求，因此显示值依赖聊天端提供商响应中的真实用量；聊天端接入前，页面仅能展示已有上报记录。
