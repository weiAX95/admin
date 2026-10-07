import { defaultSchema } from "rehype-sanitize";

export const markdownSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), "img", "table", "thead", "tbody", "tr", "th", "td", "del", "details", "summary"],
  attributes: { ...defaultSchema.attributes, a: [...(defaultSchema.attributes?.a || []), "title"], img: ["src", "alt", "title", "width", "height"] },
};
