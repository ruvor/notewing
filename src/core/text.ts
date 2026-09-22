// Pure text helpers for Markdown sources (no DOM needed).

/** GitHub-style heading anchors. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** YAML front matter is shown as a code block instead of a stray heading. */
export function stripFrontMatter(src: string): string {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return m ? "```yaml\n" + m[1] + "\n```\n" + src.slice(m[0].length) : src;
}

/** Toggles the n-th task list checkbox in the Markdown source. */
export function toggleTask(src: string, index: number): string {
  const lines = src.split("\n");
  let fence: string | null = null;
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^\s*(```|~~~)/);
    if (f) {
      fence = fence === null ? f[1] : fence === f[1] ? null : fence;
      continue;
    }
    if (fence) continue;
    const m = lines[i].match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/);
    if (m && n++ === index) {
      lines[i] = m[1] + (m[2] === " " ? "x" : " ") + m[3];
      return lines.join("\n");
    }
  }
  return src;
}

/** Plain text for card previews and search snippets. */
export function plainText(src: string): string {
  return stripFrontMatter(src)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s*/gm, "")
    .replace(/^[#>\s-*+]+|[*_`~]/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
