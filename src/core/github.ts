// Minimal GitHub REST client. Everything goes straight from the browser to api.github.com.

export const API = "https://api.github.com";

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

export interface GitUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface RepoInfo {
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  permissions?: { push?: boolean; pull?: boolean };
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export interface NewTreeEntry {
  path: string;
  mode: "100644";
  type: "blob";
  sha?: string | null;
  content?: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
  date: string;
  author: string;
  avatar?: string;
  url: string;
}

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GitHubError";
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const seg = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export class GitHub {
  constructor(
    public token: string,
    private fetchImpl: Fetch = (i, o) => fetch(i, o),
  ) {}

  async req(method: string, path: string, body?: unknown, accept = "application/vnd.github+json"): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(API + path, {
        method,
        cache: "no-store",
        headers: {
          Accept: accept,
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new GitHubError(0, (e as Error).message || "Network error");
    }
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const j = await res.json();
        msg = j.message || msg;
      } catch {}
      throw new GitHubError(res.status, msg);
    }
    return res;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.req(method, path, body)).json();
  }

  user() {
    return this.json<GitUser>("GET", "/user");
  }

  repos() {
    return this.json<RepoInfo[]>("GET", "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
  }

  repoInfo(owner: string, repo: string) {
    return this.json<RepoInfo>("GET", `/repos/${owner}/${repo}`);
  }

  private base(r: RepoRef) {
    return `/repos/${r.owner}/${r.repo}`;
  }

  /** Commit id at the tip of the branch; null for an empty repository. */
  async head(r: RepoRef): Promise<string | null> {
    try {
      const ref = await this.json<{ object: { sha: string } }>("GET", `${this.base(r)}/git/ref/heads/${seg(r.branch)}`);
      return ref.object.sha;
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 409 || e.status === 404)) {
        // 409: "Git Repository is empty". 404 here means the branch is missing (or no access).
        if (e.status === 404) await this.repoInfo(r.owner, r.repo); // throws if the repo itself is inaccessible
        return null;
      }
      throw e;
    }
  }

  async commitTree(r: RepoRef, commit: string): Promise<string> {
    return (await this.json<{ tree: { sha: string } }>("GET", `${this.base(r)}/git/commits/${commit}`)).tree.sha;
  }

  tree(r: RepoRef, treeSha: string) {
    return this.json<{ sha: string; tree: TreeEntry[]; truncated: boolean }>(
      "GET",
      `${this.base(r)}/git/trees/${treeSha}?recursive=1`,
    );
  }

  async blob(r: RepoRef, sha: string): Promise<Uint8Array> {
    const res = await this.req("GET", `${this.base(r)}/git/blobs/${sha}`, undefined, "application/vnd.github.raw+json");
    return new Uint8Array(await res.arrayBuffer());
  }

  async createBlob(r: RepoRef, base64: string): Promise<string> {
    return (await this.json<{ sha: string }>("POST", `${this.base(r)}/git/blobs`, { content: base64, encoding: "base64" })).sha;
  }

  async createTree(r: RepoRef, base: string, entries: NewTreeEntry[]): Promise<string> {
    return (await this.json<{ sha: string }>("POST", `${this.base(r)}/git/trees`, { base_tree: base, tree: entries })).sha;
  }

  async createCommit(r: RepoRef, message: string, tree: string, parents: string[]): Promise<string> {
    return (await this.json<{ sha: string }>("POST", `${this.base(r)}/git/commits`, { message, tree, parents })).sha;
  }

  /** Fast-forward only. Throws GitHubError 422 when the branch moved meanwhile. */
  async updateRef(r: RepoRef, sha: string): Promise<void> {
    await this.req("PATCH", `${this.base(r)}/git/refs/heads/${seg(r.branch)}`, { sha, force: false });
  }

  /** The Git Data API does not work on an empty repository; the contents API does. */
  async putFile(r: RepoRef, path: string, base64: string, message: string): Promise<void> {
    await this.req("PUT", `${this.base(r)}/contents/${seg(path)}`, { message, content: base64, branch: r.branch });
  }

  async history(r: RepoRef, path: string): Promise<CommitInfo[]> {
    const list = await this.json<any[]>(
      "GET",
      `${this.base(r)}/commits?sha=${encodeURIComponent(r.branch)}&path=${encodeURIComponent(path)}&per_page=50`,
    );
    return list.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      date: c.commit.committer?.date || c.commit.author?.date,
      author: c.author?.login || c.commit.author?.name || "",
      avatar: c.author?.avatar_url,
      url: c.html_url,
    }));
  }

  /** File contents at a commit, or null if the file did not exist there. */
  async fileAt(r: RepoRef, path: string, ref: string): Promise<Uint8Array | null> {
    try {
      const res = await this.req(
        "GET",
        `${this.base(r)}/contents/${seg(path)}?ref=${ref}`,
        undefined,
        "application/vnd.github.raw+json",
      );
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }
}
