// Service worker registration, update notice and the install prompt.

import { signal } from "@preact/signals";
import { t } from "./i18n";
import { toast } from "./state";

export const installPrompt = signal<any>(null);

addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt.value = e;
});

export async function install() {
  const p = installPrompt.value;
  if (!p) return;
  installPrompt.value = null;
  await p.prompt();
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    const offer = (worker: ServiceWorker) =>
      toast(t("updateReady"), { action: { label: t("reload"), run: () => worker.postMessage("skipWaiting") } }, 60000);
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) offer(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 3600000);
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloading) {
      reloading = true;
      location.reload();
    }
  });
}
