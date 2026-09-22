// A folder: sub-folders and note cards with a short preview.

import { deleteFolder, deleteNote, moveNote, moveNoteTo, newFolder, newNote, renameFolder, renameNote } from "../actions";
import { plainText } from "../core/markdown";
import { basename, dirname, join, titleOf } from "../core/paths";
import { t } from "../i18n";
import { folderHref, noteHref } from "../router";
import { rev, session, sync, virtualFolders } from "../state";
import { buildTree, findFolder } from "../tree";
import { IconEdit, IconFolder, IconFolderPlus, IconMore, IconMove, IconPlus, IconTrash } from "./icons";
import { showMenu } from "./Menu";

const excerpt = (text: string | undefined) => {
  if (text === undefined) return undefined;
  const plain = plainText(text.replace(/^#\s+.*\n/, ""));
  return plain.length > 260 ? plain.slice(0, 260) + "…" : plain;
};

export function FolderView({ path }: { path: string }) {
  const s = session.value!;
  rev.value;
  const tree = buildTree(s.repo.notes(), virtualFolders.value);
  const folder = findFolder(tree, path);

  if (!folder) {
    return (
      <div class="empty-state">
        <h2>{t("folderNotFound")}</h2>
        <a class="btn" href={folderHref("")}>
          {t("backToFolder")}
        </a>
      </div>
    );
  }

  const first = !s.repo.snapshot.fetched && sync.value.busy;
  const isEmpty = !folder.notes.length && !folder.folders.length;

  const dropInto = async (e: DragEvent, dir: string) => {
    const raw = e.dataTransfer?.getData("application/x-notewing");
    if (!raw) return;
    e.preventDefault();
    const d = JSON.parse(raw);
    if (d.kind === "note" && dirname(d.path) !== dir) await moveNoteTo(d.path, join(dir, basename(d.path)));
  };

  return (
    <section class="folder-view">
      <header class="folder-head">
        <nav class="crumbs" aria-label={t("path")}>
          <a href={folderHref("")}>{s.repo.ref.repo}</a>
          {path &&
            path.split("/").slice(0, -1).map((part, i, all) => (
              <>
                <span class="sep">/</span>
                <a href={folderHref(all.slice(0, i + 1).join("/"))}>{part}</a>
              </>
            ))}
        </nav>
        <div class="folder-title-row">
          <h1>{path ? folder.name : t("allNotes")}</h1>
          <div class="folder-actions">
            <button class="btn primary" onClick={() => newNote(path)}>
              <IconPlus size={16} /> {t("newNote")}
            </button>
            <button class="btn" onClick={() => newFolder(path)} title={t("newFolder")}>
              <IconFolderPlus size={16} /> <span class="hide-sm">{t("newFolder")}</span>
            </button>
            {path && (
              <button
                class="icon-btn"
                aria-label={t("more")}
                onClick={(e) =>
                  showMenu(e, [
                    { label: t("rename"), icon: <IconEdit size={16} />, onSelect: () => renameFolder(path) },
                    { label: t("delete"), icon: <IconTrash size={16} />, danger: true, onSelect: () => deleteFolder(path) },
                  ])
                }
              >
                <IconMore />
              </button>
            )}
          </div>
        </div>
      </header>

      {folder.folders.length > 0 && (
        <ul class="subfolders">
          {folder.folders.map((f) => (
            <li key={f.path}>
              <a
                href={folderHref(f.path)}
                class="subfolder"
                onDragOver={(e) => e.dataTransfer?.types.includes("application/x-notewing") && e.preventDefault()}
                onDrop={(e) => dropInto(e, f.path)}
              >
                <IconFolder size={18} />
                <span class="name">{f.name}</span>
                <span class="count">{f.count}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {first ? (
        <p class="muted pad">{t("loadingNotes")}</p>
      ) : isEmpty ? (
        <div class="empty-state">
          <h2>{path ? t("emptyFolder") : t("noNotesYet")}</h2>
          <p class="muted">{t("emptyHint")}</p>
          <button class="btn primary" onClick={() => newNote(path)}>
            <IconPlus size={16} /> {t("newNote")}
          </button>
        </div>
      ) : (
        <ul class="cards">
          {folder.notes.map((n) => {
            const ex = excerpt(s.repo.cachedText(n));
            return (
              <li key={n} class="card">
                <a
                  href={noteHref(n)}
                  class="card-link"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer!.setData("application/x-notewing", JSON.stringify({ kind: "note", path: n }));
                    e.dataTransfer!.effectAllowed = "move";
                  }}
                >
                  <h3>{titleOf(n)}</h3>
                  {ex === undefined ? <p class="excerpt skeleton" /> : ex ? <p class="excerpt">{ex}</p> : <p class="excerpt muted">{t("emptyNote")}</p>}
                </a>
                {s.repo.isDirty(n) && <span class="chip card-chip">{t("notSynced")}</span>}
                <button
                  class="icon-btn card-more"
                  aria-label={t("more")}
                  onClick={(e) =>
                    showMenu(e, [
                      { label: t("rename"), icon: <IconEdit size={16} />, onSelect: () => renameNote(n) },
                      { label: t("moveToEllipsis"), icon: <IconMove size={16} />, onSelect: () => moveNote(n) },
                      "-",
                      { label: t("delete"), icon: <IconTrash size={16} />, danger: true, onSelect: () => deleteNote(n) },
                    ])
                  }
                >
                  <IconMore size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
