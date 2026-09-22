import { effect, signal } from "@preact/signals";

export interface Settings {
  theme: "system" | "light" | "dark";
  lang: "auto" | "en" | "ru" | "zh";
  autoSync: boolean;
  mode: "edit" | "split" | "preview";
  editorFont: "sans" | "mono";
  fontSize: number;
  spellcheck: boolean;
  assetsDir: string;
  sidebar: boolean;
}

export const DEFAULTS: Settings = {
  theme: "system",
  lang: "auto",
  autoSync: true,
  mode: "edit",
  editorFont: "sans",
  fontSize: 16,
  spellcheck: true,
  assetsDir: "assets",
  sidebar: true,
};

const KEY = "notewing.settings";

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = signal<Settings>(load());

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  settings.value = { ...settings.value, [key]: value };
}

effect(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.value));
  } catch {}
});

// Theme: data-theme on <html> overrides the system preference.
effect(() => {
  const t = settings.value.theme;
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
});
