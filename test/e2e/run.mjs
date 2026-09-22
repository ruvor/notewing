// End-to-end tests: the production build in Chrome (and Firefox when available), with requests
// to api.github.com answered by the in-memory FakeGitHub.
//   npm run test:e2e            (builds first)
//   node --import tsx test/e2e/run.mjs [--browser=chrome|firefox|all] [--headful]

import { execSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import puppeteer from "puppeteer";
import { FakeGitHub } from "../../src/core/fake.ts";

const args = process.argv.slice(2);
const which = (args.find((a) => a.startsWith("--browser=")) || "--browser=chrome").split("=")[1];
const headless = !args.includes("--headful");
const root = resolve("dist");
if (!args.includes("--no-build")) execSync("npx vite build", { stdio: "inherit" });

// ---- static server for dist/ ----
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = join(root, p);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://localhost:${server.address().port}`;

// ---- helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const results = [];

async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failures++;
    results.push(`  ✗ ${name}\n      ${String(e?.stack || e).split("\n").slice(0, 3).join("\n      ")}`);
  }
  console.log(results.at(-1));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitFor(fn, msg, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw new Error(`Timed out: ${msg} (last: ${last})`);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-GitHub-Api-Version",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

/** Routes api.github.com to the fake. `state.token` is the accepted token. */
async function wire(page, fake, state) {
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const url = req.url();
    if (!url.startsWith("https://api.github.com/")) {
      if (url.startsWith(ORIGIN) || url.startsWith("data:") || url.startsWith("blob:")) return req.continue();
      return req.abort(); // no other network in tests
    }
    if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: CORS, body: "" });
    try {
      const auth = req.headers()["authorization"] || "";
      if (auth !== `Bearer ${state.token}`) {
        return req.respond({ status: 401, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ message: "Bad credentials" }) });
      }
      let body;
      if (req.method() !== "GET") {
        try {
          body = req.postData(); // Chrome
        } catch {
          body = await req.fetchPostData(); // Firefox (WebDriver BiDi)
        }
      }
      const res = await fake.fetch(url, { method: req.method(), headers: req.headers(), body });
      const out = Buffer.from(await res.arrayBuffer());
      req.respond({ status: res.status, headers: { ...CORS, "Content-Type": res.headers.get("content-type") || "application/octet-stream" }, body: out });
    } catch (e) {
      req.abort("internetdisconnected");
    }
  });
}

async function seed() {
  const fake = new FakeGitHub("alice", "notes", "main");
  // Layout of a BatNoter repository: .md files in folders, plus other files that must be ignored.
  await fake.commit(
    {
      "README.md": "# My notes\n",
      "work/Plan.md": "# Plan\n\n- [ ] first\n- [x] second\n",
      "work/Ideas.md": "Ideas about **pancakes** and flour",
      "journal/2022/March.md": "Old entry from BatNoter",
      ".github/config.md": "hidden",
      "images/logo.png": new Uint8Array([137, 80, 78, 71]),
    },
    "Created with BatNoter",
  );
  return fake;
}

const TOKEN = "github_pat_test";

const text = (page, sel) => page.$eval(sel, (el) => el.textContent);
const hashPath = (p) => "#/note/" + p.split("/").map(encodeURIComponent).join("/");

async function openNote(page, path) {
  await page.evaluate((h) => (location.hash = h), hashPath(path));
  await page.waitForSelector(".cm-content");
  await waitFor(() => page.$eval(".cm-content", (el) => el.textContent.length > 0 || true), "editor");
}

async function typeInEditor(page, s, { end = true } = {}) {
  await page.click(".cm-content");
  if (end) {
    await page.keyboard.down("Control");
    await page.keyboard.press("End");
    await page.keyboard.up("Control");
  }
  await page.keyboard.type(s);
}

async function syncNow(page) {
  await page.keyboard.down("Control");
  await page.keyboard.press("s");
  await page.keyboard.up("Control");
}

// ---- the suite ----

async function suite(browserName) {
  const launch =
    browserName === "firefox"
      ? { browser: "firefox", headless, args: [] }
      : { headless, args: ["--no-proxy-server", "--lang=en-US"] };
  const browser = await puppeteer.launch(launch);
  console.log(`\n${browserName} ${await browser.version()}`);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  const errors = [];
  page.on("pageerror", (e) => {
    // Firefox reports requests the test aborts (offline simulation) as page errors.
    if (!/CORS request did not succeed/.test(e.message)) errors.push(e.message);
  });
  page.on("dialog", (d) => {
    errors.push("unexpected dialog: " + d.message());
    d.dismiss();
  });
  const fake = await seed();
  const state = { token: TOKEN };
  await wire(page, fake, state);

  await check("connect with a token and see the BatNoter repository", async () => {
    await page.goto(ORIGIN + "/", { waitUntil: "networkidle0" });
    await page.evaluate(() => localStorage.setItem("notewing.settings", JSON.stringify({ lang: "en", mode: "edit" })));
    await page.reload({ waitUntil: "networkidle0" });
    // A wrong token is refused with a clear message.
    state.token = "other";
    await page.type('.setup-card input[type="password"]', TOKEN);
    await page.type('.setup-card input[list="nw-repos"]', "alice/notes");
    await page.click(".setup-card button.primary");
    await waitFor(() => page.$eval(".field-error", (e) => e.textContent.includes("did not accept")), "token error");
    state.token = TOKEN;
    await page.click(".setup-card button.primary");
    await page.waitForSelector(".sidebar .tree");
    await waitFor(async () => (await text(page, ".tree")).includes("journal"), "tree");
    const tree = await text(page, ".tree");
    assert(tree.includes("work") && tree.includes("README"), "folders and notes");
    assert(!tree.includes("config") && !tree.includes("logo"), "hidden and non-note files are not shown: " + tree);
  });

  await check("folder cards show previews", async () => {
    await page.evaluate(() => (location.hash = "#/folder/work"));
    await waitFor(async () => (await text(page, ".cards")).includes("Ideas about pancakes"), "excerpt");
  });

  await check("edit a note and push it with Ctrl+S", async () => {
    await openNote(page, "work/Ideas.md");
    await waitFor(async () => (await text(page, ".cm-content")).includes("pancakes"), "content");
    await typeInEditor(page, "\nAdded in the browser");
    await waitFor(async () => (await text(page, ".sync-status")).includes("unsynced"), "dirty state");
    await sleep(400);
    await syncNow(page);
    await waitFor(() => fake.files()["work/Ideas.md"]?.includes("Added in the browser"), "pushed to GitHub");
    const msg = fake.commits.get(fake.refs.get("main")).message;
    assert(msg === "Update work/Ideas.md", "commit message: " + msg);
    await waitFor(async () => (await text(page, ".sync-status")).includes("Synced"), "synced state");
  });

  await check("auto-sync pushes after a pause", async () => {
    await typeInEditor(page, " (auto)");
    await waitFor(() => fake.files()["work/Ideas.md"]?.includes("(auto)"), "auto-synced", 12000);
  });

  await check("new note with Alt+N, title becomes the file name", async () => {
    await page.evaluate(() => (location.hash = "#/folder/work"));
    await page.waitForSelector(".cards");
    await page.keyboard.down("Alt");
    await page.keyboard.press("KeyN");
    await page.keyboard.up("Alt");
    await page.waitForSelector("input.note-title");
    await waitFor(() => page.evaluate(() => document.activeElement?.classList.contains("note-title")), "title focused");
    await page.keyboard.type("Shopping list");
    await page.keyboard.press("Enter");
    await waitFor(() => page.evaluate(() => location.hash.includes("Shopping%20list.md")), "navigated to the new note");
    await page.keyboard.type("- [ ] milk");
    await sleep(400);
    await syncNow(page);
    await waitFor(() => fake.files()["work/Shopping list.md"] === "- [ ] milk", "new file on GitHub").catch(async (e) => {
      throw new Error(`${e.message}; files: ${Object.keys(fake.files())}; editor: ${await text(page, ".cm-content")}; status: ${await text(page, ".sync-status")}; hash: ${await page.evaluate(() => location.hash)}`);
    });
  });

  await check("toggle a task in the preview", async () => {
    await page.click(".segmented button:last-child"); // preview
    try {
      await page.waitForSelector(".preview-pane input[data-task]");
      await page.click(".preview-pane input[data-task='0']");
      await waitFor(async () => {
        await syncNow(page);
        return fake.files()["work/Shopping list.md"] === "- [x] milk";
      }, "task toggled");
    } finally {
      await page.click(".segmented button:first-child"); // back to the editor
    }
  });

  await check("rename a note through its title", async () => {
    await page.waitForSelector("input.note-title");
    await page.click("input.note-title");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.type("Groceries");
    await page.keyboard.press("Enter");
    await waitFor(() => page.evaluate(() => location.hash.includes("Groceries.md")), "route follows the rename");
    await syncNow(page);
    await waitFor(() => fake.files()["work/Groceries.md"] && !fake.files()["work/Shopping list.md"], "renamed on GitHub");
    const msg = fake.commits.get(fake.refs.get("main")).message;
    assert(msg === "Move work/Shopping list.md → work/Groceries.md", msg);
  });

  await check("search finds text inside notes and opens the note", async () => {
    await page.keyboard.down("Control");
    await page.keyboard.press("k");
    await page.keyboard.up("Control");
    await page.waitForSelector(".palette input");
    await sleep(100);
    await page.keyboard.type("batnoter");
    await waitFor(async () => (await text(page, ".palette-results")).includes("March"), "search result");
    await page.keyboard.press("Enter");
    await waitFor(() => page.evaluate(() => decodeURIComponent(location.hash).includes("journal/2022/March.md")), "opened");
  });

  await check("paste an image: stored in assets/, shown in the preview", async () => {
    await openNote(page, "README.md");
    await page.click(".cm-content");
    await page.evaluate(() => {
      const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "screen shot.png", { type: "image/png" }));
      const target = document.querySelector(".cm-content");
      const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      if (ev.clipboardData?.files.length) target.dispatchEvent(ev);
      else target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 500, clientY: 300 }));
    });
    await waitFor(async () => /!\[screen-shot\]\(assets\/\d{8}-\d{6}-screen-shot\.png\)/.test(await text(page, ".cm-content")), "markdown inserted");
    await page.click(".segmented button:nth-child(3)"); // preview
    await waitFor(() => page.$eval(".preview-pane img", (img) => img.src.startsWith("blob:") && img.naturalWidth === 1), "image loaded from the repository copy");
    await page.click(".segmented button:first-child");
    await syncNow(page);
    await waitFor(() => Object.keys(fake.files()).some((p) => /^assets\/\d{8}-\d{6}-screen-shot\.png$/.test(p)), "image committed");
  });

  await check("rendered notes are sanitised", async () => {
    await fake.commit({ "xss.md": '<img src="x" onerror="window.__pwned=1"><script>window.__pwned=2</script>[a](javascript:window.__pwned=3)\n\n<a href="https://example.org">ext</a>' });
    await syncNow(page);
    await waitFor(() => page.evaluate(() => document.querySelector(".tree").textContent.includes("xss")), "note arrived");
    await openNote(page, "xss.md");
    await page.click(".segmented button:nth-child(3)");
    await page.waitForSelector(".preview-pane .markdown");
    await page.evaluate(() => document.querySelector(".preview-pane a")?.click());
    await sleep(300);
    const r = await page.evaluate(() => ({
      pwned: window.__pwned,
      html: document.querySelector(".preview-pane .markdown").innerHTML,
    }));
    assert(r.pwned === undefined, "script ran: " + r.pwned);
    assert(!/onerror|<script|javascript:/i.test(r.html), "unsafe markup kept: " + r.html);
    assert(r.html.includes('target="_blank"') && r.html.includes("noopener"), "external links open in a new tab");
    await page.click(".segmented button:first-child");
  });

  await check("remote changes are pulled into an open note", async () => {
    await openNote(page, "work/Plan.md");
    await fake.commit({ "work/Plan.md": "# Plan\n\nchanged on another device" });
    await syncNow(page);
    await waitFor(async () => (await text(page, ".cm-content")).includes("another device"), "editor updated").catch(async (e) => {
      throw new Error(`${e.message}; editor: ${await text(page, ".cm-content")}; status: ${await text(page, ".sync-status")}; requests: ${fake.requests.slice(-8).join(" | ")}`);
    });
  });

  await check("offline: edits survive a reload and are pushed when back online", async () => {
    await openNote(page, "work/Plan.md");
    fake.offline = true;
    await typeInEditor(page, "\nwritten offline");
    await sleep(500);
    await syncNow(page);
    await waitFor(async () => (await text(page, ".sync-status")).includes("Offline"), "offline status");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".cm-content");
    await waitFor(async () => (await text(page, ".cm-content")).includes("written offline"), "kept after reload");
    assert(!fake.files()["work/Plan.md"].includes("offline"), "not pushed yet");
    fake.offline = false;
    await syncNow(page);
    await waitFor(() => fake.files()["work/Plan.md"].includes("written offline"), "pushed after reconnecting");
  });

  await check("conflict: both versions are kept", async () => {
    fake.offline = true;
    await typeInEditor(page, "\nmine");
    await sleep(500);
    await fake.commit({ "work/Plan.md": "theirs" });
    fake.offline = false;
    await syncNow(page);
    await waitFor(() => Object.keys(fake.files()).some((p) => p.startsWith("work/Plan (conflict ")), "conflict copy pushed");
    const files = fake.files();
    const copy = Object.keys(files).find((p) => p.startsWith("work/Plan (conflict "));
    assert(files["work/Plan.md"] === "theirs", "remote version kept");
    assert(files[copy].includes("mine"), "local version in the copy");
    await waitFor(async () => (await text(page, ".toasts")).includes("Both versions are kept"), "conflict toast");
  });

  await check("history lists versions and restores one", async () => {
    await openNote(page, "work/Plan.md");
    await page.click('.note-actions button[aria-label="History"]');
    await page.waitForSelector(".history-list button");
    const n = await page.$$eval(".history-list button", (b) => b.length);
    assert(n >= 3, "versions: " + n);
    const buttons = await page.$$(".history-list button");
    await buttons[buttons.length - 1].click(); // the BatNoter original
    await waitFor(async () => (await text(page, ".history-preview")).includes("first"), "old version shown");
    await page.click(".history-tools .btn.primary");
    await waitFor(async () => (await text(page, ".cm-content")).includes("- [ ] first"), "restored in the editor");
    await sleep(500);
    await syncNow(page);
    await waitFor(() => fake.files()["work/Plan.md"].startsWith("# Plan\n\n- [ ] first"), "restored on GitHub");
  });

  await check("drag a note onto a folder in the sidebar", async () => {
    await page.evaluate(() => (location.hash = "#/"));
    await page.waitForSelector(".sidebar .row.note");
    await page.evaluate(() => {
      const src = [...document.querySelectorAll(".sidebar .row.note")].find((r) => r.textContent.includes("README"));
      const dst = [...document.querySelectorAll(".sidebar .row.folder")].find((r) => r.textContent.includes("journal"));
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
      dst.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      dst.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await syncNow(page);
    await waitFor(() => fake.files()["journal/README.md"] && !fake.files()["README.md"], "moved on GitHub");
  });

  await check("delete a note, then undo", async () => {
    await openNote(page, "work/Groceries.md");
    await page.click('.note-actions button[aria-label="More"]');
    await page.waitForSelector(".menu");
    await page.evaluate(() => [...document.querySelectorAll(".menu button")].find((b) => b.textContent.includes("Delete")).click());
    await page.waitForSelector(".modal .btn.danger");
    await page.click(".modal .btn.danger");
    await waitFor(() => page.evaluate(() => location.hash === "#/folder/work"), "back to the folder");
    await page.evaluate(() => [...document.querySelectorAll(".toast-action")].find((b) => b.textContent === "Undo").click());
    await waitFor(async () => (await text(page, ".tree")).includes("Groceries"), "restored");
    await syncNow(page);
    await sleep(800);
    assert(fake.files()["work/Groceries.md"] === "- [x] milk", "still on GitHub");
  });

  await check("expired token: banner, then a new token keeps local changes", async () => {
    await openNote(page, "work/Ideas.md");
    state.token = "rotated";
    await typeInEditor(page, "\nbefore new token");
    await sleep(500);
    await syncNow(page);
    await page.waitForSelector(".banner.error");
    await page.click(".banner.error a");
    await page.waitForSelector(".settings");
    await page.evaluate(() => [...document.querySelectorAll(".settings .btn")].find((b) => b.textContent === "Change token").click());
    await page.waitForSelector(".modal input");
    await page.type(".modal input", "rotated");
    await page.click(".modal .btn.primary");
    await waitFor(() => fake.files()["work/Ideas.md"].includes("before new token"), "pushed with the new token");
    await waitFor(async () => !(await page.$(".banner.error")), "banner gone");
  });

  await check("settings: language, theme and the support section", async () => {
    await page.evaluate(() => (location.hash = "#/settings"));
    await page.waitForSelector(".settings select");
    const selects = await page.$$(".settings-section select");
    // theme and language are the last two selects
    await selects[selects.length - 2].select("dark");
    assert((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "dark theme");
    await selects[selects.length - 1].select("ru");
    await waitFor(async () => (await text(page, ".settings h1")) === "Настройки", "Russian UI");
    const support = await text(page, "#support");
    assert(support.includes("TXUBW4e88SDTfrnJRKfbhYfFcggufbonc1") && support.includes("Boosty"), "wallets");
    await selects[selects.length - 1].select("en");
    await selects[selects.length - 2].select("system");
  });

  await check("works offline after a reload (service worker + IndexedDB)", async () => {
    if (browserName === "firefox") return; // setOfflineMode is Chrome-only
    await page.goto(ORIGIN + "/#/", { waitUntil: "networkidle0" });
    await waitFor(() => page.evaluate(() => navigator.serviceWorker?.controller !== null || navigator.serviceWorker.ready.then(() => false)), "", 3000).catch(() => {});
    await page.reload({ waitUntil: "networkidle0" }); // now controlled by the service worker
    await page.setOfflineMode(true);
    fake.offline = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".sidebar .tree");
    await waitFor(async () => (await text(page, ".tree")).includes("journal"), "notes from the local copy");
    await openNote(page, "work/Ideas.md");
    await waitFor(async () => (await text(page, ".cm-content")).includes("before new token"), "note text offline");
    await page.setOfflineMode(false);
    fake.offline = false;
  });

  await check("phone layout: drawer navigation", async () => {
    await page.setViewport({ width: 390, height: 800 });
    await page.goto(ORIGIN + "/#/", { waitUntil: "networkidle0" });
    await page.waitForSelector(".drawer-btn");
    assert(!(await page.$eval(".sidebar", (s) => s.offsetParent !== null).catch(() => false)), "sidebar hidden");
    await page.click(".drawer-btn");
    await page.waitForSelector(".app.drawer-open .sidebar");
    await page.evaluate(() => [...document.querySelectorAll(".sidebar .row-link")].find((a) => a.textContent.includes("work")).click());
    await waitFor(() => page.evaluate(() => !document.querySelector(".app.drawer-open")), "drawer closes");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert(!overflow, "no horizontal scroll");
    await page.setViewport({ width: 1280, height: 860 });
  });

  await check("demo mode works without a token", async () => {
    const p2 = await ctx.newPage();
    await p2.setRequestInterception(true);
    let external = 0;
    p2.on("request", (r) => (r.url().startsWith(ORIGIN) || r.url().startsWith("blob:") || r.url().startsWith("data:") ? r.continue() : (external++, r.abort())));
    await p2.evaluateOnNewDocument(() => {
      localStorage.removeItem("notewing.session");
    });
    const c3 = await browser.createBrowserContext();
    const p3 = await c3.newPage();
    await p3.setRequestInterception(true);
    p3.on("request", (r) => (r.url().startsWith(ORIGIN) || r.url().startsWith("blob:") || r.url().startsWith("data:") ? r.continue() : (external++, r.abort())));
    await p3.goto(ORIGIN + "/", { waitUntil: "networkidle0" });
    await p3.evaluate(() => localStorage.setItem("notewing.settings", JSON.stringify({ lang: "en" })));
    await p3.reload({ waitUntil: "networkidle0" });
    await p3.click(".setup-intro .btn");
    await p3.waitForSelector(".demo-badge");
    await waitFor(async () => (await text(p3, ".tree")).includes("Welcome"), "demo notes");
    assert(external === 0, "no requests leave the page in demo mode");
    await p2.close();
    await c3.close();
  });

  assert(true);
  if (errors.length) {
    failures++;
    console.log("  ✗ page errors:\n      " + errors.join("\n      "));
  }
  await browser.close();
}

const browsers = which === "all" ? ["chrome", "firefox"] : [which];
for (const b of browsers) {
  try {
    await suite(b);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${b}: ${e.message}`);
  }
}
server.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
