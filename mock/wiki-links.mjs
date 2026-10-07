import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

const token = /\[\[([^\[\]\n]+)\]\]/g;
const parser = unified().use(remarkParse).use(remarkGfm);

function tokensInText(content) {
  const found = [];
  const tree = parser.parse(content);
  visit(tree, "text", (node, _index, parent) => {
    if (["link", "linkReference", "image", "imageReference"].includes(parent?.type)) return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const raw = content.slice(start, end);
    for (const match of raw.matchAll(token)) {
      const trailingSlashes = raw.slice(0, match.index).match(/\\+$/)?.[0].length || 0;
      if (trailingSlashes % 2) continue;
      found.push({ raw: match[0], inner: match[1], start: start + match.index });
    }
  });
  return found.sort((a, b) => a.start - b.start);
}

function resolve(inner, notes) {
  const stable = inner.match(/^(.*)\|id:([^|]+)$/);
  const label = (stable ? stable[1] : inner).trim();
  if (!label) return { label, targetId: null, targetRef: inner, reason: "missing" };
  if (stable) {
    const target = notes.find(note => note.id === stable[2]);
    return { label, targetId: target?.id || null, targetRef: stable[2], reason: target ? null : "missing" };
  }
  const matches = notes.filter(note => note.title === label);
  return { label, targetId: matches.length === 1 ? matches[0].id : null, targetRef: label, reason: matches.length > 1 ? "ambiguous" : matches.length ? null : "missing" };
}

export function normalizeWikiLinks(content, notes) {
  let normalized = content;
  for (const item of tokensInText(content).reverse()) {
    if (item.inner.includes("|id:")) continue;
    const resolved = resolve(item.inner, notes);
    if (resolved.targetId) normalized = `${normalized.slice(0, item.start)}[[${resolved.label}|id:${resolved.targetId}]]${normalized.slice(item.start + item.raw.length)}`;
  }
  return normalized;
}

export function extractWikiLinks(content, notes) {
  return tokensInText(content).map((item, order) => ({ ...resolve(item.inner, notes), order }));
}
