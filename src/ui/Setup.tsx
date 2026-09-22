// First screen: connect a GitHub repository with a fine-grained token, or try the demo.

import { useState } from "preact/hooks";
import { GitHub, type RepoInfo } from "../core/github";
import { LANGS, t } from "../i18n";
import { setSetting, settings } from "../settings";
import { connect, startDemo } from "../state";
import { IconCloudOff, IconExternal, IconGitHub, IconSearch, Logo } from "./icons";
import { URLS } from "./Settings";

const NEW_REPO = "https://github.com/new?name=notes&visibility=private&description=My%20notes%20(Notewing)";
const NEW_TOKEN =
  "https://github.com/settings/personal-access-tokens/new?name=Notewing&description=Notewing%20notes%20app&contents=write";

export function Setup() {
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("");
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadRepos = async () => {
    if (!token.trim() || repos.length) return;
    try {
      const list = await new GitHub(token.trim()).repos();
      setRepos(list);
      if (!repo && list.length === 1) setRepo(list[0].full_name);
    } catch {}
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await connect(token, repo, remember);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const demo = async () => {
    setBusy(true);
    await startDemo();
  };

  return (
    <div class="setup">
      <header class="setup-top">
        <span class="brand">
          <Logo size={30} /> Notewing
        </span>
        <select aria-label={t("language")} value={settings.value.lang} onChange={(e) => setSetting("lang", e.currentTarget.value as any)}>
          <option value="auto">{t("langAuto")}</option>
          {LANGS.map(([v, l]) => (
            <option value={v}>{l}</option>
          ))}
        </select>
      </header>

      <main class="setup-main">
        <section class="setup-intro">
          <h1>{t("tagline")}</h1>
          <p class="lead">{t("intro")}</p>
          <ul class="features">
            <li>
              <IconGitHub size={18} />
              <span>{t("feat1")}</span>
            </li>
            <li>
              <IconCloudOff size={18} />
              <span>{t("feat2")}</span>
            </li>
            <li>
              <IconSearch size={18} />
              <span>{t("feat3")}</span>
            </li>
          </ul>
          <button class="btn big" onClick={demo} disabled={busy}>
            {t("tryDemo")}
          </button>
          <p class="muted small">{t("demoHint")}</p>
        </section>

        <form class="setup-card" onSubmit={submit}>
          <h2>{t("connectTitle")}</h2>
          <ol class="steps">
            <li>
              <strong>{t("step1")}</strong>
              <span>
                {t("step1Text")}{" "}
                <a href={NEW_REPO} target="_blank" rel="noopener noreferrer">
                  {t("step1Link")} <IconExternal size={13} />
                </a>
              </span>
            </li>
            <li>
              <strong>{t("step2")}</strong>
              <span>
                <a href={NEW_TOKEN} target="_blank" rel="noopener noreferrer">
                  {t("step2Link")} <IconExternal size={13} />
                </a>{" "}
                {t("step2Text")}
              </span>
            </li>
            <li>
              <strong>{t("step3")}</strong>
            </li>
          </ol>
          <label class="field">
            <span>{t("token")}</span>
            <input
              type="password"
              autoComplete="off"
              spellcheck={false}
              placeholder="github_pat_…"
              value={token}
              onInput={(e) => {
                setToken(e.currentTarget.value);
                setRepos([]);
              }}
              onBlur={loadRepos}
              required
            />
          </label>
          <label class="field">
            <span>{t("repository")}</span>
            <input
              list="nw-repos"
              placeholder="owner/notes"
              value={repo}
              onFocus={loadRepos}
              onInput={(e) => setRepo(e.currentTarget.value)}
              spellcheck={false}
              required
            />
            <datalist id="nw-repos">
              {repos.map((r) => (
                <option value={r.full_name}>{r.private ? "🔒" : ""}</option>
              ))}
            </datalist>
          </label>
          <label class="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
            {t("remember")}
          </label>
          {error && (
            <p class="field-error" role="alert">
              {error}
            </p>
          )}
          <button class="btn primary big" disabled={busy}>
            {busy ? t("connecting") : t("connect")}
          </button>
          <p class="muted small">{t("privacyNote")}</p>
        </form>
      </main>

      <footer class="setup-foot">
        <span>
          {t("basedOn")}{" "}
          <a href={URLS.original} target="_blank" rel="noopener noreferrer">
            BatNoter
          </a>
          . {t("batnoterUsers")}
        </span>
        <a href={URLS.repo} target="_blank" rel="noopener noreferrer">
          <IconGitHub size={15} /> {t("sourceCode")}
        </a>
      </footer>
    </div>
  );
}
