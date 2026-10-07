import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import type { Note } from "../types";
import { markdownSchema } from "./markdownSchema.ts";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
export const noteFilename = (note: Pick<Note, "id" | "title">) => `${Array.from(note.title).map(char => char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? "-" : char).join("").trim().slice(0, 70) || "未命名笔记"}-${encodeURIComponent(note.id)}.md`;
export const noteMarkdown = (note: Pick<Note, "title" | "content">) => `# ${note.title.replace(/\r?\n/g, " ")}\n\n${note.content || ""}\n`;

export async function noteHtml(note: Pick<Note, "title" | "content">) {
  let rendered = String(unified().use(remarkParse).use(remarkGfm).use(remarkBreaks).use(remarkMath).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, markdownSchema).use(rehypeKatex).use(rehypeHighlight).use(rehypeStringify).processSync(note.content || ""));
  const assets = [...new Set([...rendered.matchAll(/src="(\/api\/assets\/[0-9a-f-]{36})"/g)].map(match => match[1]))];
  for (const asset of assets) {
    const token = typeof localStorage === "undefined" ? "" : localStorage.getItem("admin_token") || "";
    const response = await fetch(asset, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("图片加载失败，无法完整导出 HTML");
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    rendered = rendered.replaceAll(`src="${asset}"`, `src="data:${blob.type};base64,${btoa(binary)}"`);
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src data:"><title>${escapeHtml(note.title)}</title><style>body{max-width:820px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui,sans-serif;color:#202333}h1,h2,h3{line-height:1.3}pre{overflow:auto;padding:16px;border-radius:8px;background:#181d2c;color:#e8eaf4}code{font-family:ui-monospace,monospace}blockquote{border-left:4px solid #9582ff;padding-left:16px;color:#555}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd0da;padding:8px}img{max-width:100%}.hljs-keyword,.hljs-title{color:#b9a6ff}.hljs-string{color:#9fe0bd}.hljs-number,.hljs-literal{color:#f2c787}.hljs-comment{color:#8f9ab1}.katex-html{display:none}.katex-mathml{display:inline}.katex-display{display:block;text-align:center;margin:1em 0}</style></head><body><h1>${escapeHtml(note.title)}</h1>${rendered}</body></html>`;
}

export async function notesZip(notes: Note[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const note of notes) zip.file(noteFilename(note), noteMarkdown(note));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
