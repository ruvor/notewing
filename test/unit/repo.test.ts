import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeGitHub } from "../../src/core/fake";
import { GitHub } from "../../src/core/github";
import { NotesRepo } from "../../src/core/repo";
import { MemoryStorage } from "../../src/core/storage";
import { relativeLink, resolveLink, cleanName, uniquePath } from "../../src/core/paths";
import { blobSha } from "../../src/core/bytes";

async function setup(files: Record<string, string> = { "README.md": "# Hi", "work/Plan.md": "plan" }) {
  const fake = new FakeGitHub();
  if (Object.keys(files).length) await fake.commit(files, "init");
  const store = new MemoryStorage();
  const repo = new NotesRepo(new GitHub("t", fake.fetch), { owner: "demo", repo: "notes", branch: "main" }, store);
  await repo.open();
  await repo.sync();
  return { fake, repo, store };
}

test("git blob sha matches git", async () => {
  // echo -n "hello" | git hash-object --stdin
  assert.equal(await blobSha("hello"), "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
});

test("pull reads the tree and texts load lazily", async () => {
  const { repo } = await setup();
  assert.deepEqual(repo.notes().sort(), ["README.md", "work/Plan.md"]);
  assert.equal(repo.cachedText("README.md"), undefined);
  assert.equal(await repo.text("README.md"), "# Hi");
  await repo.prefetch();
  assert.equal(repo.cachedText("work/Plan.md"), "plan");
});

test("local edits are queued and pushed as one commit", async () => {
  const { fake, repo } = await setup();
  await repo.write("work/Plan.md", "new plan");
  await repo.write("Ideas.md", "idea");
  await repo.remove("README.md");
  assert.equal(repo.dirtyCount, 3);
  const before = fake.commits.size;
  const r = await repo.sync();
  assert.equal(r.pushed, 3);
  assert.equal(repo.dirtyCount, 0);
  assert.equal(fake.commits.size, before + 1);
  assert.deepEqual(fake.files(), { "work/Plan.md": "new plan", "Ideas.md": "idea" });
  assert.equal(fake.commits.get(fake.refs.get("main")!)!.message, "Update 3 files");
});

test("writing the original text back clears the change", async () => {
  const { repo } = await setup();
  await repo.write("README.md", "changed");
  await repo.write("README.md", "# Hi");
  assert.equal(repo.dirtyCount, 0);
  await repo.write("New.md", "x");
  await repo.remove("New.md");
  assert.equal(repo.dirtyCount, 0);
});

test("moves reuse the blob and get a readable message", async () => {
  const { fake, repo } = await setup();
  await repo.move("work/Plan.md", "archive/Plan 2022.md");
  assert.equal(await repo.text("archive/Plan 2022.md"), "plan");
  await repo.sync();
  assert.deepEqual(Object.keys(fake.files()).sort(), ["README.md", "archive/Plan 2022.md"]);
  assert.equal(fake.commits.get(fake.refs.get("main")!)!.message, "Move work/Plan.md → archive/Plan 2022.md");
  await assert.rejects(repo.move("README.md", "archive/Plan 2022.md"));
});

test("folder moves", async () => {
  const { fake, repo } = await setup({ "a/1.md": "1", "a/b/2.md": "2", "c.md": "c" });
  await repo.moveFolder("a", "z/a");
  await repo.sync();
  assert.deepEqual(Object.keys(fake.files()).sort(), ["c.md", "z/a/1.md", "z/a/b/2.md"]);
});

test("remote changes to other files are merged without conflict", async () => {
  const { fake, repo } = await setup();
  await repo.write("README.md", "mine");
  await fake.commit({ "work/Plan.md": "theirs" });
  const r = await repo.sync();
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(fake.files(), { "README.md": "mine", "work/Plan.md": "theirs" });
});

test("editing the same note on both sides keeps both", async () => {
  const { fake, repo } = await setup();
  await repo.write("work/Plan.md", "mine");
  await fake.commit({ "work/Plan.md": "theirs" });
  const r = await repo.sync();
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0], /^work\/Plan \(conflict \d{4}-\d\d-\d\d \d{4}\)\.md$/);
  const files = fake.files();
  assert.equal(files["work/Plan.md"], "theirs");
  assert.equal(files[r.conflicts[0]], "mine");
});

test("deleted remotely, edited locally: ours is recreated", async () => {
  const { fake, repo } = await setup();
  await repo.write("work/Plan.md", "mine");
  await fake.commit({ "work/Plan.md": null });
  await repo.sync();
  assert.equal(fake.files()["work/Plan.md"], "mine");
});

test("the branch moving during a push is retried", async () => {
  const { fake, repo } = await setup();
  await repo.write("README.md", "mine");
  let raced = false;
  fake.onRequest = async (method, path) => {
    if (!raced && method === "PATCH" && path.includes("/git/refs/")) {
      raced = true;
      await fake.commit({ "Other.md": "someone else" });
    }
  };
  await repo.sync();
  assert.deepEqual(fake.files(), { "README.md": "mine", "work/Plan.md": "plan", "Other.md": "someone else" });
});

test("edits made during a push stay queued", async () => {
  const { fake, repo } = await setup();
  await repo.write("README.md", "one");
  fake.onRequest = async (method) => {
    if (method === "POST") {
      fake.onRequest = undefined;
      await repo.write("README.md", "two");
    }
  };
  const before = fake.commits.size;
  await repo.sync(); // pushes "one", sees the newer edit and pushes "two" as well
  assert.equal(fake.files()["README.md"], "two");
  assert.equal(fake.commits.size, before + 2);
  assert.equal(repo.dirtyCount, 0);
});

test("offline: changes survive a reload and are pushed later", async () => {
  const { fake, repo, store } = await setup();
  await repo.prefetch();
  fake.offline = true;
  await repo.write("Offline.md", "written offline");
  await assert.rejects(repo.sync());
  const again = new NotesRepo(repo.gh, repo.ref, store);
  await again.open();
  assert.equal(await again.text("Offline.md"), "written offline");
  assert.equal(await again.text("README.md"), "# Hi"); // cached from the first session
  fake.offline = false;
  await again.sync();
  assert.equal(fake.files()["Offline.md"], "written offline");
});

test("empty repository: first push uses the contents API", async () => {
  const { fake, repo } = await setup({});
  assert.deepEqual(repo.paths(), []);
  await repo.write("First.md", "hello");
  await repo.write("Second.md", "world");
  await repo.sync();
  assert.deepEqual(fake.files(), { "First.md": "hello", "Second.md": "world" });
  assert.equal(repo.dirtyCount, 0);
});

test("binary files are uploaded as blobs", async () => {
  const { fake, repo } = await setup();
  const png = new Uint8Array([137, 80, 78, 71, 0, 1, 2, 255]);
  await repo.writeBinary("assets/a.png", png);
  await repo.sync();
  const sha = fake.trees.get(fake.commits.get(fake.refs.get("main")!)!.tree)!["assets/a.png"];
  assert.deepEqual([...fake.blobs.get(sha)!], [...png]);
  assert.deepEqual([...(await repo.bytes("assets/a.png"))], [...png]);
});

test("history lists commits touching a note", async () => {
  const { fake, repo } = await setup();
  await fake.commit({ "work/Plan.md": "v2" }, "second");
  await fake.commit({ "README.md": "x" }, "unrelated");
  const h = await repo.gh.history(repo.ref, "work/Plan.md");
  assert.deepEqual(h.map((c) => c.message), ["second", "init"]);
  const old = await repo.gh.fileAt(repo.ref, "work/Plan.md", h[1].sha);
  assert.equal(new TextDecoder().decode(old!), "plan");
});

test("path helpers", () => {
  assert.equal(resolveLink("a/b/Note.md", "../x/y.md"), "a/x/y.md");
  assert.equal(resolveLink("a/Note.md", "img%20one.png"), "a/img one.png");
  assert.equal(resolveLink("a/Note.md", "/assets/p.png"), "assets/p.png");
  assert.equal(resolveLink("a/Note.md", "https://x.org"), null);
  assert.equal(resolveLink("a/Note.md", "#top"), null);
  assert.equal(relativeLink("a/b/Note.md", "assets/x y.png"), "../../assets/x%20y.png");
  assert.equal(relativeLink("Note.md", "assets/x.png"), "assets/x.png");
  assert.equal(relativeLink("assets/n.md", "assets/x.png"), "x.png");
  assert.equal(cleanName('  a/b:c*  "d" '), "a b c d");
  assert.equal(cleanName("...hidden"), "hidden");
  assert.equal(uniquePath("N.md", (p) => p === "N.md" || p === "N 2.md"), "N 3.md");
});
