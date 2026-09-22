// Rendered Markdown. Relative images are loaded from the repository (they may be private),
// relative links to notes open inside the app.

import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { renderMarkdown } from "../core/markdown";
import { IMAGE_EXT, isNote, resolveLink } from "../core/paths";
import { noteHref } from "../router";
import { githubUrl, session } from "../state";

const urls = new Map<string, string>(); // "path@sha" -> object URL

const MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
};

/** Syntax colours for fenced code blocks, with the same parsers the editor uses. */
async function highlight(code: HTMLElement) {
  const name = [...code.classList].find((c) => c.startsWith("language-"))?.slice(9);
  const desc = name && LanguageDescription.matchLanguageName(languages, name, true);
  if (!desc) return;
  const support = desc.support || (await desc.load());
  const text = code.textContent || "";
  const tree = support.language.parser.parse(text);
  const out = document.createDocumentFragment();
  highlightCode(
    text,
    tree,
    classHighlighter,
    (t, classes) => {
      if (!classes) return out.append(t);
      const span = document.createElement("span");
      span.className = classes;
      span.textContent = t;
      out.append(span);
    },
    () => out.append("\n"),
  );
  if (code.textContent === text) code.replaceChildren(out);
}

async function imageUrl(path: string): Promise<string | null> {
  const repo = session.value?.repo;
  if (!repo || !repo.has(path)) return null;
  const key = `${path}@${repo.pending[path]?.rev ?? repo.snapshot.files[path]}`;
  let url = urls.get(key);
  if (!url) {
    const bytes = await repo.bytes(path);
    const ext = path.split(".").pop()!.toLowerCase();
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[ext] || "application/octet-stream" }));
    urls.set(key, url);
  }
  return url;
}

interface Props {
  source: string;
  path: string;
  onToggleTask?: (index: number) => void;
  class?: string;
}

export function Preview({ source, path, onToggleTask, class: cls }: Props) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = el.current;
    if (!root) return;
    let alive = true;
    for (const code of root.querySelectorAll<HTMLElement>("pre > code[class*='language-']")) highlight(code).catch(() => {});
    for (const img of root.querySelectorAll("img")) {
      const target = resolveLink(path, img.getAttribute("src") || "");
      if (target === null || !IMAGE_EXT.test(target)) continue;
      img.removeAttribute("src");
      img.classList.add("loading");
      imageUrl(target)
        .then((u) => {
          if (!alive) return;
          img.classList.remove("loading");
          if (u) img.src = u;
          else img.classList.add("missing");
        })
        .catch(() => alive && img.classList.replace("loading", "missing"));
    }
    return () => {
      alive = false;
    };
  }, [html, path]);

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.dataset.task !== undefined) {
      e.preventDefault();
      onToggleTask?.(Number(target.dataset.task));
      return;
    }
    const a = target.closest("a");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (href.startsWith("#")) {
      e.preventDefault();
      const id = decodeURIComponent(href.slice(1));
      el.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const linked = resolveLink(path, href);
    if (linked === null) return; // external: opens in a new tab
    e.preventDefault();
    const s = session.value;
    if (isNote(linked)) location.hash = noteHref(linked);
    else if (s && !s.demo && s.repo.has(linked)) window.open(githubUrl(linked), "_blank", "noopener");
  };

  return <div ref={el} class={`markdown ${cls || ""}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
