// Versions of a note, from the commits that touched it.

import { useEffect, useState } from "preact/hooks";
import { fromUtf8 } from "../core/bytes";
import type { CommitInfo } from "../core/github";
import { titleOf } from "../core/paths";
import { fmtDate, t } from "../i18n";
import { errorText, session } from "../state";
import { Modal, openDialog } from "./dialogs";
import { IconExternal } from "./icons";
import { Preview } from "./Preview";

/** Resolves with the text of the chosen version, or null. */
export function showHistory(path: string) {
  return openDialog<string>((close) => <History path={path} close={close} />);
}

function History({ path, close }: { path: string; close: (v: string | null) => void }) {
  const s = session.value!;
  const [list, setList] = useState<CommitInfo[] | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<CommitInfo | null>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    s.repo.gh
      .history(s.repo.ref, path)
      .then((l) => {
        setList(l);
        if (l[0]) setSel(l[0]);
      })
      .catch((e) => setError(errorText(e)));
  }, [path]);

  useEffect(() => {
    if (!sel) return;
    setText(null);
    let alive = true;
    s.repo.gh
      .fileAt(s.repo.ref, path, sel.sha)
      .then((b) => alive && setText(b ? fromUtf8(b) : ""))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [sel]);

  return (
    <Modal title={t("historyOf", titleOf(path))} onClose={() => close(null)} wide class="history">
      <div class="history-body">
        <ol class="history-list">
          {error && <li class="field-error">{error}</li>}
          {!list && !error && <li class="muted">{t("loading")}</li>}
          {list?.length === 0 && <li class="muted">{t("noHistory")}</li>}
          {list?.map((c, i) => (
            <li key={c.sha}>
              <button class={sel?.sha === c.sha ? "current" : ""} onClick={() => setSel(c)}>
                <span class="h-msg">{c.message.split("\n")[0]}</span>
                <span class="h-meta">
                  {fmtDate(c.date)}
                  {c.author && ` · ${c.author}`}
                  {i === 0 && ` · ${t("latest")}`}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div class="history-view">
          {sel && (
            <div class="history-tools">
              {!s.demo && (
                <a class="btn" href={sel.url} target="_blank" rel="noopener noreferrer">
                  <IconExternal size={16} /> {t("openOnGitHub")}
                </a>
              )}
              <button class="btn primary" disabled={text === null} onClick={() => close(text)}>
                {t("restoreVersion")}
              </button>
            </div>
          )}
          {text === null ? sel && <p class="muted pad">{t("loading")}</p> : <Preview source={text} path={path} class="history-preview" />}
        </div>
      </div>
    </Modal>
  );
}
