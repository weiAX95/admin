import { randomUUID } from "node:crypto";

export const noteTagKey = name => name.trim().replace(/[A-Z]/g, letter => letter.toLowerCase());

export function validateNoteTagName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 32) throw new Error("标签不能为空且不能超过 32 字符");
  return name;
}

export function canonicalNoteTags(catalog, values, at = new Date().toISOString()) {
  if (!Array.isArray(values)) throw new Error("tags 必须是字符串数组");
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const name = validateNoteTagName(value);
    const normalizedKey = noteTagKey(name);
    if (seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    let definition = catalog.find(item => item.normalizedKey === normalizedKey);
    if (!definition) {
      definition = { id: randomUUID(), name, normalizedKey, createdAt: at, updatedAt: at };
      catalog.push(definition);
    }
    result.push(definition.name);
  }
  return result;
}

export function noteTagUsage(notes, name) {
  return notes.filter(note => (note.tags || []).includes(name)).length;
}
