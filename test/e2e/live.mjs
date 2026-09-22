// Live test against the real GitHub API. Uses a real repository, so run it only on a
// throw-away repository you own; it creates, edits and deletes files there.
//   NOTEWING_TOKEN=... NOTEWING_REPO=owner/name node test/e2e/live.mjs [--proxy=http://127.0.0.1:7890]
// The repository may be empty (that path is tested too).

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import puppeteer from "puppeteer";

const TOKEN = process.env.NOTEWING_TOKEN;
const REPO = process.env.NOTEWING_REPO;
if (!TOKEN || !REPO) throw new Error("Set NOTEWING_TOKEN and NOTEWING_REPO");
const proxy = process.argv.find((a) => a.startsWith("--proxy="))?.slice(8);
/** --url=https://perruer.github.io/notewing/ tests a deployed copy instead of dist/. */
const remote = process.argv.find((a) => a.startsWith("--url="))?.slice(6);
/** Every run works in its own folder, so the repository can be reused. */
const D = "run-" + Date.now().toString(36);

const root = resolve("dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = join(root, p);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = remote ? remote.replace(/\/$/, "") : `http://localhost:${server.address().port}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n      ${String(e?.message || e).slice(0, 400)}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
async function waitFor(fn, msg, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(500);
  }
  throw new Error(`Timed out: ${msg} (last: ${last})`);
}

const browser = await puppeteer.launch({ args: ["--lang=en-US", ...(proxy ? [`--proxy-server=${proxy}`] : [])] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860 });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));

/** GitHub API call from inside the page (same network path as the app). */
const api = (method, path, body, raw = false) =>
  page.evaluate(
    async (method, path, body, raw, token) => {
      const r = await fetch("https://api.github.com" + path, {
        method,
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: raw ? await r.text() : await r.json().catch(() => null) };
    },
    method,
    path,
    body,
    raw,
    TOKEN,
  );
const file = async (p) => {
  const r = await api("GET", `/repos/${REPO}/contents/${p.split("/").map(encodeURIComponent).join("/")}`, null, true);
  return r.status === 200 ? r.body : null;
};
const listFiles = async () => {
  const ref = await api("GET", `/repos/${REPO}/git/ref/heads/main`);
  if (ref.status !== 200) return [];
  const c = await api("GET", `/repos/${REPO}/git/commits/${ref.body.object.sha}`);
  const t = await api("GET", `/repos/${REPO}/git/trees/${c.body.tree.sha}?recursive=1`);
  return t.body.tree.filter((e) => e.type === "blob").map((e) => e.path);
};
const text = (sel) => page.$eval(sel, (el) => el.textContent);
const syncNow = async () => {
  await page.keyboard.down("Control");
  await page.keyboard.press("s");
  await page.keyboard.up("Control");
};
const typeEnd = async (s) => {
  await page.click(".cm-content");
  await page.keyboard.down("Control");
  await page.keyboard.press("End");
  await page.keyboard.up("Control");
  await page.keyboard.type(s);
};
const open = async (p) => {
  await page.evaluate((h) => (location.hash = h), "#/note/" + p.split("/").map(encodeURIComponent).join("/"));
  await page.waitForSelector(".cm-content");
  await sleep(500);
};

console.log(`live test on ${REPO}`);

await check("connect to the (empty) repository", async () => {
  await page.goto(ORIGIN + "/", { waitUntil: "networkidle0", timeout: 60000 });
  await page.evaluate(() => localStorage.setItem("notewing.settings", JSON.stringify({ lang: "en", mode: "edit", autoSync: false })));
  await page.reload({ waitUntil: "networkidle0" });
  await page.type('.setup-card input[type="password"]', TOKEN);
  await page.type('.setup-card input[list="nw-repos"]', REPO);
  await page.click(".setup-card button.primary");
  await page.waitForSelector(".sidebar .tree", { timeout: 30000 });
  await waitFor(async () => (await text(".sync-status")).includes("Synced"), "synced");
});

await check("first note in an empty repository", async () => {
  await page.evaluate((h) => (location.hash = h), "#/new/" + D);
  await page.waitForSelector("input.note-title");
  await sleep(300);
  await page.keyboard.type("Hello from Notewing");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Первая заметка — live test.");
  await sleep(600);
  await syncNow();
  await waitFor(async () => (await file(`${D}/Hello from Notewing.md`)) === "Первая заметка — live test.", "file on GitHub");
});

await check("note in a folder (Git Data API commit)", async () => {
  await page.evaluate((h) => (location.hash = h), "#/new/" + D + "/work");
  await page.waitForSelector("input.note-title");
  await sleep(300);
  await page.keyboard.type("Plan");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- [ ] one\n- [ ] two");
  await sleep(600);
  await syncNow();
  await waitFor(async () => (await file(`${D}/work/Plan.md`))?.startsWith("- [ ] one"), `${D}/work/Plan.md`);
  const commits = await api("GET", `/repos/${REPO}/commits?per_page=1`);
  assert(commits.body[0].commit.message === `Create ${D}/work/Plan.md`, commits.body[0].commit.message);
});

await check("paste an image, it is committed and shown", async () => {
  await open(`${D}/Hello from Notewing.md`);
  await page.click(".cm-content");
  await page.evaluate(() => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "pixel.png", { type: "image/png" }));
    document.querySelector(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(800);
  await syncNow();
  await waitFor(async () => (await listFiles()).some((p) => /^assets\/.*pixel\.png$/.test(p)), "image in assets/");
  await page.click(".segmented button:last-child");
  await waitFor(() => page.$eval(".preview-pane img", (i) => i.src.startsWith("blob:") && i.naturalWidth === 1), "image shown");
  await page.click(".segmented button:first-child");
});

await check("rename moves the file in one commit", async () => {
  await open(`${D}/work/Plan.md`);
  await page.click("input.note-title");
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type("Plan 2026");
  await page.keyboard.press("Enter");
  await sleep(500);
  await syncNow();
  await waitFor(async () => {
    const f = await listFiles();
    return f.includes(`${D}/work/Plan 2026.md`) && !f.includes(`${D}/work/Plan.md`);
  }, "renamed");
});

await check("change made elsewhere is pulled", async () => {
  const cur = await api("GET", `/repos/${REPO}/contents/${D}/work/Plan%202026.md`);
  await api("PUT", `/repos/${REPO}/contents/${D}/work/Plan%202026.md`, {
    message: "Edit on github.com",
    content: Buffer.from("- [x] one\n- [ ] two\n\nedited on github.com").toString("base64"),
    sha: cur.body.sha,
  });
  await open(`${D}/work/Plan 2026.md`);
  await syncNow();
  await waitFor(async () => (await text(".cm-content")).includes("edited on github.com"), "pulled into the editor");
});

await check("conflict keeps both versions", async () => {
  await page.setOfflineMode(true);
  await typeEnd("\nlocal line");
  await sleep(600);
  await syncNow();
  await sleep(1000);
  await page.setOfflineMode(false);
  const f = await api("GET", `/repos/${REPO}/contents/${D}/work/Plan%202026.md`);
  await api("PUT", `/repos/${REPO}/contents/${D}/work/Plan%202026.md`, {
    message: "Concurrent edit",
    content: Buffer.from("remote version").toString("base64"),
    sha: f.body.sha,
  });
  await syncNow();
  await waitFor(async () => (await listFiles()).some((p) => p.startsWith(`${D}/work/Plan 2026 (conflict `)), "conflict copy");
  assert((await file(`${D}/work/Plan 2026.md`)) === "remote version", "remote kept");
});

await check("history shows the versions", async () => {
  await open(`${D}/work/Plan 2026.md`);
  await page.click('.note-actions button[aria-label="History"]');
  await waitFor(async () => (await page.$$(".history-list button")).length >= 2, "versions listed");
  await page.keyboard.press("Escape");
});

await check("delete a note", async () => {
  await open(`${D}/Hello from Notewing.md`);
  await page.click('.note-actions button[aria-label="More"]');
  await page.evaluate(() => [...document.querySelectorAll(".menu button")].find((b) => b.textContent.includes("Delete")).click());
  await page.waitForSelector(".modal .btn.danger");
  await page.click(".modal .btn.danger");
  await sleep(500);
  await syncNow();
  await waitFor(async () => (await file(`${D}/Hello from Notewing.md`)) === null, "deleted on GitHub");
});

await check("local copy survives a reload", async () => {
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".sidebar .tree");
  await waitFor(async () => (await text(".tree")).includes("Plan 2026"), "tree after reload");
});

await browser.close();
server.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
