import preact from "@preact/preset-vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://api.github.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

/** Adds the Content-Security-Policy and writes a service worker that precaches the build. */
function pwa(): Plugin {
  return {
    name: "notewing-pwa",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map") && f !== "sw.js");
      // Precache the app shell; lazily loaded chunks (code-block languages) are cached on use.
      const shell = new Set<string>();
      const add = (f: string) => {
        const b = bundle[f];
        if (!b || shell.has(f)) return;
        shell.add(f);
        if (b.type === "chunk") {
          b.imports.forEach(add);
          (b as any).viteMetadata?.importedCss?.forEach(add);
        }
      };
      for (const [f, b] of Object.entries(bundle)) if (b.type === "chunk" && b.isEntry) add(f);
      for (const f of files) if (!f.endsWith(".js")) shell.add(f);
      const extra = ["manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];
      const assets = ["./", ...[...shell, ...extra].map((f) => "./" + f)];
      const hash = createHash("sha256");
      for (const f of files.sort()) {
        const b = bundle[f];
        hash.update(f).update(b.type === "chunk" ? b.code : typeof b.source === "string" ? b.source : Buffer.from(b.source));
      }
      const version = hash.digest("hex").slice(0, 12);
      const source = readFileSync("src/sw.js", "utf8")
        .replace("__VERSION__", version)
        .replace("__ASSETS__", JSON.stringify(assets, null, 1));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [preact(), pwa()],
  build: {
    target: "es2022",
    modulePreload: { polyfill: false },
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5178 },
  preview: { port: 5179 },
});
