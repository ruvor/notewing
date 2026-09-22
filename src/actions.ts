// User actions on notes and folders, shared by the sidebar, cards and the note page.

import { basename, cleanFolder, cleanName, dirname, join, NOTE_EXT, titleOf, uniquePath } from "./core/paths";
import { t } from "./i18n";
import { go, route } from "./router";
import { addVirtualFolder, changed, errorText, removeVirtualFolders, session, toast, virtualFolders } from "./state";
import { allFolders, buildTree } from "./tree";
import { confirm, pickFolder, prompt } from "./ui/dialogs";

const repo = () => session.value!.repo;

const extOf = (path: string) => basename(path).match(NOTE_EXT)?.[0] || ".md";

function validateName(v: string) {
  return cleanName(v) ? null : t("errEmptyName");
}

export function folders(): string[] {
  return allFolders(buildTree(repo().notes(), virtualFolders.value));
}

export function newNote(dir = currentFolder()) {
  go({ name: "new", path: dir });
}

/** The folder the user is looking at (or the folder of the open note). */
export function currentFolder(): string {
  const r = route.value;
  if (r.name === "folder" || r.name === "new") return r.path;
  if (r.name === "note") return dirname(r.path);
  return "";
}

export async function newFolder(parent = currentFolder()) {
  const name = await prompt(t("newFolder"), {
    label: parent ? t("insideFolder", parent) : t("folderName"),
    ok: t("create"),
    hint: t("folderHint"),
    validate: (v) => (cleanFolder(v) ? null : t("errEmptyName")),
  });
  if (name === null) return;
  const path = join(parent, cleanFolder(name)!);
  addVirtualFolder(path);
  go({ name: "folder", path });
}

export async function renameNote(path: string) {
  const name = await prompt(t("rename"), { value: titleOf(path), ok: t("rename"), validate: validateName });
  if (name === null) return;
  const to = join(dirname(path), cleanName(name) + extOf(path));
  await moveNoteTo(path, to);
}

export async function moveNote(path: string) {
  const dir = await pickFolder(t("moveTo", titleOf(path)), folders(), dirname(path), (f) => f === dirname(path));
  if (dir === null) return;
  await moveNoteTo(path, join(dir, basename(path)));
}

export async function moveNoteTo(from: string, to: string) {
  if (from === to) return;
  const r = repo();
  if (r.has(to) && to.toLowerCase() !== from.toLowerCase()) {
    toast(t("errExists", titleOf(to)), { kind: "error" });
    return;
  }
  try {
    await r.move(from, to);
  } catch (e) {
    toast(errorText(e), { kind: "error" });
    return;
  }
  changed();
  const rt = route.value;
  if (rt.name === "note" && rt.path === from) go({ name: "note", path: to }, true);
}

export async function deleteNote(path: string, ask = true) {
  if (ask && !(await confirm(t("deleteNote"), t("deleteNoteText", titleOf(path)), t("delete"), true))) return;
  const r = repo();
  let text: string | undefined;
  try {
    text = await r.text(path);
  } catch {}
  await r.remove(path);
  changed();
  const rt = route.value;
  if (rt.name === "note" && rt.path === path) go({ name: "folder", path: dirname(path) }, true);
  toast(t("deleted", titleOf(path)), {
    action:
      text === undefined
        ? undefined
        : {
            label: t("undo"),
            run: async () => {
              await r.write(path, text!);
              changed();
            },
          },
  });
}

export async function renameFolder(path: string) {
  const name = await prompt(t("renameFolder"), { value: basename(path), ok: t("rename"), validate: validateName });
  if (name === null) return;
  await moveFolderTo(path, join(dirname(path), cleanName(name)));
}

export async function moveFolder(path: string) {
  const dir = await pickFolder(
    t("moveTo", basename(path)),
    folders(),
    dirname(path),
    (f) => f === dirname(path) || f === path || f.startsWith(path + "/"),
  );
  if (dir === null) return;
  await moveFolderTo(path, join(dir, basename(path)));
}

export async function moveFolderTo(from: string, to: string) {
  if (from === to || to.startsWith(from + "/")) return;
  try {
    await repo().moveFolder(from, to);
  } catch (e) {
    toast(errorText(e), { kind: "error" });
    return;
  }
  // Keep empty sub-folders the user created.
  const moved = virtualFolders.value.filter((f) => f === from || f.startsWith(from + "/"));
  removeVirtualFolders(from);
  for (const f of moved) addVirtualFolder(to + f.slice(from.length));
  changed();
  const rt = route.value;
  if ((rt.name === "folder" || rt.name === "note") && (rt.path === from || rt.path.startsWith(from + "/"))) {
    go({ name: rt.name, path: to + rt.path.slice(from.length) }, true);
  }
}

export async function deleteFolder(path: string) {
  const count = repo().notes().filter((p) => p.startsWith(path + "/")).length;
  if (count && !(await confirm(t("deleteFolder"), t("deleteFolderText", count, basename(path)), t("delete"), true))) return;
  await repo().removeFolder(path);
  removeVirtualFolders(path);
  changed();
  const rt = route.value;
  if ((rt.name === "folder" || rt.name === "note") && (rt.path === path || rt.path.startsWith(path + "/"))) {
    go({ name: "folder", path: dirname(path) }, true);
  }
}

/** Creates a note file and returns its path. */
export async function createNote(dir: string, title: string, text: string): Promise<string> {
  const r = repo();
  const name = cleanName(title) || t("untitled");
  const path = uniquePath(join(dir, name + ".md"), (p) => r.has(p));
  await r.write(path, text);
  changed();
  return path;
}
