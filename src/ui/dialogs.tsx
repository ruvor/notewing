// Promise-based dialogs rendered by <DialogHost/>.

import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n";
import { IconClose, IconFolder } from "./icons";

type Render = (close: (v: any) => void) => ComponentChildren;
const current = signal<{ render: Render; close: (v: any) => void } | null>(null);

export function openDialog<T>(render: (close: (v: T | null) => void) => ComponentChildren): Promise<T | null> {
  return new Promise((resolve) => {
    const close = (v: T | null) => {
      current.value = null;
      resolve(v);
    };
    current.value = { render, close };
  });
}

export function DialogHost() {
  const d = current.value;
  useEffect(() => {
    if (!d) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        d.close(null);
      }
    };
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [d]);
  if (!d) return null;
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && d.close(null)}>
      {d.render(d.close)}
    </div>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean; class?: string }) {
  return (
    <div class={`modal ${props.wide ? "wide" : ""} ${props.class || ""}`} role="dialog" aria-modal="true" aria-label={props.title}>
      <header class="modal-head">
        <h2>{props.title}</h2>
        <button class="icon-btn" onClick={props.onClose} title={t("close")} aria-label={t("close")}>
          <IconClose />
        </button>
      </header>
      {props.children}
    </div>
  );
}

export function prompt(title: string, opts: { value?: string; label?: string; ok?: string; hint?: string; validate?: (v: string) => string | null } = {}) {
  return openDialog<string>((close) => <PromptBody title={title} opts={opts} close={close} />);
}

function PromptBody({ title, opts, close }: { title: string; opts: Parameters<typeof prompt>[1] & {}; close: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.value || "");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    // Select the name without the extension, like file managers do.
    const v = opts.value || "";
    const dot = v.lastIndexOf(".");
    input.current?.setSelectionRange(0, dot > 0 && !v.includes("/") ? dot : v.length);
  }, []);
  const submit = (e: Event) => {
    e.preventDefault();
    const err = opts.validate?.(value) ?? null;
    if (err) return setError(err);
    close(value);
  };
  return (
    <Modal title={title} onClose={() => close(null)}>
      <form onSubmit={submit} class="modal-body">
        <label class="field">
          {opts.label && <span>{opts.label}</span>}
          <input ref={input} value={value} onInput={(e) => (setValue(e.currentTarget.value), setError(null))} aria-invalid={!!error} />
        </label>
        {error ? <p class="field-error">{error}</p> : opts.hint && <p class="hint">{opts.hint}</p>}
        <div class="modal-actions">
          <button type="button" class="btn" onClick={() => close(null)}>
            {t("cancel")}
          </button>
          <button type="submit" class="btn primary">
            {opts.ok || t("ok")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function confirm(title: string, text: ComponentChildren, ok: string, danger = false) {
  return openDialog<boolean>((close) => (
    <Modal title={title} onClose={() => close(null)}>
      <div class="modal-body">
        <p>{text}</p>
        <div class="modal-actions">
          <button class="btn" onClick={() => close(null)}>
            {t("cancel")}
          </button>
          <button class={`btn ${danger ? "danger" : "primary"}`} onClick={() => close(true)} autoFocus>
            {ok}
          </button>
        </div>
      </div>
    </Modal>
  ));
}

/** Lets the user pick a folder; returns its path ("" for the root). */
export function pickFolder(title: string, folders: string[], current: string, disabled: (f: string) => boolean = () => false) {
  return openDialog<string>((close) => (
    <Modal title={title} onClose={() => close(null)}>
      <div class="modal-body">
        <ul class="folder-pick" role="listbox">
          {folders.map((f) => (
            <li key={f}>
              <button
                class={f === current ? "current" : ""}
                disabled={disabled(f)}
                onClick={() => close(f)}
                style={{ paddingLeft: `${12 + (f ? f.split("/").length : 0) * 16}px` }}
              >
                <IconFolder size={16} />
                {f ? f.split("/").pop() : t("rootFolder")}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  ));
}
