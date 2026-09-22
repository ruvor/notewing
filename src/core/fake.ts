// An in-memory stand-in for the parts of the GitHub REST API Notewing uses.
// Powers the demo mode, the unit tests and the end-to-end tests.

import { blobSha, fromBase64, toBase64, utf8 } from "./bytes";
import type { Fetch } from "./github";

interface Commit {
  tree: string;
  parents: string[];
  message: string;
  date: string;
}

type Flat = Record<string, string>; // path -> blob sha

let counter = 0;
const fakeSha = (seed: string) => {
  counter++;
  let h = 0x811c9dc5;
  const s = seed + ":" + counter + ":" + Math.random();
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return (h.toString(16).padStart(8, "0") + counter.toString(16).padStart(8, "0")).repeat(3).slice(0, 40);
};

export class FakeGitHub {
  blobs = new Map<string, Uint8Array>();
  trees = new Map<string, Flat>();
  commits = new Map<string, Commit>();
  refs = new Map<string, string>();
  requests: string[] = [];
  /** Test hook: runs before each request; may throw or mutate state. */
  onRequest?: (method: string, path: string) => void | Promise<void>;
  offline = false;
  user = { login: "demo", name: "Demo User", avatar_url: "" };

  constructor(public owner = "demo", public repo = "notes", public branch = "main") {}

  /** Creates a commit on the branch with the given files (path -> text or bytes, null deletes). */
  async commit(files: Record<string, string | Uint8Array | null>, message = "Update", date = new Date().toISOString()) {
    const head = this.refs.get(this.branch);
    const base: Flat = head ? { ...this.trees.get(this.commits.get(head)!.tree)! } : {};
    for (const [path, data] of Object.entries(files)) {
      if (data === null) delete base[path];
      else base[path] = await this.putBlob(typeof data === "string" ? utf8(data) : data);
    }
    const tree = this.putTree(base);
    const sha = fakeSha("commit");
    this.commits.set(sha, { tree, parents: head ? [head] : [], message, date });
    this.refs.set(this.branch, sha);
    return sha;
  }

  files(): Record<string, string> {
    const head = this.refs.get(this.branch);
    if (!head) return {};
    const flat = this.trees.get(this.commits.get(head)!.tree)!;
    const out: Record<string, string> = {};
    for (const [p, sha] of Object.entries(flat)) out[p] = new TextDecoder().decode(this.blobs.get(sha)!);
    return out;
  }

  private async putBlob(data: Uint8Array) {
    const sha = await blobSha(data);
    this.blobs.set(sha, data);
    return sha;
  }

  private putTree(flat: Flat) {
    const sha = fakeSha("tree");
    this.trees.set(sha, flat);
    return sha;
  }

  fetch: Fetch = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url);
    const path = decodeURI(u.pathname);
    this.requests.push(`${method} ${u.pathname}${u.search}`);
    if (this.offline) throw new TypeError("Failed to fetch");
    await this.onRequest?.(method, path);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const headers = new Headers(init.headers as HeadersInit);
    const raw = (headers.get("accept") || "").includes("raw");
    try {
      return await this.route(method, path, u.searchParams, body, raw);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  };

  private json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  }

  private fail(status: number, message: string): never {
    throw this.json({ message }, status);
  }

  private tip(): string {
    const head = this.refs.get(this.branch);
    if (!head) this.fail(409, "Git Repository is empty.");
    return head;
  }

  private flatAt(ref: string): Flat {
    const commit = this.commits.get(ref) || this.commits.get(this.refs.get(ref) || "");
    if (!commit) this.fail(404, "No commit found for the ref");
    return this.trees.get(commit.tree)!;
  }

  private async route(method: string, path: string, q: URLSearchParams, body: any, raw: boolean): Promise<Response> {
    if (path === "/user") return this.json(this.user);
    if (path === "/user/repos") return this.json([this.info()]);
    const prefix = `/repos/${this.owner}/${this.repo}`;
    if (!path.startsWith(prefix)) this.fail(404, "Not Found");
    const rest = path.slice(prefix.length);

    if (rest === "" && method === "GET") return this.json(this.info());

    if (rest.startsWith("/git/ref/heads/") && method === "GET") {
      const branch = rest.slice("/git/ref/heads/".length);
      if (!this.refs.size) this.fail(409, "Git Repository is empty.");
      const sha = this.refs.get(branch);
      if (!sha) this.fail(404, "Not Found");
      return this.json({ ref: `refs/heads/${branch}`, object: { sha, type: "commit" } });
    }

    if (rest.startsWith("/git/refs/heads/") && method === "PATCH") {
      const branch = rest.slice("/git/refs/heads/".length);
      const current = this.refs.get(branch);
      const next = this.commits.get(body.sha);
      if (!next) this.fail(422, "Object does not exist");
      if (!body.force && current && !next.parents.includes(current)) this.fail(422, "Update is not a fast forward");
      this.refs.set(branch, body.sha);
      return this.json({ ref: `refs/heads/${branch}`, object: { sha: body.sha } });
    }

    if (rest.startsWith("/git/commits/") && method === "GET") {
      const c = this.commits.get(rest.slice("/git/commits/".length));
      if (!c) this.fail(404, "Not Found");
      return this.json({ tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message });
    }

    if (rest === "/git/commits" && method === "POST") {
      this.tip();
      if (!this.trees.has(body.tree)) this.fail(422, "Tree SHA does not exist");
      const sha = fakeSha("commit");
      this.commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message, date: new Date().toISOString() });
      return this.json({ sha }, 201);
    }

    if (rest.startsWith("/git/trees/") && method === "GET") {
      const flat = this.trees.get(rest.slice("/git/trees/".length));
      if (!flat) this.fail(404, "Not Found");
      const dirs = new Set<string>();
      for (const p of Object.keys(flat)) {
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
      }
      const tree = [
        ...[...dirs].map((p) => ({ path: p, mode: "040000", type: "tree", sha: fakeSha("dir") })),
        ...Object.entries(flat).map(([p, sha]) => ({ path: p, mode: "100644", type: "blob", sha, size: this.blobs.get(sha)!.length })),
      ].sort((a, b) => (a.path < b.path ? -1 : 1));
      return this.json({ sha: rest.slice(11), tree, truncated: false });
    }

    if (rest === "/git/trees" && method === "POST") {
      this.tip();
      const base = this.trees.get(body.base_tree);
      if (!base) this.fail(422, "base_tree is not a valid tree");
      const flat = { ...base };
      for (const e of body.tree) {
        if (e.content !== undefined) flat[e.path] = await this.putBlob(utf8(e.content));
        else if (e.sha === null) {
          if (!(e.path in flat)) this.fail(422, `tree.path ${e.path} does not exist`);
          delete flat[e.path];
        } else {
          if (!this.blobs.has(e.sha)) this.fail(422, "tree.sha is not a valid blob");
          flat[e.path] = e.sha;
        }
      }
      return this.json({ sha: this.putTree(flat) }, 201);
    }

    if (rest.startsWith("/git/blobs/") && method === "GET") {
      const data = this.blobs.get(rest.slice("/git/blobs/".length));
      if (!data) this.fail(404, "Not Found");
      if (raw) return new Response(data.slice());
      return this.json({ content: toBase64(data), encoding: "base64" });
    }

    if (rest === "/git/blobs" && method === "POST") {
      this.tip();
      return this.json({ sha: await this.putBlob(fromBase64(body.content)) }, 201);
    }

    if (rest.startsWith("/contents/") && method === "PUT") {
      const p = rest.slice("/contents/".length);
      await this.commit({ [p]: fromBase64(body.content) }, body.message);
      return this.json({ content: { path: p } }, 201);
    }

    if (rest.startsWith("/contents/") && method === "GET") {
      const p = rest.slice("/contents/".length);
      const flat = this.flatAt(q.get("ref") || this.tip());
      if (!(p in flat)) this.fail(404, "Not Found");
      return new Response(this.blobs.get(flat[p])!.slice());
    }

    if (rest === "/commits" && method === "GET") {
      const p = q.get("path") || "";
      const out: any[] = [];
      let sha: string | undefined = this.refs.get(q.get("sha") || this.branch);
      while (sha) {
        const c: Commit = this.commits.get(sha)!;
        const parent = c.parents[0] ? this.trees.get(this.commits.get(c.parents[0])!.tree)! : {};
        const now = this.trees.get(c.tree)!;
        if (!p || now[p] !== parent[p]) {
          out.push({
            sha,
            html_url: `https://github.com/${this.owner}/${this.repo}/commit/${sha}`,
            commit: { message: c.message, author: { name: this.user.name, date: c.date }, committer: { date: c.date } },
            author: { login: this.user.login, avatar_url: "" },
          });
        }
        sha = c.parents[0];
      }
      return this.json(out);
    }

    this.fail(404, `Fake GitHub: no route for ${method} ${rest}`);
  }

  private info() {
    return {
      full_name: `${this.owner}/${this.repo}`,
      name: this.repo,
      owner: { login: this.owner },
      default_branch: this.branch,
      private: true,
      permissions: { push: true, pull: true },
    };
  }
}
