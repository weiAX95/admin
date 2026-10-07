import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";

export function markdownSummary(content: string, limit = 180): string {
  if (!content) return "";
  const tree = unified().use(remarkParse).parse(content);
  const parts: string[] = [];
  visit(tree, node => {
    if (node.type === "text" || node.type === "inlineCode" || node.type === "code") parts.push(node.value);
  });
  const plain = parts.join(" ").replace(/\s+/g, " ").trim();
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}
