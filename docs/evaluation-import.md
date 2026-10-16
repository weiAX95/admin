# 评测数据集 CSV／JSONL 导入

页面先在浏览器解码 UTF-8／GBK、解析文件并映射列。映射后的每行以 `{ rowNumber, data, parseErrors }` 提交，`rowNumber` 保留文件原始行号。`parseErrors` 只用于保留前端无法从映射结果还原的单元格解析错误；服务端仍独立校验用例字段、重复 `caseKey`、媒体附件访问权和配额。

`POST /api/evaluation/datasets/import-preview` 只读，返回 `{ valid, invalid, errors, globalErrors }`。`errors` 列出所有无效行的原始行号、用例 ID 和原因；媒体权限或配额等影响整批的错误放在 `globalErrors`。用户切换列映射或目标数据集后重新预览，旧预览不能用于确认。

`POST /api/evaluation/datasets/import` 使用相同请求体，并可附 `skipInvalid: true`。服务端在确认时重新执行全部校验：默认任一无效行都以 422 拒绝整批；选择跳过时只写入有效行，返回 `imported`、`skipped` 和逐行错误。没有有效行或存在整批错误时拒绝写入。新数据集及其首版、已有数据集的新版本都在请求事务中提交；版本为不可变快照。已有数据集只允许创建者或管理员追加版本。

两个接口均接受最多 10,000 行；媒体通过已上传的附件 ID 引用，不把文件内容放入 CSV／JSONL。页面仍保留手工 JSON 新建和新增版本入口。
