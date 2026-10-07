import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { visit } from "unist-util-visit";
import type { Root, RootContent, Text } from "mdast";
import type { Note } from "../types";
import { getAssetBlob } from "../api/assets";
import { markdownSchema } from "../utils/markdownSchema";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

const wikiPattern = /\[\[([^\]|\n]+?)(?:\|id:([^\]\n]+))?\]\]/g;
function wikiLinks(notes: Pick<Note, "id" | "title">[], source: string) {
  const byId = new Map(notes.map(note => [note.id, note]));
  return () => (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (index === undefined || !parent || parent.type === "link") return;
      const text = node.value;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const raw = source.slice(start, end);
      const parts: RootContent[] = [];
      let last = 0;
      let searchFrom = 0;
      for (const match of raw.matchAll(wikiPattern)) {
        const slashCount = raw.slice(0, match.index).match(/\\+$/)?.[0].length || 0;
        const offset = text.indexOf(match[0], searchFrom);
        if (offset >= 0) searchFrom = offset + match[0].length;
        if (offset < 0 || slashCount % 2) continue;
        if (offset > last) parts.push({ type: "text", value: text.slice(last, offset) });
        const label = match[1].trim();
        const matches = match[2] ? [byId.get(match[2])].filter((v): v is Pick<Note, "id" | "title"> => !!v) : notes.filter(note => note.title === label);
        const target = matches.length === 1 ? matches[0] : null;
        parts.push({ type: "link", url: target ? `/notes/${encodeURIComponent(target.id)}` : "#missing-note", title: target ? undefined : "笔记不存在", children: [{ type: "text", value: target?.title || label }] });
        last = offset + match[0].length;
      }
      if (parts.length) {
        if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
        parent.children.splice(index, 1, ...parts as typeof parent.children);
        return index + parts.length;
      }
    });
  };
}

function displayDoubleDollar(source: string) {
  return () => (tree: Root) => {
    visit(tree, "paragraph", (node, index, parent) => {
      if (index === undefined || !parent || node.children.length !== 1 || node.children[0].type !== "inlineMath") return;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined || !/^\$\$[\s\S]*\$\$$/.test(source.slice(start, end))) return;
      const value = node.children[0].value;
      parent.children[index] = { type: "math", value, data: { hName: "pre", hChildren: [{ type: "element", tagName: "code", properties: { className: ["language-math", "math-display"] }, children: [{ type: "text", value }] }] } };
    });
  };
}

function SecureImage({ src, alt }: { src?: string; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!src) return;
    if (!/^\/api\/assets\/[0-9a-f-]{36}$/.test(src)) {
      if (/^https:\/\//i.test(src)) setUrl(src);
      return;
    }
    let active = true;
    let objectUrl = "";
    getAssetBlob(src).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  if (failed) return <span className="markdown-image-error">图片加载失败</span>;
  return url ? <img src={url} alt={alt || "图片"} loading="lazy" /> : <span className="markdown-image-loading">图片加载中…</span>;
}

export default function MarkdownContent({ content, notes = [], enableWikiLinks = false }: { content: string; notes?: Pick<Note, "id" | "title">[]; enableWikiLinks?: boolean }) {
  const plugins = useMemo(() => enableWikiLinks ? [remarkGfm, remarkBreaks, remarkMath, displayDoubleDollar(content), wikiLinks(notes, content)] : [remarkGfm, remarkBreaks, remarkMath, displayDoubleDollar(content)], [notes, content, enableWikiLinks]);
  return <div className="markdown-content"><ReactMarkdown remarkPlugins={plugins} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema], rehypeKatex, rehypeHighlight]} components={{
    a: ({ href, children }) => href === "#missing-note" ? <span className="wiki-link-missing" title="笔记不存在">{children}</span> : href?.startsWith("https://") ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <a href={href}>{children}</a>,
    img: ({ src, alt }) => <SecureImage src={src} alt={alt} />,
  }}>{content || "暂无内容"}</ReactMarkdown></div>;
}
