// Renders PNG icons from public/icons/icon.svg.
//   node scripts/icons.mjs
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer";

const svg = await readFile("public/icons/icon.svg", "utf8");
// Full-bleed square (maskable / apple): no rounded corners, the wing scaled into the safe zone.
const square = svg
  .replace('rx="28"', 'rx="0"')
  .replace(/<path fill="#fff"/, '<g transform="translate(64 64) scale(0.78) translate(-64 -64)"><path fill="#fff"')
  .replace(/stroke-linecap="round"\/>/, 'stroke-linecap="round"/></g>');

const jobs = [
  [svg, 192, "public/icons/icon-192.png"],
  [svg, 512, "public/icons/icon-512.png"],
  [square, 512, "public/icons/icon-maskable-512.png"],
  [square, 180, "public/icons/apple-touch-icon.png"],
];

const browser = await puppeteer.launch();
const page = await browser.newPage();
for (const [src, size, out] of jobs) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${src.replace('width="128" height="128"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log("wrote", out);
}
await browser.close();
