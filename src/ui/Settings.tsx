// Settings, sync queue, shortcuts, support and about.

import { useState } from "preact/hooks";
import { titleOf } from "../core/paths";
import { fmtAgo, LANGS, mod, t } from "../i18n";
import { noteHref } from "../router";
import { setSetting, settings, type Settings as S } from "../settings";
import { disconnect, githubUrl, replaceToken, rev, runSync, session, sync, toast } from "../state";
import { confirm, prompt } from "./dialogs";
import { IconCopy, IconExternal, IconGitHub, IconHeart, IconRefresh, Logo } from "./icons";
import { installPrompt, install } from "../pwa";

export const VERSION = "1.0.0";
export const URLS = {
  repo: "https://github.com/Perruer/notewing",
  issues: "https://github.com/Perruer/notewing/issues",
  boosty: "https://boosty.to/mikio_kuroki/donate",
  original: "https://github.com/batnoter/batnoter",
};
export const WALLETS = [
  { name: "USDT / TRX (TRON, TRC-20)", address: "TXUBW4e88SDTfrnJRKfbhYfFcggufbonc1" },
  { name: "ETH / USDT / USDC (Ethereum, BSC, Polygon…)", address: "0x1378491169064702786b2E5b58c6375776177E8A" },
  { name: "TON / USDT (TON)", address: "UQAhI7EKzoa-JuKOfv0ULMzA3FrmpxsDkXj8Qevwj2z1cMRN" },
];

function Toggle({ k, label, hint }: { k: keyof S; label: string; hint?: string }) {
  return (
    <label class="setting toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={!!settings.value[k]} onChange={(e) => setSetting(k, e.currentTarget.checked as never)} />
    </label>
  );
}

function Select<K extends keyof S>({ k, label, options }: { k: K; label: string; options: [S[K], string][] }) {
  return (
    <label class="setting">
      <span>{label}</span>
      <select value={String(settings.value[k])} onChange={(e) => setSetting(k, options.find((o) => String(o[0]) === e.currentTarget.value)![0])}>
        {options.map(([v, l]) => (
          <option value={String(v)}>{l}</option>
        ))}
      </select>
    </label>
  );
}

export function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast(t("copied")),
    () => toast(text),
  );
}

export function SupportSection() {
  return (
    <section class="settings-section support" id="support">
      <h2>
        <IconHeart size={18} /> {t("supportTitle")}
      </h2>
      <p>{t("supportText")}</p>
      <a class="btn primary" href={URLS.boosty} target="_blank" rel="noopener noreferrer">
        {t("supportBoosty")}
      </a>
      <p class="muted small">{t("supportCrypto")}</p>
      <ul class="wallets">
        {WALLETS.map((w) => (
          <li key={w.address}>
            <span class="wallet-name">{w.name}</span>
            <code>{w.address}</code>
            <button class="icon-btn" onClick={() => copy(w.address)} title={t("copy")} aria-label={t("copy")}>
              <IconCopy size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SettingsView() {
  const s = session.value!;
  rev.value;
  const [, force] = useState(0);
  const pending = Object.entries(s.repo.pending).sort((a, b) => b[1].time - a[1].time);
  const st = sync.value;

  const leave = async () => {
    const n = s.repo.dirtyCount;
    const text = s.demo ? t("leaveDemoText") : n ? t("disconnectDirty", n) : t("disconnectText");
    if (await confirm(s.demo ? t("leaveDemo") : t("disconnect"), text, s.demo ? t("leaveDemo") : t("disconnect"), n > 0 && !s.demo)) disconnect();
  };

  const shortcuts: [string, string][] = [
    [`${mod}+K`, t("scSearch")],
    ["Alt+N", t("scNewNote")],
    [`${mod}+S`, t("scSync")],
    [`${mod}+E`, t("scToggleMode")],
    [`${mod}+Shift+F`, t("focusMode")],
    [`${mod}+\\`, t("scSidebar")],
    [`${mod}+B / ${mod}+I`, t("scBoldItalic")],
    [`${mod}+F`, t("scFind")],
  ];

  return (
    <div class="settings">
      <h1>{t("settings")}</h1>

      <section class="settings-section">
        <h2>{t("repository")}</h2>
        <div class="repo-card">
          {s.user.avatar_url ? <img src={s.user.avatar_url} alt="" width={40} height={40} /> : <Logo size={40} />}
          <div>
            <strong>
              {s.repo.ref.owner}/{s.repo.ref.repo}
            </strong>
            <div class="muted small">
              {t("branch")}: {s.repo.ref.branch} · {s.demo ? t("demoMode") : `@${s.user.login}`}
            </div>
          </div>
        </div>
        <div class="row-actions">
          {!s.demo && (
            <a class="btn" href={githubUrl()} target="_blank" rel="noopener noreferrer">
              <IconGitHub size={16} /> {t("openOnGitHub")}
            </a>
          )}
          {!s.demo && (
            <button
              class={`btn ${st.auth ? "primary" : ""}`}
              onClick={async () => {
                const token = await prompt(t("changeToken"), {
                  label: t("token"),
                  ok: t("save"),
                  hint: t("changeTokenHint"),
                  validate: (v) => (v.trim() ? null : t("errEmptyName")),
                });
                if (token === null) return;
                try {
                  await replaceToken(token);
                  toast(t("tokenUpdated"));
                } catch (e) {
                  toast((e as Error).message, { kind: "error" });
                }
              }}
            >
              {t("changeToken")}
            </button>
          )}
          <button class="btn" onClick={leave}>
            {s.demo ? t("leaveDemo") : t("disconnect")}
          </button>
        </div>
      </section>

      <section class="settings-section">
        <h2>{t("sync")}</h2>
        <Toggle k="autoSync" label={t("autoSync")} hint={t("autoSyncHint")} />
        <div class="setting">
          <span>
            {st.busy ? t("syncing") : st.last ? t("lastSync", fmtAgo(st.last)) : t("neverSynced")}
            {st.error && <small class="field-error">{st.error}</small>}
          </span>
          <button class="btn" onClick={() => runSync()} disabled={st.busy}>
            <IconRefresh size={16} /> {t("syncNow")}
          </button>
        </div>
        {pending.length > 0 && (
          <>
            <h3>{t("pendingChanges", pending.length)}</h3>
            <ul class="pending-list">
              {pending.map(([path, c]) => (
                <li key={path}>
                  <span class={`badge ${c.del ? "del" : c.base === null ? "new" : "mod"}`}>{c.del ? t("chDeleted") : c.base === null ? t("chNew") : t("chChanged")}</span>
                  {c.del ? <span class="p">{path}</span> : <a href={noteHref(path)} class="p">{path}</a>}
                  <button
                    class="btn small"
                    onClick={async () => {
                      if (await confirm(t("discard"), t("discardText", titleOf(path)), t("discard"), true)) {
                        await s.repo.discard(path);
                        force((x) => x + 1);
                      }
                    }}
                  >
                    {t("discard")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section class="settings-section">
        <h2>{t("editor")}</h2>
        <Select k="mode" label={t("defaultView")} options={[["edit", t("modeEdit")], ["split", t("modeSplit")], ["preview", t("modePreview")]]} />
        <Select k="editorFont" label={t("editorFont")} options={[["sans", t("fontSans")], ["mono", t("fontMono")]]} />
        <Select k="fontSize" label={t("fontSize")} options={[14, 15, 16, 17, 18, 20].map((n) => [n, `${n} px`])} />
        <Toggle k="spellcheck" label={t("spellcheck")} />
        <label class="setting">
          <span>
            {t("imagesFolder")}
            <small>{t("imagesFolderHint")}</small>
          </span>
          <input
            class="short"
            value={settings.value.assetsDir}
            onChange={(e) => setSetting("assetsDir", e.currentTarget.value.replace(/^\/+|\/+$/g, "").trim() || "assets")}
          />
        </label>
      </section>

      <section class="settings-section">
        <h2>{t("appearance")}</h2>
        <Select k="theme" label={t("theme")} options={[["system", t("themeSystem")], ["light", t("themeLight")], ["dark", t("themeDark")]]} />
        <Select k="lang" label={t("language")} options={[["auto", t("langAuto")], ...LANGS]} />
        {installPrompt.value && (
          <div class="setting">
            <span>
              {t("installApp")}
              <small>{t("installHint")}</small>
            </span>
            <button class="btn" onClick={install}>
              {t("install")}
            </button>
          </div>
        )}
      </section>

      <section class="settings-section">
        <h2>{t("shortcuts")}</h2>
        <table class="shortcuts">
          <tbody>
            {shortcuts.map(([k, v]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <SupportSection />

      <section class="settings-section about">
        <h2>{t("about")}</h2>
        <p>
          <strong>Notewing {VERSION}</strong> · {t("aboutText")}
        </p>
        <p class="muted small">
          {t("basedOn")}{" "}
          <a href={URLS.original} target="_blank" rel="noopener noreferrer">
            BatNoter
          </a>{" "}
          (MIT, © 2022 batnoter).
        </p>
        <div class="row-actions">
          <a class="btn" href={URLS.repo} target="_blank" rel="noopener noreferrer">
            <IconGitHub size={16} /> {t("sourceCode")}
          </a>
          <a class="btn" href={URLS.issues} target="_blank" rel="noopener noreferrer">
            <IconExternal size={16} /> {t("reportIssue")}
          </a>
        </div>
      </section>
    </div>
  );
}
