// Quick search (Ctrl+K): full-text search over cached notes, recent notes, "create note".

import { signal } from "@preact/signals";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createNote, currentFolder } from "../actions";
import { dirname, titleOf } from "../core/paths";
import { search } from "../core/search";
import { t } from "../i18n";
import { go } from "../router";
import { rev, session } from "../state";
import { IconNote, IconPlus, IconSearch } from "./icons";

export const searchOpen = signal(false);

const RECENT = "notewing.recent";
export function recent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) || "[]");
  } catch {
    return [];
  }
}
export function pushRecent(path: string) {
  try {
    localStorage.setItem(RECENT, JSON.stringify([path, ...recent().filter((p) => p !== path)].slice(0, 20)));
  } catch {}
}

export function SearchPalette() {
  if (!searchOpen.value) return null;
  return <Palette />;
}

function Palette() {
  const s = session.value!;
  rev.value;
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const close = () => (searchOpen.value = false);

  useEffect(() => input.current?.focus(), []);

  const notes = s.repo.notes();
  const results = useMemo(() => {
    if (!q.trim()) {
      const all = new Set(notes);
      return recent()
        .filter((p) => all.has(p))
        .slice(0, 8)
        .map((path) => ({ path, score: 0, snippet: undefined }));
    }
    return search(q, notes, (p) => s.repo.cachedText(p), 40);
  }, [q, rev.value]);

  const withCreate = q.trim() && !results.some((r) => titleOf(r.path).toLowerCase() === q.trim().toLowerCase());
  const count = results.length + (withCreate ? 1 : 0);
  const loading = s.repo.prefetching.total > 0;

  const choose = async (i: number) => {
    close();
    if (i < results.length) go({ name: "note", path: results[i].path });
    else {
      const path = await createNote(currentFolder(), q.trim(), "");
      go({ name: "note", path });
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (sel + (e.key === "ArrowDown" ? 1 : -1) + count) % Math.max(count, 1);
      setSel(next);
      list.current?.children[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && count) {
      e.preventDefault();
      choose(sel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <div class="overlay top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="palette" role="dialog" aria-label={t("search")}>
        <div class="palette-input">
          <IconSearch />
          <input
            ref={input}
            value={q}
            placeholder={t("searchPlaceholder")}
            onInput={(e) => {
              setQ(e.currentTarget.value);
              setSel(0);
            }}
            onKeyDown={onKey}
            aria-controls="palette-results"
            aria-activedescendant={`pr-${sel}`}
            role="combobox"
            aria-expanded="true"
          />
          <kbd>Esc</kbd>
        </div>
        <ul class="palette-results" id="palette-results" role="listbox" ref={list}>
          {!q.trim() && results.length > 0 && <li class="palette-label">{t("recent")}</li>}
          {results.map((r, i) => (
            <li key={r.path} id={`pr-${i}`} role="option" aria-selected={i === sel} class={i === sel ? "sel" : ""} onMouseMove={() => setSel(i)} onClick={() => choose(i)}>
              <IconNote size={16} />
              <div class="pr-text">
                <div class="pr-title">
                  {titleOf(r.path)}
                  {dirname(r.path) && <span class="pr-dir">{dirname(r.path)}</span>}
                </div>
                {r.snippet && (
                  <div class="pr-snippet">
                    {r.snippet.before}
                    <mark>{r.snippet.match}</mark>
                    {r.snippet.after}
                  </div>
                )}
              </div>
            </li>
          ))}
          {withCreate && (
            <li
              id={`pr-${results.length}`}
              role="option"
              aria-selected={sel === results.length}
              class={`create ${sel === results.length ? "sel" : ""}`}
              onMouseMove={() => setSel(results.length)}
              onClick={() => choose(results.length)}
            >
              <IconPlus size={16} />
              <div class="pr-text">
                <div class="pr-title">{t("createNamed", q.trim())}</div>
              </div>
            </li>
          )}
          {q.trim() && !results.length && <li class="palette-empty">{t("nothingFound")}</li>}
        </ul>
        {loading && (
          <div class="palette-foot">
            {t("indexing", s.repo.prefetching.done, s.repo.prefetching.total)}
          </div>
        )}
      </div>
    </div>
  );
}
