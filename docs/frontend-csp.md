# 前端内容安全策略

`npm run preview` 的静态页面响应现在带有 CSP、`nosniff` 和 Referrer 策略。CSP 允许本站脚本、样式和 API／WebSocket 连接；Markdown 外部图片、媒体及 PDF 导出读取外部图片可使用 HTTPS。禁止插件对象、外部脚本、跨站表单和页面嵌入。当前 Ant Design 运行时样式与初始页面样式需要 `style-src 'unsafe-inline'`；后续如移除运行时内联样式，可进一步收紧。

Vite 预览服务器不是正式部署服务器。正式部署静态文件时，反向代理必须对 HTML 响应设置与 `vite.config.ts` 中 `previewCsp` 一致的策略，并在 HTTPS 入口配置证书、HTTP 跳转 HTTPS 和 HSTS。API 的 JSON 响应已单独设置 `default-src 'none'`；这不能代替 HTML 页面的策略。

当前没有专用部署域名和已运行的生产静态文件服务，因此 HTTPS、正式响应头与浏览器兼容性仍需在部署后验收。
