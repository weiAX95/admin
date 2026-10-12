# 会话成本估算

会话成本基于聊天端上报的 assistant 消息用量。`usage.model` 必须与模型注册中心的**唯一标识** `experiment_models.name` 一致；API 模型名或显示名不能代替该标识。管理员可在「系统设置 → 会话模型定价」调整统一模型目录的输入／输出价格，单位是美元／千 token；也可登记仅用于聊天计价、不启用实验执行的外部模型。价格变更同时影响未来实验运行所读取的同一模型价格。

每条可计价消息的美元成本为 `(promptTokens × inputUsdPerMillion + completionTokens × outputUsdPerMillion) ÷ 1,000,000`。入库时保存当时匹配模型的价格快照；已入库消息再次上报相同用量不再写第二份快照。会话页可切换：

- **按现价重算**：读取当前统一模型价格，历史用量随调价变化。模型改名时优先通过保存的模型 ID 匹配。
- **上报时价格**：读取消息首次上报用量时的快照，之后调价不影响该值。启用此功能前已上报的旧消息没有可信历史价格快照，保持未定价。

未知模型、未上报模型标识或缺少相应价格的消息不计入已知金额，并单列「未定价消息」数量。逐会话成本仅在该会话所有已上报用量都可计价时显示完整数值；否则显示「未定价／部分未定价」。趋势和模型饼图仅汇总可计价消息，日历按上海时区，周从周一开始。美元金额是**估算值**，与提供商账单和实验／评测费用账本不是同一数据源；聊天端尚未接入实际模型用量上报时不能将空值解释为免费。

数据库迁移 [063_session_cost_snapshots.sql](../db/migrations/063_session_cost_snapshots.sql) 新增 `session_usage_prices`，用 `(session_id,message_id)` 复合外键关联消息，用可置空外键关联注册模型；删除消息时级联删除价格快照，删除模型时保留价格数字。管理员改价写入安全审计日志。`GET /api/sessions/cost-stats` 支持 `priceMode=current|snapshot` 和 `granularity=day|week|month`；`GET /api/sessions/model-prices`、`PATCH /api/sessions/model-prices/:id` 管理价格。
