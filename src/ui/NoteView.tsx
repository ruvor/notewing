// A single note: title, toolbar, editor and/or preview.

import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { createNote, deleteNote, moveNote, moveNoteTo } from "../actions";
import { toggleTask } from "../core/markdown";
import { basename, cleanName, dirname, join, NOTE_EXT, relativeLink, titleOf, uniquePath } from "../core/paths";
import { lang, mod, t } from "../i18n";
import { folderHref, go } from "../router";
import { setSetting, settings } from "../settings";
import { changed, errorText, githubUrl, rev, session, toast } from "../state";
import { Editor, insertBlock, insertLink, linePrefix, wrap, type EditorApi } from "./Editor";
import { showHistory } from "./History";
import {
  IconBold,
  IconChecklist,
  IconCode,
  IconColumns,
  IconEdit,
  IconExternal,
  IconEye,
  IconHeading,
  IconHistory,
  IconImage,
  IconItalic,
  IconLink,
  IconList,
  IconMaximize,
  IconMinimize,
  IconMore,
  IconMove,
  IconQuote,
  IconTable,
  IconTrash,
} from "./icons";
import { showMenu } from "./Menu";
import { Preview } from "./Preview";

/** Focus mode: hides the sidebar and the top bar. */
export const zen = signal(false);

const MAX_IMAGE = 20 * 1024 * 1024;
const EXT_OF_TYPE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/avif": "avif" };

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");

export function NoteView({ path, draftDir }: { path: string | null; draftDir: string }) {
  const s = session.value!;
  const repo = s.repo;
  const [text, setTextState] = useState<string | null>(path ? (repo.cachedText(path) ?? null) : "");
  const [revision, setRevision] = useState(0);
  /** Sets the text from outside the editor (load, remote change, preview, history). */
  const setText = (v: string | null) => {
    setTextState(v);
    setRevision((r) => r + 1);
  };
  const [error, setError] = useState("");
  const [title, setTitle] = useState(path ? titleOf(path) : "");
  const [wide, setWide] = useState(matchMedia("(min-width: 900px)").matches);
  const api = useRef<EditorApi | null>(null);
  const writeTimer = useRef(0);
  const pendingText = useRef<string | null>(null);
  const pathRef = useRef(path);
  const creating = useRef<Promise<string> | null>(null);
  /** Path of the note a draft just turned into; its editor content is already current. */
  const justCreated = useRef<string | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  rev.value; // re-render on repository changes

  // Load the note when the path changes; save what was typed when leaving it.
  useEffect(() => {
    pathRef.current = path;
    setTitle(path ? titleOf(path) : "");
    setError("");
    if (!path) {
      creating.current = null;
      pendingText.current = null;
      setText("");
      setTimeout(() => titleInput.current?.focus());
      return () => {
        // Left a draft within the save delay: keep the text as a new note.
        clearTimeout(writeTimer.current);
        const v = pendingText.current;
        if (v?.trim() && !creating.current) createNote(draftDir, titleInput.current?.value || "", v);
      };
    }
    // After a draft became this note the editor already has the text; keep saving it.
    if (justCreated.current === path) {
      justCreated.current = null;
      if (pendingText.current !== null) writeTimer.current = setTimeout(flush, 300) as unknown as number;
    } else {
      const cached = repo.cachedText(path);
      setText(cached ?? null);
      if (cached === undefined && repo.has(path)) {
        repo.text(path).then(
          (v) => pathRef.current === path && setText(v),
          (e) => pathRef.current === path && setError(errorText(e)),
        );
      }
    }
    return () => {
      clearTimeout(writeTimer.current);
      const v = pendingText.current;
      pendingText.current = null;
      if (v !== null) repo.write(path, v).then(changed);
    };
  }, [path, draftDir]);

  // Pick up remote changes when there is nothing local in flight.
  useEffect(() => {
    if (!path || pendingText.current !== null || repo.isDirty(path)) return;
    const now = repo.cachedText(path);
    if (now !== undefined && now !== text) setText(now);
  }, [rev.value]);

  useEffect(() => {
    const mq = matchMedia("(min-width: 900px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Write the latest text to the local queue.
  const flush = async () => {
    clearTimeout(writeTimer.current);
    const v = pendingText.current;
    if (v === null) return;
    const p = pathRef.current || (await ensureCreated(v));
    if (pendingText.current === v) pendingText.current = null;
    await repo.write(p, v);
    changed();
  };

  const ensureCreated = (initial: string): Promise<string> => {
    creating.current ||= createNote(draftDir, titleInput.current?.value || "", initial).then((p) => {
      pathRef.current = p;
      justCreated.current = p;
      go({ name: "note", path: p }, true);
      return p;
    });
    return creating.current;
  };

  /** From the editor as the user types. */
  const onEdit = (v: string) => {
    setTextState(v);
    pendingText.current = v;
    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(flush, 300) as unknown as number;
  };

  /** Programmatic change that must also reach the editor. */
  const onChange = (v: string) => {
    setText(v);
    pendingText.current = v;
    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(flush, 300) as unknown as number;
  };

  const commitTitle = async () => {
    const name = cleanName(title);
    if (!path) {
      if (name) {
        pendingText.current = null;
        await ensureCreated(text || "");
      }
      return;
    }
    if (!name) return setTitle(titleOf(path));
    if (name === titleOf(path)) return;
    const ext = basename(path).match(NOTE_EXT)?.[0] || ".md";
    await flush();
    await moveNoteTo(path, join(dirname(path), name + ext));
    if (repo.has(path)) setTitle(titleOf(path)); // rename failed
  };

  const onFiles = async (files: File[]): Promise<string> => {
    const notePath = pathRef.current || join(draftDir, "x.md");
    const out: string[] = [];
    for (const f of files) {
      if (f.size > MAX_IMAGE) {
        toast(t("errImageTooBig", f.name), { kind: "error" });
        continue;
      }
      const ext = EXT_OF_TYPE[f.type] || f.name.split(".").pop() || "png";
      const name = cleanName(f.name.replace(/\.[^.]+$/, "")).replace(/\s+/g, "-") || "image";
      const target = uniquePath(join(settings.value.assetsDir, `${stamp()}-${name}.${ext}`), (p) => repo.has(p));
      await repo.writeBinary(target, new Uint8Array(await f.arrayBuffer()));
      out.push(`![${name}](${relativeLink(notePath, target)})`);
    }
    if (out.length) changed();
    return out.join("\n");
  };

  const pickImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = async () => {
      const md = await onFiles([...(input.files || [])]);
      const v = api.current?.view;
      if (md && v) {
        const pos = v.state.selection.main.head;
        v.dispatch({ changes: { from: pos, insert: md }, selection: { anchor: pos + md.length } });
      }
    };
    input.click();
  };

  const history = async () => {
    if (!path) return;
    await flush();
    const old = await showHistory(path);
    if (old !== null) {
      onChange(old);
      toast(t("versionRestored"));
    }
  };

  let mode = settings.value.mode;
  if (mode === "split" && !wide) mode = "edit";
  const setMode = (m: typeof mode) => setSetting("mode", m);
  const v = () => api.current?.view;

  const more = (e: MouseEvent) =>
    showMenu(e, [
      ...(path
        ? [
            { label: t("moveToEllipsis"), icon: <IconMove size={16} />, onSelect: () => flush().then(() => moveNote(path)) },
            ...(!s.demo && !repo.pending[path] ? [{ label: t("openOnGitHub"), icon: <IconExternal size={16} />, onSelect: () => open(githubUrl(path), "_blank", "noopener") }] : []),
          ]
        : []),
      { label: zen.value ? t("exitFocus") : t("focusMode"), icon: zen.value ? <IconMinimize size={16} /> : <IconMaximize size={16} />, hint: `${mod}+Shift+F`, onSelect: () => (zen.value = !zen.value) },
      ...(path ? ["-" as const, { label: t("delete"), icon: <IconTrash size={16} />, danger: true, onSelect: () => deleteNote(path) }] : []),
    ]);

  const dir = path ? dirname(path) : draftDir;
  const missing = path && !repo.has(path) && pendingText.current === null && !creating.current;

  if (missing) {
    return (
      <div class="empty-state">
        <h2>{t("noteNotFound")}</h2>
        <p class="muted">{path}</p>
        <a class="btn" href={folderHref(dirname(path))}>
          {t("backToFolder")}
        </a>
      </div>
    );
  }

  return (
    <article class={`note-page mode-${mode}`}>
      <header class="note-head">
        <nav class="crumbs" aria-label={t("path")}>
          <a href={folderHref("")}>{s.repo.ref.repo}</a>
          {dir &&
            dir.split("/").map((part, i, all) => (
              <>
                <span class="sep">/</span>
                <a href={folderHref(all.slice(0, i + 1).join("/"))}>{part}</a>
              </>
            ))}
          {path && repo.isDirty(path) && <span class="chip" title={t("notSyncedHint")}>{t("notSynced")}</span>}
        </nav>
        <div class="note-title-row">
          <input
            ref={titleInput}
            class="note-title"
            value={title}
            placeholder={t("untitled")}
            aria-label={t("noteTitle")}
            onInput={(e) => setTitle(e.currentTarget.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTitle();
                v()?.focus();
              } else if (e.key === "Escape" && path) setTitle(titleOf(path));
            }}
          />
          <div class="note-actions">
            <div class="segmented" role="group" aria-label={t("viewMode")}>
              <button class={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")} title={`${t("modeEdit")} (${mod}+E)`} aria-pressed={mode === "edit"}>
                <IconEdit size={16} />
              </button>
              {wide && (
                <button class={mode === "split" ? "on" : ""} onClick={() => setMode("split")} title={t("modeSplit")} aria-pressed={mode === "split"}>
                  <IconColumns size={16} />
                </button>
              )}
              <button class={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")} title={`${t("modePreview")} (${mod}+E)`} aria-pressed={mode === "preview"}>
                <IconEye size={16} />
              </button>
            </div>
            {path && (
              <button class="icon-btn" onClick={history} title={t("history")} aria-label={t("history")}>
                <IconHistory />
              </button>
            )}
            <button class="icon-btn" onClick={more} title={t("more")} aria-label={t("more")}>
              <IconMore />
            </button>
          </div>
        </div>
        {mode !== "preview" && (
          <div class="toolbar" role="toolbar" aria-label={t("formatting")}>
            <button onClick={() => v() && wrap(v()!, "**")} title={`${t("fmtBold")} (${mod}+B)`}>
              <IconBold size={16} />
            </button>
            <button onClick={() => v() && wrap(v()!, "*")} title={`${t("fmtItalic")} (${mod}+I)`}>
              <IconItalic size={16} />
            </button>
            <button onClick={() => v() && linePrefix(v()!, "## ")} title={t("fmtHeading")}>
              <IconHeading size={16} />
            </button>
            <span class="tb-sep" />
            <button onClick={() => v() && linePrefix(v()!, "- ")} title={`${t("fmtList")} (${mod}+Shift+8)`}>
              <IconList size={16} />
            </button>
            <button onClick={() => v() && linePrefix(v()!, "- [ ] ")} title={`${t("fmtTasks")} (${mod}+Shift+9)`}>
              <IconChecklist size={16} />
            </button>
            <button onClick={() => v() && linePrefix(v()!, "> ")} title={t("fmtQuote")}>
              <IconQuote size={16} />
            </button>
            <span class="tb-sep" />
            <button onClick={() => v() && wrap(v()!, "`")} title={`${t("fmtCode")} (${mod}+\`)`}>
              <IconCode size={16} />
            </button>
            <button onClick={() => v() && insertLink(v()!)} title={t("fmtLink")}>
              <IconLink size={16} />
            </button>
            <button onClick={pickImage} title={t("fmtImage")}>
              <IconImage size={16} />
            </button>
            <button
              onClick={() => v() && insertBlock(v()!, `| ${t("column")} 1 | ${t("column")} 2 |\n|---|---|\n|  |  |`, [2, 2 + t("column").length + 2])}
              title={t("fmtTable")}
            >
              <IconTable size={16} />
            </button>
          </div>
        )}
      </header>

      {error && (
        <div class="banner error" role="alert">
          {error}
        </div>
      )}
      {text === null && !error ? (
        <div class="loading-note">{t("loading")}</div>
      ) : (
        text !== null && (
          <div class="note-body">
            {mode !== "preview" && (
              <div class="pane edit-pane">
                <Editor
                  value={text}
                  revision={revision}
                  onChange={onEdit}
                  onFiles={onFiles}
                  placeholder={t("startWriting")}
                  spellcheck={settings.value.spellcheck}
                  lang={lang.value}
                  api={(a) => (api.current = a)}
                  autofocus={!!path && !text}
                />
              </div>
            )}
            {mode !== "edit" && (
              <div class="pane preview-pane">
                {text.trim() ? (
                  <Preview source={text} path={path || join(draftDir, "x.md")} onToggleTask={(i) => onChange(toggleTask(text, i))} class="doc" />
                ) : (
                  <p class="muted pad">{t("emptyNote")}</p>
                )}
              </div>
            )}
          </div>
        )
      )}
    </article>
  );
}
