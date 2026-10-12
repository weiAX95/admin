# 会话质量标记：当前检测口径

`POST /api/sessions/ingest` 首次上报、追加消息或补报用量后，在同一数据库事务中更新该会话的质量标记。迁移 `065_session_quality_flags.sql` 对升级时已有的消息回填；若先建最新数据库再导入旧 JSON，导入事务也会生成标记。`GET /api/sessions` 返回 `qualityFlags`，可用 `?quality=rejection` 或 `?quality=excessive_length` 筛选；会话详情也返回标记。

| 标记 | 触发条件 | 数据缺失时 |
| --- | --- | --- |
| `rejection` | assistant 正文匹配 `我无法`、`我不能` 或 `对不起.*无法` | 无正文不会触发 |
| `excessive_length` | assistant 明确上报的 `usage.completionTokens > 2000` | 未上报 token 时保持未知，不根据字符数猜测 |

同一会话可以有多个标记，数据库保存命中的消息 ID 和标记类型；列表只展示去重后的类型。规则识别的是需要复核的线索，不直接判定回复质量。重复提问的 embedding 余弦相似度检测、真实样本上的正则准确率测量和页面视觉验收仍属于 3.3 后续项，当前不显示没有实现的 `repeat_query_flag`。
