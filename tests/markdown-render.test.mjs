import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("Markdown preview sanitizes HTML, renders math/code, and resolves only active wiki links", async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  try {
    const { default: MarkdownContent } = await vite.ssrLoadModule("/src/components/MarkdownContent.tsx");
    const content = `**加粗** $E=mc^2$\n\n$$\\int_0^1 x dx$$\n\n\`\`\`js\nconst x = 1\n\`\`\`\n\n\\[[跳过]] [[旧标题|id:n1]] [[不存在]]\n\n<script>alert(1)</script><a href="javascript:alert(2)" onclick="alert(3)">不安全</a>`;
    const html = renderToStaticMarkup(React.createElement(MarkdownContent, { content, notes: [{ id: "n1", title: "新标题" }], enableWikiLinks: true }));
    assert.match(html, /<strong>加粗<\/strong>/);
    assert.match(html, /class="katex"/);
    assert.match(html, /katex-display/);
    assert.match(html, /hljs/);
    assert.match(html, /href="\/notes\/n1">新标题<\/a>/);
    assert.match(html, /class="wiki-link-missing" title="笔记不存在">不存在/);
    assert.doesNotMatch(html, /<script|onclick=|javascript:/);
    assert.doesNotMatch(html, /href="\/notes\/.*跳过/);
  } finally { await vite.close(); }
});
