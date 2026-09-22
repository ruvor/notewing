// README screenshots (EN and RU, 1280×800) and the demo GIF, taken from the production build
// in demo mode: the notes are the built-in samples, nothing is sent anywhere.
//   node scripts/media.mjs              build, screenshots, GIF (the GIF needs ffmpeg)
//   node scripts/media.mjs --no-gif | --gif-only

import { execFileSync, execSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import puppeteer from "puppeteer";

const root = resolve(".");
const dist = join(root, "dist");
const W = 1280;
const H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

execSync("npx vite build", { stdio: "ignore" });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = join(dist, p);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://localhost:${server.address().port}`;

const browser = await puppeteer.launch({ args: ["--no-proxy-server", "--hide-scrollbars", "--font-render-hinting=none"] });

async function demoPage({ lang, theme = "light", width = W, height = H, mobile = false, settings = {} }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await page.evaluateOnNewDocument(
    (s) => {
      localStorage.setItem("notewing.settings", JSON.stringify(s));
      localStorage.setItem("notewing.expanded", JSON.stringify(s.__expanded || []));
    },
    { lang, mode: "split", ...settings },
  );
  await page.goto(ORIGIN + "/", { waitUntil: "networkidle0" });
  return { ctx, page };
}

async function enterDemo(page) {
  await page.click(".setup-intro .btn");
  await page.waitForSelector(".sidebar, .drawer-btn");
  await sleep(600);
}

const go = async (page, hash) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await sleep(700);
};
const note = (p) => "#/note/" + p.split("/").map(encodeURIComponent).join("/");

const NAMES = {
  en: { welcome: "Welcome.md", plan: "Work/Project plan.md", cheat: "Help/Markdown cheatsheet.md", folders: ["Work", "Personal"], query: "pancakes" },
  ru: { welcome: "Добро пожаловать.md", plan: "Работа/План проекта.md", cheat: "Справка/Шпаргалка по Markdown.md", folders: ["Работа", "Личное"], query: "блины" },
};

async function scenes(lang) {
  const n = NAMES[lang];
  const out = join(root, "docs/screenshots", lang);
  await mkdir(out, { recursive: true });
  const shot = (page, name) => page.screenshot({ path: join(out, name) });

  {
    const { ctx, page } = await demoPage({ lang, settings: { __expanded: n.folders } });
    await shot(page, "07-connect.png");
    await enterDemo(page);
    await go(page, note(n.welcome));
    await shot(page, "01-editor.png");

    await go(page, "#/");
    await shot(page, "02-notes.png");

    await page.keyboard.down("Control");
    await page.keyboard.press("k");
    await page.keyboard.up("Control");
    await page.waitForSelector(".palette input");
    await sleep(200);
    await page.keyboard.type(n.query, { delay: 30 });
    await sleep(500);
    await shot(page, "03-search.png");
    await page.keyboard.press("Escape");

    // A second version for the history view.
    await go(page, note(n.plan));
    await page.click(".cm-content");
    await page.keyboard.down("Control");
    await page.keyboard.press("End");
    await page.keyboard.up("Control");
    await page.keyboard.type(lang === "ru" ? "\n- Нет тестового стенда" : "\n- No test environment yet");
    await sleep(500);
    await page.keyboard.down("Control");
    await page.keyboard.press("s");
    await page.keyboard.up("Control");
    await sleep(1200);
    await page.click(".note-actions > button.icon-btn"); // history
    await page.waitForSelector(".history-list button");
    const items = await page.$$(".history-list button");
    await items[items.length - 1].click();
    await sleep(700);
    await shot(page, "04-history.png");
    await ctx.close();
  }

  {
    const { ctx, page } = await demoPage({ lang, theme: "dark", settings: { __expanded: ["Help", "Справка"] } });
    await enterDemo(page);
    await go(page, note(n.cheat));
    await shot(page, "05-dark.png");
    await ctx.close();
  }

  {
    const { ctx, page } = await demoPage({ lang, width: 390, height: 780, mobile: true, settings: { mode: "edit" } });
    await enterDemo(page);
    await go(page, note(n.plan));
    await shot(page, "06-phone.png");
    await ctx.close();
  }
  console.log(`wrote docs/screenshots/${lang}/`);
}

const CURSOR = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.6L10 19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

/** Demo GIF: open a note, write, see the preview, tick a task, search. */
async function gif() {
  const tmp = join(root, "dist-media/gif");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const { ctx, page } = await demoPage({ lang: "en", settings: { __expanded: ["Personal"] } });
  await enterDemo(page);
  await page.evaluate((svg) => {
    const c = document.createElement("div");
    c.id = "fake-cursor";
    c.innerHTML = svg;
    Object.assign(c.style, { position: "fixed", left: "640px", top: "500px", zIndex: "2147483647", pointerEvents: "none" });
    document.documentElement.appendChild(c);
  }, CURSOR);

  const frames = [];
  let mouse = { x: 640, y: 500 };
  const frame = async (duration) => {
    const file = join(tmp, `f${String(frames.length).padStart(3, "0")}.png`);
    await page.screenshot({ path: file });
    frames.push({ file, duration });
  };
  const move = async (x, y, steps = 8) => {
    const from = mouse;
    for (let i = 1; i <= steps; i++) {
      const p = { x: from.x + ((x - from.x) * i) / steps, y: from.y + ((y - from.y) * i) / steps };
      await page.mouse.move(p.x, p.y);
      await page.evaluate((p) => Object.assign(document.getElementById("fake-cursor").style, { left: `${p.x - 3}px`, top: `${p.y - 2}px` }), p);
      await frame(0.05);
    }
    mouse = { x, y };
  };
  const center = (css, text) =>
    page.evaluate(
      (css, text) => {
        const el = [...document.querySelectorAll(css)].find((e) => !text || e.textContent.includes(text));
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      },
      css,
      text,
    );
  const clickAt = async (css, text, pause = 400) => {
    const c = await center(css, text);
    await move(c.x, c.y);
    await page.mouse.click(c.x, c.y);
    await sleep(pause);
  };
  const type = async (s) => {
    for (const ch of s) {
      await page.keyboard.type(ch);
      await sleep(25);
      await frame(0.07);
    }
  };

  await frame(1.0);
  await clickAt(".sidebar .row-link", "Reading list", 700);
  await frame(1.0);
  // Write a new task at the end of the list.
  const c = await center(".cm-line", "Philosophy");
  await move(c.x + 200, c.y);
  await page.mouse.click(c.x + 200, c.y);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await sleep(200);
  await frame(0.3);
  await type("*Refactoring* by Martin Fowler");
  await frame(0.8);
  await clickAt(".preview-pane input[data-task='1']", undefined, 500);
  await frame(1.2);
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await page.waitForSelector(".palette input");
  await sleep(200);
  await frame(0.4);
  await type("flour");
  await sleep(300);
  await frame(1.2);
  await page.keyboard.press("Enter");
  await sleep(800);
  await frame(2.2);

  const list =
    frames.map((f) => `file '${f.file.replaceAll("\\", "/")}'\nduration ${f.duration}`).join("\n") + `\nfile '${frames.at(-1).file.replaceAll("\\", "/")}'\n`;
  await writeFile(join(tmp, "frames.txt"), list);
  const out = join(root, "docs/demo.gif");
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(tmp, "frames.txt"),
    "-vf", "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    "-loop", "0", out,
  ]);
  console.log(`wrote docs/demo.gif (${frames.length} frames)`);
  await ctx.close();
}

if (!process.argv.includes("--gif-only")) {
  await scenes("en");
  await scenes("ru");
}
if (!process.argv.includes("--no-gif")) await gif();
await browser.close();
server.close();
