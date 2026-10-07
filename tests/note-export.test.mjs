import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";

test("ZIP stores one Markdown file per note with safe unique names", async () => {
  const { notesZip, noteFilename } = await import("../src/utils/noteExport.ts");
  const notes = [
    { id: "one", title: "React/入门", content: "代码块\n```js\nconst x = 1\n```" },
    { id: "two", title: "React/入门", content: "第二篇" },
  ];
  const blob = await notesZip(notes);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.equal(Object.keys(zip.files).length, 2);
  assert.match(await zip.file(noteFilename(notes[0])).async("string"), /const x = 1/);
  assert.equal(zip.file(noteFilename(notes[1])) !== null, true);
});

test("HTML export keeps Markdown and code formatting while sanitizing input", async () => {
  const { noteHtml } = await import("../src/utils/noteExport.ts");
  const html = await noteHtml({ title: '<img src=x onerror=alert(1)>', content: '**重点**\n\n```js\nconst answer = 42\n```\n<script>alert(1)</script>' });
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /hljs/);
  assert.doesNotMatch(html, /<script>|<img[^>]+onerror=/);
  assert.match(html, /&lt;img/);
});

test("HTML export embeds authenticated local images as portable data URLs", async () => {
  const { noteHtml } = await import("../src/utils/noteExport.ts");
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const asset = "/api/assets/00000000-0000-0000-0000-000000000001";
  globalThis.localStorage = { getItem: () => "token" };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, asset);
    assert.equal(options.headers.Authorization, "Bearer token");
    return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), { status: 200 });
  };
  try {
    const html = await noteHtml({ title: "图片", content: `![截图](${asset})` });
    assert.match(html, /src="data:image\/png;base64,AQID"/);
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});

test("PDF export embeds Chinese and wraps long highlighted code across pages", async () => {
  const { makeNotePdf } = await import("../src/utils/notePdf.ts");
  const font = readFileSync(new URL("../public/fonts/NotoSansCJKsc-Regular.otf", import.meta.url));
  const code = Array.from({ length: 90 }, (_, index) => `const value${index} = "这是一行很长的中文代码内容和英文代码内容 ${index}";`).join("\n");
  const blob = await makeNotePdf({ title: "中文学习笔记", content: `## 代码示例\n\n\`\`\`js\n${code}\n\`\`\`\n\n结论：完成。` }, font);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type, "application/pdf");
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), "%PDF");
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2);
});
