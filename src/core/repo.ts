// The notes repository: a local copy of the branch plus a queue of local changes.
//
// Local edits are stored first (so they survive offline use and reloads) and are pushed
// later as a single commit through the Git Data API. When the branch moved on GitHub
// meanwhile, local changes are rebased file by file; a file edited on both sides keeps
// the remote version and the local text is saved next to it as a conflict copy.

import { blobSha, fromBase64, fromUtf8, toBase64, utf8 } from "./bytes";
import { GitHub, GitHubError, RepoRef, type NewTreeEntry } from "./github";
import { basename, dirname, isNote, join, titleOf, uniquePath } from "./paths";
import type { Storage } from "./storage";

export interface Snapshot {
  head: string | null;
  tree: string | null;
  /** path -> blob sha, all files of the branch (notes, images, everything else) */
  files: Record<string, string>;
  fetched: number;
}

export interface Change {
  text?: string;
  /** binary content, base64 */
  data?: string;
  /** an existing blob (used for moves) */
  blob?: string;
  del?: true;
  /** blob sha of the file when the local change started; null for a new file */
  base: string | null;
  /** moved from this path (for the commit message) */
  from?: string;
  rev: number;
  time: number;
}

export interface SyncResult {
  pulled: boolean;
  pushed: number;
  /** paths of conflict copies created */
  conflicts: string[];
}

const EMPTY: Snapshot = { head: null, tree: null, files: {}, fetched: 0 };

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
};

export class NotesRepo {
  snapshot: Snapshot = EMPTY;
  pending: Record<string, Change> = {};
  /** blob sha -> text, for notes whose content is known */
  private texts = new Map<string, string>();
  private listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private rev = 0;
  prefetching = { done: 0, total: 0 };

  constructor(
    public gh: GitHub,
    public ref: RepoRef,
    public store: Storage,
  ) {}

  async open() {
    this.snapshot = (await this.store.get<Snapshot>("snapshot")) || EMPTY;
    this.pending = (await this.store.get<Record<string, Change>>("pending")) || {};
    this.rev = Math.max(0, ...Object.values(this.pending).map((c) => c.rev));
    await Promise.all(
      Object.entries(this.snapshot.files)
        .filter(([p]) => isNote(p))
        .map(async ([, sha]) => {
          const b = await this.store.getBlob(sha);
          if (b) this.texts.set(sha, fromUtf8(b));
        }),
    );
    this.emit();
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** Runs tasks that touch the network one at a time. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  // ---- reading ----

  /** All paths of the working copy (remote files with local changes applied). */
  paths(): string[] {
    const out = new Set(Object.keys(this.snapshot.files));
    for (const [p, c] of Object.entries(this.pending)) {
      if (c.del) out.delete(p);
      else out.add(p);
    }
    return [...out];
  }

  notes(): string[] {
    return this.paths().filter(isNote);
  }

  has(path: string) {
    const c = this.pending[path];
    return c ? !c.del : path in this.snapshot.files;
  }

  isDirty(path: string) {
    return path in this.pending;
  }

  get dirtyCount() {
    return Object.keys(this.pending).length;
  }

  /** Text of a note if it is available without the network. */
  cachedText(path: string): string | undefined {
    const c = this.pending[path];
    if (c?.text !== undefined) return c.text;
    const sha = c?.blob ?? (c ? undefined : this.snapshot.files[path]);
    return sha ? this.texts.get(sha) : undefined;
  }

  async text(path: string): Promise<string> {
    const cached = this.cachedText(path);
    if (cached !== undefined) return cached;
    return fromUtf8(await this.bytes(path));
  }

  async bytes(path: string): Promise<Uint8Array> {
    const c = this.pending[path];
    if (c?.del) throw new Error(`Deleted: ${path}`);
    if (c?.text !== undefined) return utf8(c.text);
    if (c?.data !== undefined) return fromBase64(c.data);
    const sha = c?.blob ?? this.snapshot.files[path];
    if (!sha) throw new Error(`Not found: ${path}`);
    return this.loadBlob(sha, isNote(path));
  }

  private async loadBlob(sha: string, text: boolean, quiet = false): Promise<Uint8Array> {
    let data = await this.store.getBlob(sha);
    if (!data) {
      data = await this.gh.blob(this.ref, sha);
      await this.store.putBlob(sha, data);
    }
    if (text && !this.texts.has(sha)) {
      this.texts.set(sha, fromUtf8(data));
      if (!quiet) this.emit();
    }
    return data;
  }

  // ---- local changes ----

  private async put(path: string, change: Omit<Change, "base" | "rev" | "time">) {
    const prev = this.pending[path];
    const base = prev ? prev.base : (this.snapshot.files[path] ?? null);
    const next: Change = { ...change, base, rev: ++this.rev, time: Date.now() };
    if (base !== null && !next.del && (await this.targetSha(next)) === base) {
      delete this.pending[path]; // back to the remote version
    } else if (base === null && next.del) {
      delete this.pending[path]; // a new file that never reached GitHub
    } else {
      this.pending[path] = next;
    }
    if (next.text !== undefined) this.texts.set(await blobSha(next.text), next.text);
  }

  private async save() {
    await this.store.set("pending", this.pending);
    this.emit();
  }

  async write(path: string, text: string) {
    await this.put(path, { text });
    await this.save();
  }

  async writeBinary(path: string, data: Uint8Array) {
    await this.put(path, { data: toBase64(data) });
    await this.save();
  }

  async remove(path: string) {
    await this.put(path, { del: true });
    await this.save();
  }

  async removeFolder(dir: string) {
    for (const p of this.paths()) if (p.startsWith(dir + "/")) await this.put(p, { del: true });
    await this.save();
  }

  /** Drops the local change of a file (returns to the GitHub version). */
  async discard(path: string) {
    delete this.pending[path];
    await this.save();
  }

  /** Moves or renames a file. Fails if the target exists. */
  async move(from: string, to: string) {
    if (from === to) return;
    if (this.has(to)) throw new Error(`Already exists: ${to}`);
    await this.moveOne(from, to);
    await this.save();
  }

  /** Moves every file under `from/` to `to/`. */
  async moveFolder(from: string, to: string) {
    if (from === to || to.startsWith(from + "/")) return;
    const moves = this.paths()
      .filter((p) => p.startsWith(from + "/"))
      .map((p) => [p, to + p.slice(from.length)] as const);
    for (const [, t] of moves) if (this.has(t)) throw new Error(`Already exists: ${t}`);
    for (const [f, t] of moves) await this.moveOne(f, t);
    await this.save();
  }

  private async moveOne(from: string, to: string) {
    const c = this.pending[from];
    const change: Omit<Change, "base" | "rev" | "time"> =
      c?.text !== undefined ? { text: c.text } : c?.data !== undefined ? { data: c.data } : { blob: c?.blob ?? this.snapshot.files[from] };
    if (!change.text && !change.data && !change.blob) throw new Error(`Not found: ${from}`);
    await this.put(to, { ...change, from: c?.from ?? from });
    await this.put(from, { del: true });
  }

  private async targetSha(c: Change): Promise<string | null> {
    if (c.del) return null;
    if (c.blob) return c.blob;
    if (c.text !== undefined) return blobSha(c.text);
    return blobSha(fromBase64(c.data!));
  }

  // ---- sync ----

  /** Pulls and pushes. Safe to call often. */
  sync(): Promise<SyncResult> {
    return this.exclusive(async () => {
      const result: SyncResult = { pulled: false, pushed: 0, conflicts: [] };
      for (let attempt = 0; ; attempt++) {
        const pulled = await this.pullInner();
        result.pulled ||= pulled.changed;
        result.conflicts.push(...pulled.conflicts);
        if (!this.dirtyCount) return result;
        try {
          result.pushed += await this.pushInner();
          if (!this.dirtyCount) return result;
        } catch (e) {
          // 422: the branch moved between our pull and the ref update. 409: conflict. Retry.
          if (!(e instanceof GitHubError && (e.status === 422 || e.status === 409)) || attempt >= 4) throw e;
        }
      }
    });
  }

  /** Only fetches remote changes. */
  pull(): Promise<SyncResult> {
    return this.exclusive(async () => {
      const r = await this.pullInner();
      return { pulled: r.changed, pushed: 0, conflicts: r.conflicts };
    });
  }

  private async pullInner(): Promise<{ changed: boolean; conflicts: string[] }> {
    const head = await this.gh.head(this.ref);
    if (head === this.snapshot.head) {
      this.snapshot.fetched = Date.now();
      return { changed: false, conflicts: [] };
    }
    let files: Record<string, string> = {};
    let tree: string | null = null;
    if (head) {
      tree = await this.gh.commitTree(this.ref, head);
      const t = await this.gh.tree(this.ref, tree);
      for (const e of t.tree) if (e.type === "blob") files[e.path] = e.sha;
    }
    const conflicts = await this.rebase(files);
    this.snapshot = { head, tree, files, fetched: Date.now() };
    await this.store.set("snapshot", this.snapshot);
    await this.save();
    return { changed: true, conflicts };
  }

  /** Re-bases local changes onto a new remote file list. */
  private async rebase(remote: Record<string, string>): Promise<string[]> {
    const conflicts: string[] = [];
    for (const [path, c] of Object.entries(this.pending)) {
      const now = remote[path] ?? null;
      if (now === c.base) continue; // remote did not touch it
      const mine = await this.targetSha(c);
      if (now === mine) {
        delete this.pending[path]; // same result on both sides
        continue;
      }
      if (c.del) {
        // Deleted here, changed (or deleted) there: keep the remote state.
        delete this.pending[path];
        continue;
      }
      if (now === null) {
        c.base = null; // deleted there, edited here: keep ours as a new file
        continue;
      }
      // Edited on both sides: the remote version wins the path, ours becomes a copy.
      delete this.pending[path];
      const taken = (p: string) => p in remote || (p in this.pending && !this.pending[p].del);
      const ext = basename(path).slice(titleOf(path).length);
      const copy = uniquePath(join(dirname(path), `${titleOf(path)} (conflict ${stamp()})${ext}`), taken);
      this.pending[copy] = { ...c, base: remote[copy] ?? null, from: undefined };
      conflicts.push(copy);
    }
    return conflicts;
  }

  private message(batch: [string, Change][]): string {
    const moved = batch.find(([, c]) => c.from);
    if (batch.length === 2 && moved && batch.some(([p, c]) => c.del && p === moved[1].from)) {
      return `Move ${moved[1].from} → ${moved[0]}`;
    }
    if (batch.length === 1) {
      const [p, c] = batch[0];
      return `${c.del ? "Delete" : c.base === null ? "Create" : "Update"} ${p}`;
    }
    return `Update ${batch.length} files`;
  }

  private async pushInner(): Promise<number> {
    const batch = Object.entries(this.pending).map(([p, c]) => [p, { ...c }] as [string, Change]);
    if (!batch.length) return 0;

    if (!this.snapshot.head) {
      // Empty repository: the first file goes through the contents API, the rest follows next round.
      const first = batch.find(([, c]) => !c.del);
      if (!first) {
        this.pending = {};
        await this.save();
        return 0;
      }
      const [path, c] = first;
      const data = c.text !== undefined ? toBase64(utf8(c.text)) : c.data!;
      await this.gh.putFile(this.ref, path, data, this.message([first]));
      await this.pullInner();
      return 1;
    }

    const entries: NewTreeEntry[] = [];
    const shas: Record<string, string | null> = {};
    for (const [path, c] of batch) {
      if (c.del) {
        if (!(path in this.snapshot.files)) continue;
        entries.push({ path, mode: "100644", type: "blob", sha: null });
        shas[path] = null;
      } else if (c.text !== undefined) {
        entries.push({ path, mode: "100644", type: "blob", content: c.text });
        shas[path] = await blobSha(c.text);
      } else if (c.data !== undefined) {
        const sha = await this.gh.createBlob(this.ref, c.data);
        entries.push({ path, mode: "100644", type: "blob", sha });
        shas[path] = sha;
      } else {
        entries.push({ path, mode: "100644", type: "blob", sha: c.blob! });
        shas[path] = c.blob!;
      }
    }

    const head = this.snapshot.head;
    let tree = this.snapshot.tree!;
    let commit = head;
    if (entries.length) {
      tree = await this.gh.createTree(this.ref, this.snapshot.tree!, entries);
      commit = await this.gh.createCommit(this.ref, this.message(batch), tree, [head]);
      await this.gh.updateRef(this.ref, commit);
    }

    const files = { ...this.snapshot.files };
    for (const [path, sha] of Object.entries(shas)) {
      if (sha === null) delete files[path];
      else files[path] = sha;
    }
    for (const [path, c] of batch) {
      if (c.text !== undefined) await this.store.putBlob(shas[path]!, utf8(c.text));
      if (c.data !== undefined) await this.store.putBlob(shas[path]!, fromBase64(c.data));
      const now = this.pending[path];
      if (!now) continue;
      if (now.rev === c.rev) delete this.pending[path];
      else now.base = files[path] ?? null; // edited again while pushing
    }
    this.snapshot = { head: commit, tree, files, fetched: Date.now() };
    await this.store.set("snapshot", this.snapshot);
    await this.save();
    return batch.length;
  }

  /** Downloads the text of every note that is not cached yet (for search and previews). */
  async prefetch(concurrency = 4) {
    if (this.prefetching.total) return; // already running
    const todo = Object.entries(this.snapshot.files)
      .filter(([p, sha]) => isNote(p) && !this.texts.has(sha))
      .map(([, sha]) => sha);
    const unique = [...new Set(todo)];
    this.prefetching = { done: 0, total: unique.length };
    if (!unique.length) return;
    this.emit();
    let i = 0;
    const worker = async () => {
      while (i < unique.length) {
        const sha = unique[i++];
        try {
          await this.loadBlob(sha, true, true);
        } catch (e) {
          if (e instanceof GitHubError && e.status === 0) throw e; // offline: stop
        }
        // Re-render in batches, not once per note.
        if (++this.prefetching.done % 20 === 0) this.emit();
      }
    };
    try {
      await Promise.all(Array.from({ length: concurrency }, worker));
    } finally {
      this.prefetching = { done: 0, total: 0 };
      this.emit();
    }
  }
}
