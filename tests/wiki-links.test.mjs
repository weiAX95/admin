import test from "node:test";
import assert from "node:assert/strict";
import { extractWikiLinks, normalizeWikiLinks } from "../mock/wiki-links.mjs";

const notes = [{ id: "n1", title: "React" }, { id: "n2", title: "同名" }, { id: "n3", title: "同名" }];

test("wiki links normalize unique titles and preserve stable ids across rename", () => {
  const content = normalizeWikiLinks("查看 [[React]] 和 [[同名]]。", notes);
  assert.equal(content, "查看 [[React|id:n1]] 和 [[同名]]。");
  assert.deepEqual(extractWikiLinks(content, notes).map(item => [item.targetId, item.reason]), [["n1", null], [null, "ambiguous"]]);
  assert.equal(extractWikiLinks(content, [{ id: "n1", title: "React 新名" }])[0].targetId, "n1");
  assert.equal(extractWikiLinks(content, [])[0].reason, "missing");
});

test("wiki links ignore fenced code, inline code and escaped syntax", () => {
  const content = "[[React]] `[[React]]`\n\n```md\n[[React]]\n```\n\n\\[[React]]";
  assert.equal(extractWikiLinks(content, notes).length, 1);
  const mixed = "\\[[React]] and [[React]]";
  assert.equal(normalizeWikiLinks(mixed, notes), "\\[[React]] and [[React|id:n1]]");
});
