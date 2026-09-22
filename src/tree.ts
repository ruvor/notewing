import { basename, dirname, titleOf } from "./core/paths";

export interface Folder {
  path: string;
  name: string;
  folders: Folder[];
  notes: string[];
  /** notes in this folder and below */
  count: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function buildTree(notes: string[], virtual: string[] = []): Folder {
  const root: Folder = { path: "", name: "", folders: [], notes: [], count: 0 };
  const index = new Map<string, Folder>([["", root]]);
  const folder = (path: string): Folder => {
    let f = index.get(path);
    if (f) return f;
    const parent = folder(dirname(path));
    f = { path, name: basename(path), folders: [], notes: [], count: 0 };
    parent.folders.push(f);
    index.set(path, f);
    return f;
  };
  for (const v of virtual) folder(v);
  for (const n of notes) {
    folder(dirname(n)).notes.push(n);
    for (let d = dirname(n); ; d = dirname(d)) {
      index.get(d)!.count++;
      if (!d) break;
    }
  }
  for (const f of index.values()) {
    f.folders.sort((a, b) => collator.compare(a.name, b.name));
    f.notes.sort((a, b) => collator.compare(titleOf(a), titleOf(b)));
  }
  return root;
}

export function findFolder(root: Folder, path: string): Folder | null {
  if (!path) return root;
  let f: Folder | undefined = root;
  for (const part of path.split("/")) {
    f = f.folders.find((x) => x.name === part);
    if (!f) return null;
  }
  return f;
}

export function allFolders(root: Folder): string[] {
  const out: string[] = [];
  const walk = (f: Folder) => {
    out.push(f.path);
    f.folders.forEach(walk);
  };
  walk(root);
  return out;
}
