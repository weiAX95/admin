import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { RootContent } from "mdast";
import type { Note } from "../types";

type PdfNote = Pick<Note, "title" | "content">;
type Color = "normal" | "keyword" | "string" | "number" | "comment";
type Run = { text: string; color: Color };
const PAGE: [number, number] = [595, 842];
const MARGIN = 44;
const CONTENT = PAGE[0] - MARGIN * 2;
const safe = (text: string) => text.replace(/[\u{1F300}-\u{1FAFF}]/gu, "□");

function plain(node: RootContent | { type: string; value?: string; children?: unknown[]; url?: string }): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if (node.type === "image") return `[图片：${"alt" in node ? String(node.alt || "") : ""}]`;
  if ("children" in node && Array.isArray(node.children)) return node.children.map(child => plain(child as RootContent)).join("");
  return "";
}

function decode(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|#39|#x27|#(\d+));/g, entity => {
    const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'" };
    return named[entity] || (entity.startsWith("&#") ? String.fromCodePoint(Number(entity.slice(2, -1))) : entity);
  });
}

function highlightedRuns(html: string): Run[] {
  const runs: Run[] = [];
  const stack: Color[] = ["normal"];
  for (const token of html.match(/<\/span>|<span[^>]*>|[^<]+/g) || []) {
    if (token === "</span>") stack.pop();
    else if (token.startsWith("<span")) {
      const cls = token.match(/hljs-([\w-]+)/)?.[1] || "";
      stack.push(cls === "keyword" || cls === "title" || cls === "built_in" ? "keyword" : cls === "string" ? "string" : cls === "number" || cls === "literal" ? "number" : cls === "comment" ? "comment" : stack.at(-1) || "normal");
    } else runs.push({ text: decode(token), color: stack.at(-1) || "normal" });
  }
  return runs;
}

export async function makeNotePdf(note: PdfNote, fontBytes?: ArrayBuffer | Uint8Array): Promise<Blob> {
  const [{ PDFDocument, rgb }, { default: fontkit }, { default: hljs }] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit"), import("highlight.js/lib/common")]);
  const bytes: ArrayBuffer | Uint8Array = fontBytes ?? await fetch("/fonts/NotoSansCJKsc-Regular.otf").then(response => { if (!response.ok) throw new Error("中文字体加载失败"); return response.arrayBuffer(); });
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(bytes);
  pdf.setTitle(note.title);
  const colors = { normal: rgb(.15, .17, .23), keyword: rgb(.43, .28, .74), string: rgb(.08, .47, .29), number: rgb(.65, .37, .12), comment: rgb(.45, .48, .55) };
  const muted = rgb(.43, .46, .54);
  let page = pdf.addPage(PAGE); let y = PAGE[1] - MARGIN;
  const nextPage = () => { page = pdf.addPage(PAGE); y = PAGE[1] - MARGIN; };
  const ensure = (height: number) => { if (y - height < MARGIN) nextPage(); };
  const widthCache = new Map<string, number>();
  const charWidth = (char: string, size: number) => {
    const key = `${size}:${char}`;
    if (!widthCache.has(key)) widthCache.set(key, font.widthOfTextAtSize(char, size));
    return widthCache.get(key) || 0;
  };
  const wrap = (text: string, size: number, maxWidth: number) => {
    const lines: string[] = []; let line = ""; let width = 0;
    for (const char of safe(text)) {
      if (char === "\n") { lines.push(line); line = ""; width = 0; continue; }
      const charW = charWidth(char, size);
      if (line && width + charW > maxWidth) { lines.push(line); line = ""; width = 0; }
      line += char; width += charW;
    }
    lines.push(line);
    return lines;
  };
  const drawText = (text: string, size = 10, gap = 16, indent = 0, color = colors.normal) => {
    const lines = wrap(text, size, CONTENT - indent);
    for (const line of lines) { ensure(gap); page.drawText(line || " ", { x: MARGIN + indent, y: y - size, font, size, color }); y -= gap; }
    y -= 7;
  };
  drawText(note.title, 21, 28, 0, colors.keyword); y -= 5;
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(note.content || "");
  for (const node of tree.children) {
    if (node.type === "paragraph" && node.children.length === 1 && node.children[0].type === "image") {
      const source = node.children[0].url;
      try {
        if (!source.startsWith("/api/assets/") && !source.startsWith("https://")) throw new Error("图片地址不受支持");
        const blob = source.startsWith("/api/assets/") ? await import("../api/assets.ts").then(module => module.getAssetBlob(source)) : await fetch(source).then(response => { if (!response.ok) throw new Error("图片加载失败"); return response.blob(); });
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext("2d"); if (!context) throw new Error("无法绘制图片");
        context.drawImage(bitmap, 0, 0); bitmap.close();
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("图片转换失败")), "image/png"));
        const image = await pdf.embedPng(await png.arrayBuffer());
        const scale = Math.min(1, CONTENT / image.width, 680 / image.height);
        const height = image.height * scale; ensure(height + 16);
        page.drawImage(image, { x: MARGIN, y: y - height, width: image.width * scale, height }); y -= height + 16;
      } catch { drawText(`[图片无法导出：${node.children[0].alt || source}]`, 9, 15, 0, muted); }
      continue;
    }
    if (node.type === "code") {
      const language = node.lang && hljs.getLanguage(node.lang) ? node.lang : null;
      const html = language ? hljs.highlight(node.value, { language }).value : hljs.highlightAuto(node.value).value;
      const runs = highlightedRuns(html);
      const codeLines: Run[][] = [[]]; let lineWidth = 0;
      for (const run of runs) for (const char of safe(run.text)) {
        if (char === "\n") { codeLines.push([]); lineWidth = 0; continue; }
        const charW = charWidth(char, 8.5);
        if (lineWidth + charW > CONTENT - 24) { codeLines.push([]); lineWidth = 0; }
        const current = codeLines.at(-1)!;
        if (current.at(-1)?.color === run.color) current[current.length - 1].text += char;
        else current.push({ text: char, color: run.color });
        lineWidth += charW;
      }
      let offset = 0;
      while (offset < codeLines.length) {
        const available = Math.floor((y - MARGIN - 22) / 12);
        if (available < 1 || (offset === 0 && codeLines.length <= 50 && codeLines.length > available)) { nextPage(); continue; }
        const count = Math.min(available, codeLines.length - offset);
        const height = count * 12 + 18;
        page.drawRectangle({ x: MARGIN, y: y - height, width: CONTENT, height, color: rgb(.94, .95, .97) });
        for (let index = 0; index < count; index++) {
          let x = MARGIN + 12;
          for (const part of codeLines[offset + index]) { page.drawText(part.text, { x, y: y - 16 - index * 12, font, size: 8.5, color: colors[part.color] }); x += font.widthOfTextAtSize(part.text, 8.5); }
        }
        y -= height + 10; offset += count;
        if (offset < codeLines.length) nextPage();
      }
      continue;
    }
    if (node.type === "heading") { y -= 6; drawText(plain(node), node.depth === 1 ? 18 : node.depth === 2 ? 15 : 12, node.depth === 1 ? 24 : 20, 0, colors.keyword); }
    else if (node.type === "paragraph") drawText(plain(node));
    else if (node.type === "blockquote") drawText(`│ ${plain(node)}`, 10, 16, 10, muted);
    else if (node.type === "list") for (const [index, item] of node.children.entries()) drawText(`${node.ordered ? `${(node.start || 1) + index}.` : "•"} ${plain(item)}`, 10, 16, 12);
    else if (node.type === "table") for (const row of node.children) drawText(row.children.map(cell => plain(cell)).join("   |   "), 9, 15);
    else if (node.type === "math") drawText(`公式：${node.value}`, 10, 16, 10);
    else if (node.type === "thematicBreak") { ensure(14); page.drawLine({ start: { x: MARGIN, y: y - 4 }, end: { x: PAGE[0] - MARGIN, y: y - 4 }, color: muted, thickness: .5 }); y -= 14; }
    else drawText(plain(node));
  }
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => sheet.drawText(`${index + 1} / ${pages.length}`, { x: PAGE[0] - MARGIN - 35, y: 22, font, size: 8, color: muted }));
  return new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
}
