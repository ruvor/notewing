// Hash routes, so the app works from any static host and any sub-folder.
//   #/                     root folder
//   #/folder/a/b           folder
//   #/note/a/b/Plan.md     note
//   #/new/a/b              new note in a folder
//   #/settings

import { signal } from "@preact/signals";

export type Route =
  | { name: "folder"; path: string }
  | { name: "note"; path: string }
  | { name: "new"; path: string }
  | { name: "settings" };

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const dec = (p: string) => {
  try {
    return p.split("/").map(decodeURIComponent).join("/");
  } catch {
    return p;
  }
};

export function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const [name, ...rest] = h.split("/");
  const path = dec(rest.join("/"));
  if (name === "note" && path) return { name: "note", path };
  if (name === "new") return { name: "new", path };
  if (name === "settings") return { name: "settings" };
  if (name === "folder") return { name: "folder", path };
  return { name: "folder", path: "" };
}

export function href(r: Route): string {
  if (r.name === "settings") return "#/settings";
  if (r.name === "folder" && !r.path) return "#/";
  return `#/${r.name}/${enc(r.path)}`;
}

export const route = signal<Route>(parse(location.hash));

addEventListener("hashchange", () => {
  route.value = parse(location.hash);
});

export function go(r: Route, replace = false) {
  const h = href(r);
  if (replace) history.replaceState(null, "", h);
  else if (location.hash !== h) history.pushState(null, "", h);
  route.value = parse(h);
}

export const noteHref = (path: string) => href({ name: "note", path });
export const folderHref = (path: string) => href({ name: "folder", path });
