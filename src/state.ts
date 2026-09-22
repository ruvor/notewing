// Application state: the connected repository, sync scheduling, toasts.

import { batch, signal } from "@preact/signals";
import { FakeGitHub } from "./core/fake";
import { GitHub, GitHubError, type GitUser, type RepoRef } from "./core/github";
import { NotesRepo } from "./core/repo";
import { IdbStorage, MemoryStorage } from "./core/storage";
import { demoGitHub } from "./demo";
import { lang, t } from "./i18n";
import { noteHref } from "./router";
import { settings } from "./settings";

export interface Session {
  repo: NotesRepo;
  user: GitUser;
  demo: boolean;
}

interface Saved {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

export const session = signal<Session | null>(null);
/** Bumped whenever the repository content or queue changes. */
export const rev = signal(0);
export const sync = signal({ busy: false, error: "" as string, offline: !navigator.onLine, last: 0, auth: false });
/** Folders created in the UI that have no notes yet. */
export const virtualFolders = signal<string[]>([]);

// ---- toasts ----

export interface Toast {
  id: number;
  text: string;
  kind?: "error" | "info";
  action?: { label: string; run: () => void };
}
export const toasts = signal<Toast[]>([]);
let toastId = 0;
export function toast(text: string, opts: Omit<Toast, "id" | "text"> = {}, ms = 5000) {
  const id = ++toastId;
  toasts.value = [...toasts.value.slice(-2), { id, text, ...opts }];
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== id)), ms);
}

// ---- session ----

const KEY = "notewing.session";

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const dbName = (r: RepoRef) => `notewing:${r.owner}/${r.repo}@${r.branch}`.toLowerCase();

export async function restore(): Promise<boolean> {
  const saved = readSaved();
  if (!saved) return false;
  const gh = new GitHub(saved.token);
  const ref = { owner: saved.owner, repo: saved.repo, branch: saved.branch };
  const repo = new NotesRepo(gh, ref, new IdbStorage(dbName(ref)));
  await repo.open();
  const user = ((await repo.store.get<GitUser>("user")) || { login: saved.owner, name: null, avatar_url: "" }) as GitUser;
  await start({ repo, user, demo: false });
  return true;
}

/** Checks the token and repository, then opens it. Throws a user-facing message. */
export async function connect(token: string, fullName: string, remember: boolean) {
  const gh = new GitHub(token.trim());
  let user: GitUser;
  try {
    user = await gh.user();
  } catch (e) {
    throw new Error(e instanceof GitHubError && e.status === 401 ? t("errTokenInvalid") : errorText(e));
  }
  const [owner, name] = fullName.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").split("/");
  if (!owner || !name) throw new Error(t("errRepoFormat"));
  let info;
  try {
    info = await gh.repoInfo(owner, name);
  } catch (e) {
    throw new Error(e instanceof GitHubError && e.status === 404 ? t("errRepoNotFound") : errorText(e));
  }
  if (info.permissions && info.permissions.push === false) throw new Error(t("errNoPush"));
  const ref = { owner: info.owner.login, repo: info.name, branch: info.default_branch };
  const saved: Saved = { token: gh.token, ...ref };
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(saved));
  } catch {}
  const repo = new NotesRepo(gh, ref, new IdbStorage(dbName(ref)));
  await repo.open();
  await repo.store.set("user", user);
  await start({ repo, user, demo: false });
}

/** Swaps the token (expired or revoked) and keeps the local copy and queued changes. */
export async function replaceToken(token: string) {
  const s = session.value!;
  const gh = new GitHub(token.trim());
  try {
    const user = await gh.user();
    await gh.repoInfo(s.repo.ref.owner, s.repo.ref.repo);
    s.repo.gh.token = gh.token;
    await s.repo.store.set("user", user);
    session.value = { ...s, user };
  } catch (e) {
    throw new Error(e instanceof GitHubError && e.status === 401 ? t("errTokenInvalid") : errorText(e));
  }
  const inLocal = !!localStorage.getItem(KEY);
  const saved: Saved = { token: gh.token, ...s.repo.ref };
  try {
    (inLocal ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(saved));
  } catch {}
  sync.value = { ...sync.value, auth: false, error: "" };
  runSync();
}

export async function startDemo() {
  const fake: FakeGitHub = await demoGitHub(lang.value);
  const repo = new NotesRepo(new GitHub("demo", fake.fetch), { owner: "demo", repo: "notes", branch: "main" }, new MemoryStorage());
  await repo.open();
  await start({ repo, user: fake.user, demo: true });
}

/** Forgets the token and deletes the local copy (including changes that were not pushed). */
export async function disconnect() {
  const s = session.value;
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {}
  stopTimers();
  session.value = null;
  if (s && !s.demo) {
    await (s.repo.store as IdbStorage).close();
    await IdbStorage.destroy((s.repo.store as IdbStorage).name);
  }
  location.hash = "#/";
}

let unsubscribe: (() => void) | null = null;

async function start(s: Session) {
  unsubscribe?.();
  unsubscribe = s.repo.onChange(() => (rev.value = rev.value + 1));
  virtualFolders.value = (await s.repo.store.get<string[]>("folders")) || [];
  batch(() => {
    session.value = s;
    sync.value = { ...sync.value, error: "", auth: false };
  });
  startTimers();
  await runSync();
}

export function addVirtualFolder(path: string) {
  if (!virtualFolders.value.includes(path)) {
    virtualFolders.value = [...virtualFolders.value, path];
    session.value?.repo.store.set("folders", virtualFolders.value);
  }
}

export function removeVirtualFolders(prefix: string) {
  virtualFolders.value = virtualFolders.value.filter((f) => f !== prefix && !f.startsWith(prefix + "/"));
  session.value?.repo.store.set("folders", virtualFolders.value);
}

/** Link to a file (or the repository) on github.com. */
export function githubUrl(path = "", kind: "blob" | "commits" = "blob"): string {
  const r = session.value!.repo.ref;
  const base = `https://github.com/${r.owner}/${r.repo}`;
  if (!path && kind === "blob") return base;
  return `${base}/${kind}/${encodeURIComponent(r.branch)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// ---- sync ----

export function errorText(e: unknown): string {
  if (e instanceof GitHubError) {
    if (e.status === 0) return t("errOffline");
    if (e.status === 401) return t("errTokenExpired");
    if (e.status === 403 && /rate limit/i.test(e.message)) return t("errRateLimit");
    if (e.status === 403 || e.status === 404) return t("errNoAccess");
    return `GitHub: ${e.message} (${e.status})`;
  }
  return (e as Error)?.message || String(e);
}

let syncTimer = 0;
let pollTimer = 0;
let running: Promise<void> | null = null;
let again = false;

export function runSync(pullOnly = false): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    await null;
    const s = session.value;
    if (!s) return;
    sync.value = { ...sync.value, busy: true };
    try {
      const r = pullOnly ? await s.repo.pull() : await s.repo.sync();
      sync.value = { busy: false, error: "", offline: false, last: Date.now(), auth: false };
      for (const path of r.conflicts) {
        toast(t("conflictSaved"), { action: { label: t("open"), run: () => (location.hash = noteHref(path)) } }, 10000);
      }
      s.repo.prefetch().catch(() => {});
    } catch (e) {
      const offline = e instanceof GitHubError && e.status === 0;
      sync.value = {
        ...sync.value,
        busy: false,
        offline,
        error: offline ? "" : errorText(e),
        auth: e instanceof GitHubError && e.status === 401,
      };
    }
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      runSync();
    }
  });
  return running;
}

/** Called after every local change. */
export function changed() {
  clearTimeout(syncTimer);
  if (settings.value.autoSync) syncTimer = setTimeout(runSync, 4000) as unknown as number;
}

function startTimers() {
  stopTimers();
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine) runSync(!settings.value.autoSync);
  }, 60000) as unknown as number;
}

function stopTimers() {
  clearInterval(pollTimer);
  clearTimeout(syncTimer);
}

addEventListener("online", () => {
  sync.value = { ...sync.value, offline: false };
  runSync();
});
addEventListener("offline", () => (sync.value = { ...sync.value, offline: true }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && session.value && Date.now() - sync.value.last > 20000) {
    runSync(!settings.value.autoSync);
  }
});
