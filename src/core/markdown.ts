// Markdown -> sanitised HTML. Notes come from a repository and may contain anything, and the
// page holds a GitHub token, so every rendered note goes through DOMPurify.

import DOMPurify from "dompurify";
import { Marked } from "marked";
import { slug, stripFrontMatter } from "./text";

export { plainText, toggleTask } from "./text";

const md = new Marked({ gfm: true, breaks: false });

md.use({
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
    // Task list checkboxes are numbered in the sanitiser hook so a click can toggle the source.
    checkbox({ checked }) {
      return `<input type="checkbox" class="task"${checked ? " checked" : ""}> `;
    },
  },
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") || "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  }
  if (node.tagName === "INPUT") {
    if (node.getAttribute("type") !== "checkbox" || !node.classList.contains("task")) node.remove();
    else node.setAttribute("data-task", String(tasks++));
  }
});

let tasks = 0;

export function renderMarkdown(src: string): string {
  const html = md.parse(stripFrontMatter(src), { async: false }) as string;
  tasks = 0;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "button", "textarea", "select"],
    ADD_ATTR: ["target"],
  });
}
