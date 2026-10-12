# 会话主题聚类

聚类只读取每段会话的**首条用户消息**。服务端用 `Intl.Segmenter('zh-CN')` 分词，去掉标点、单字符和少量常见停用词；在当前会话语料中计算 TF-IDF 向量，用确定性初始化和 K-Means 分组。每组按中心向量权重最高的三个词生成默认标签。自动 K 为 `ceil(sqrt(有效会话数 / 2))`，范围 1–12；管理员可固定为 1–20，实际组数不超过有效会话数。

服务启动时为迁移或导入的旧会话补建分组；首次上报或补充首条用户消息后，新会话按与已有中心的余弦相似度加入最近组。自动 K 增长到需要更多组时重算全体，增长阈值和已归类文档数持久化，避免新会话每次上报都触发全量重算。过期会话清理后同步重算成员数。没有有效分词结果的会话显示“未归类”。管理员可重新聚类并修改组标签；重算时按中心相似度匹配旧组，尽量保留人工标签和组 ID。组是语料的统计结果，不代表人工确认的学科分类；语料显著改变后应重算并复核标签。

`GET /api/sessions/clusters` 返回组、条数和 K；`GET /api/sessions?clusterId=<id>` 筛选会话。管理员看到全部组与自动／人工标签；普通账号只看到本人会话所在组、本人的条数及匿名编号。聚类中心仍按全体会话计算，故普通账号暂不展示可能包含他人提问词的全局标签。管理员用 `PUT /api/sessions/clusters/config` 设置 `{ "k": "auto" }` 或 1–20 的整数，并触发重算；`POST /api/sessions/clusters/rebuild` 按当前 K 重算；`PATCH /api/sessions/clusters/:id` 修改标签。算法代码与回归样本见 [session-clusters.mjs](../mock/session-clusters.mjs) 和 [session-clusters.test.mjs](../tests/session-clusters.test.mjs)。页面正式显示与真实语料聚类质量仍由用户验收。
