// Renders the link preview image (public/og.png, 1200×630) and the GitHub social preview
// (store/social-preview.png, 1280×640). Run after `npm run media`.
//   node scripts/promo.mjs
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer";

const icon = await readFile("public/icons/icon.svg", "utf8");
const shot = (await readFile("docs/screenshots/en/01-editor.png")).toString("base64");

const tile = (w, h) => `<!DOCTYPE html><html><body style="margin:0">
<div style="width:${w}px;height:${h}px;box-sizing:border-box;overflow:hidden;position:relative;
  background:radial-gradient(900px 500px at 0% 0%, #e4e2ff, transparent), linear-gradient(135deg,#f7f7fc,#ecebfb);
  font-family:'Segoe UI',system-ui,sans-serif;color:#1d1d2b;padding:70px 64px">
  <div style="display:flex;align-items:center;gap:18px">
    <div style="width:76px;height:76px">${icon.replace('width="128" height="128"', 'width="76" height="76"')}</div>
    <div style="font-size:50px;font-weight:700;letter-spacing:-1px">Notewing</div>
  </div>
  <div style="font-size:44px;line-height:1.15;font-weight:700;letter-spacing:-1.2px;margin-top:44px;max-width:520px">
    Markdown notes in your own GitHub repository
  </div>
  <div style="font-size:24px;line-height:1.45;color:#5b5b72;margin-top:22px;max-width:480px">
    No server in between. Works offline.<br>Search, images, history. Free &amp; open source.
  </div>
  <img src="data:image/png;base64,${shot}" style="position:absolute;left:${w - 560}px;top:90px;width:900px;border-radius:14px;
    box-shadow:0 24px 70px rgba(40,30,120,.28);border:1px solid #dcdaf0">
</div></body></html>`;

const browser = await puppeteer.launch();
const page = await browser.newPage();
for (const [w, h, out] of [[1200, 630, "public/og.png"], [1280, 640, "store/social-preview.png"]]) {
  await page.setViewport({ width: w, height: h });
  await page.setContent(tile(w, h));
  await page.screenshot({ path: out });
  console.log("wrote", out);
}
await browser.close();
