// Folder and note tree with drag and drop.

import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { deleteFolder, deleteNote, moveFolder, moveFolderTo, moveNote, moveNoteTo, newFolder, newNote, renameFolder, renameNote } from "../actions";
import { basename, dirname, join, titleOf } from "../core/paths";
import { t } from "../i18n";
import { folderHref, noteHref, route } from "../router";
import { rev, session, virtualFolders } from "../state";
import { buildTree, type Folder } from "../tree";
import { IconChevron, IconEdit, IconFolder, IconFolderOpen, IconFolderPlus, IconHeart, IconMore, IconMove, IconNote, IconPlus, IconTrash } from "./icons";
import { showMenu, type MenuEntry } from "./Menu";

const KEY = "notewing.expanded";
const expanded = signal<Set<string>>(new Set(JSON.parse(localStorage.getItem(KEY) || "[]")));
const toggle = (path: string, open?: boolean) => {
  const next = new Set(expanded.value);
  if (open ?? !next.has(path)) next.add(path);
  else next.delete(path);
  expanded.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {}
};

export function expandTo(path: string) {
  const parts = path.split("/");
  const need = parts.map((_, i) => parts.slice(0, i + 1).join("/")).filter((p) => p && !expanded.value.has(p));
  if (need.length) need.forEach((p) => toggle(p, true));
}

const DND = "application/x-notewing";
type Drag = { kind: "note" | "folder"; path: string };

function onDragStart(e: DragEvent, data: Drag) {
  e.dataTransfer!.setData(DND, JSON.stringify(data));
  e.dataTransfer!.setData("text/plain", data.path);
  e.dataTransfer!.effectAllowed = "move";
}

function canDrop(e: DragEvent) {
  return e.dataTransfer?.types.includes(DND);
}

async function drop(e: DragEvent, dir: string) {
  e.preventDefault();
  const raw = e.dataTransfer?.getData(DND);
  if (!raw) return;
  const d: Drag = JSON.parse(raw);
  if (d.kind === "note") {
    if (dirname(d.path) !== dir) await moveNoteTo(d.path, join(dir, basename(d.path)));
  } else if (d.path !== dir && !dir.startsWith(d.path + "/") && dirname(d.path) !== dir) {
    await moveFolderTo(d.path, join(dir, basename(d.path)));
    toggle(dir, true);
  }
}

const noteMenu = (path: string): MenuEntry[] => [
  { label: t("rename"), icon: <IconEdit size={16} />, onSelect: () => renameNote(path) },
  { label: t("moveToEllipsis"), icon: <IconMove size={16} />, onSelect: () => moveNote(path) },
  "-",
  { label: t("delete"), icon: <IconTrash size={16} />, danger: true, onSelect: () => deleteNote(path) },
];

const folderMenu = (path: string): MenuEntry[] => [
  { label: t("newNote"), icon: <IconPlus size={16} />, onSelect: () => newNote(path) },
  { label: t("newFolder"), icon: <IconFolderPlus size={16} />, onSelect: () => newFolder(path) },
  "-",
  { label: t("rename"), icon: <IconEdit size={16} />, onSelect: () => renameFolder(path) },
  { label: t("moveToEllipsis"), icon: <IconMove size={16} />, onSelect: () => moveFolder(path) },
  "-",
  { label: t("delete"), icon: <IconTrash size={16} />, danger: true, onSelect: () => deleteFolder(path) },
];

export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const s = session.value!;
  rev.value;
  const tree = buildTree(s.repo.notes(), virtualFolders.value);
  const r = route.value;
  const active = r.name === "note" ? r.path : r.name === "folder" ? r.path : null;
  const [over, setOver] = useState<string | null>(null);

  const dropProps = (dir: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!canDrop(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(dir);
    },
    onDragLeave: () => setOver((o) => (o === dir ? null : o)),
    onDrop: (e: DragEvent) => {
      e.stopPropagation();
      setOver(null);
      drop(e, dir);
    },
  });

  const renderFolder = (f: Folder, depth: number) => {
    const open = expanded.value.has(f.path);
    return (
      <li key={"d:" + f.path} role="treeitem" aria-expanded={open}>
        <div
          class={`row folder ${active === f.path && r.name === "folder" ? "active" : ""} ${over === f.path ? "drop" : ""}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          draggable
          onDragStart={(e) => onDragStart(e, { kind: "folder", path: f.path })}
          onContextMenu={(e) => showMenu(e, folderMenu(f.path))}
          {...dropProps(f.path)}
        >
          <button class="twisty" onClick={() => toggle(f.path)} aria-label={open ? t("collapse") : t("expand")} tabIndex={-1}>
            <IconChevron size={14} class={open ? "open" : ""} />
          </button>
          <a
            href={folderHref(f.path)}
            class="row-link"
            onClick={() => {
              toggle(f.path, true);
              onNavigate();
            }}
          >
            {open ? <IconFolderOpen size={16} /> : <IconFolder size={16} />}
            <span class="name">{f.name}</span>
          </a>
          <span class="count">{f.count || ""}</span>
          <button class="row-more" onClick={(e) => showMenu(e, folderMenu(f.path))} aria-label={t("more")} tabIndex={-1}>
            <IconMore size={16} />
          </button>
        </div>
        {open && (f.folders.length > 0 || f.notes.length > 0) && (
          <ul role="group">
            {f.folders.map((c) => renderFolder(c, depth + 1))}
            {f.notes.map((n) => renderNote(n, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const renderNote = (path: string, depth: number) => (
    <li key={"n:" + path} role="treeitem">
      <div
        class={`row note ${active === path && r.name === "note" ? "active" : ""}`}
        style={{ paddingLeft: `${8 + depth * 14 + 18}px` }}
        draggable
        onDragStart={(e) => onDragStart(e, { kind: "note", path })}
        onContextMenu={(e) => showMenu(e, noteMenu(path))}
        {...dropProps(dirname(path))}
      >
        <a href={noteHref(path)} class="row-link" onClick={onNavigate}>
          <IconNote size={16} />
          <span class="name">{titleOf(path)}</span>
        </a>
        {s.repo.isDirty(path) && <span class="dot" title={t("notSyncedHint")} />}
        <button class="row-more" onClick={(e) => showMenu(e, noteMenu(path))} aria-label={t("more")} tabIndex={-1}>
          <IconMore size={16} />
        </button>
      </div>
    </li>
  );

  return (
    <aside class="sidebar" aria-label={t("notes")}>
      <div class={`side-head ${over === "" ? "drop" : ""}`} {...dropProps("")}>
        <a href={folderHref("")} class="repo-name" onClick={onNavigate} title={`${s.repo.ref.owner}/${s.repo.ref.repo}`}>
          <span class="owner">{s.repo.ref.owner} /</span> {s.repo.ref.repo}
        </a>
        <button class="icon-btn" onClick={() => newFolder("")} title={t("newFolder")} aria-label={t("newFolder")}>
          <IconFolderPlus size={17} />
        </button>
      </div>
      <nav class="tree-wrap">
        <ul class="tree" role="tree" {...dropProps("")}>
          {tree.folders.map((f) => renderFolder(f, 0))}
          {tree.notes.map((n) => renderNote(n, 0))}
        </ul>
        {!tree.count && !tree.folders.length && <p class="muted pad small">{t("noNotesYet")}</p>}
      </nav>
      <a class="side-support" href="#/settings" onClick={() => {
        onNavigate();
        setTimeout(() => document.getElementById("support")?.scrollIntoView());
      }}>
        <IconHeart size={16} /> {t("supportShort")}
      </a>
    </aside>
  );
}
