// Full-text search over the notes cached in the browser.

import { titleOf } from "./paths";

export interface Hit {
  path: string;
  score: number;
  snippet?: { before: string; match: string; after: string };
}

const norm = (s: string) => s.toLocaleLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ё/g, "е");

export function search(query: string, paths: string[], text: (p: string) => string | undefined, limit = 50): Hit[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: Hit[] = [];
  for (const path of paths) {
    const title = norm(titleOf(path));
    const where = norm(path);
    const body = text(path);
    const normBody = body === undefined ? "" : norm(body);
    let score = 0;
    let ok = true;
    for (const t of terms) {
      if (title.startsWith(t)) score += 12;
      else if (title.includes(t)) score += 8;
      else if (where.includes(t)) score += 4;
      else if (normBody.includes(t)) score += 1 + Math.min(3, normBody.split(t).length - 2);
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const hit: Hit = { path, score };
    if (body !== undefined) {
      // NFKD may change lengths; this is an approximation that is right for common text.
      const i = normBody.indexOf(terms[0]);
      if (i >= 0 && normBody.length === body.length) {
        const start = Math.max(0, i - 40);
        hit.snippet = {
          before: (start > 0 ? "…" : "") + body.slice(start, i).replace(/\s+/g, " "),
          match: body.slice(i, i + terms[0].length),
          after: body.slice(i + terms[0].length, i + terms[0].length + 80).replace(/\s+/g, " "),
        };
      }
    }
    hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}
