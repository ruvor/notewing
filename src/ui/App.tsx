// Application shell: top bar, sidebar, routed content, global shortcuts.

import { useEffect, useState } from "preact/hooks";
import { newNote } from "../actions";
import { fmtAgo, mod, t } from "../i18n";
import { go, route } from "../router";
import { setSetting, settings } from "../settings";
import { rev, runSync, session, sync, toasts } from "../state";
import { DialogHost } from "./dialogs";
import { FolderView } from "./FolderView";
import { IconAlert, IconClose, IconCloud, IconCloudCheck, IconCloudOff, IconMenu, IconPlus, IconRefresh, IconSearch, IconSettings, IconSidebar, Logo } from "./icons";
import { MenuHost } from "./Menu";
import { NoteView, zen } from "./NoteView";
import { pushRecent, searchOpen, SearchPalette } from "./Search";
import { SettingsView } from "./Settings";
import { Setup } from "./Setup";
import { expandTo, Sidebar } from "./Sidebar";

function SyncStatus() {
  const s = session.value!;
  rev.value;
  const st = sync.value;
  const n = s.repo.dirtyCount;
  let icon = <IconCloudCheck size={18} />;
  let label = t("synced");
  let cls = "ok";
  if (st.busy) {
    icon = <IconRefresh size={18} class="spin" />;
    label = t("syncing");
    cls = "busy";
  } else if (st.offline) {
    icon = <IconCloudOff size={18} />;
    label = n ? t("offlineN", n) : t("offline");
    cls = "offline";
  } else if (st.error) {
    icon = <IconAlert size={18} />;
    label = st.auth ? t("reconnect") : t("syncError");
    cls = "error";
  } else if (n) {
    icon = <IconCloud size={18} />;
    label = t("unsyncedN", n);
    cls = "dirty";
  }
  const title = st.error || (st.last ? t("lastSync", fmtAgo(st.last)) : "");
  return (
    <button
      class={`sync-status ${cls}`}
      title={title}
      onClick={() => (st.auth ? go({ name: "settings" }) : runSync())}
      aria-live="polite"
    >
      {icon}
      <span class="hide-sm">{label}</span>
    </button>
  );
}

function Toasts() {
  return (
    <div class="toasts" role="status">
      {toasts.value.map((x) => (
        <div key={x.id} class={`toast ${x.kind || ""}`}>
          <span>{x.text}</span>
          {x.action && (
            <button
              class="toast-action"
              onClick={() => {
                toasts.value = toasts.value.filter((y) => y.id !== x.id);
                x.action!.run();
              }}
            >
              {x.action.label}
            </button>
          )}
          <button class="icon-btn" onClick={() => (toasts.value = toasts.value.filter((y) => y.id !== x.id))} aria-label={t("close")}>
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const s = session.value!;
  const r = route.value;
  const [drawer, setDrawer] = useState(false);
  const showSidebar = settings.value.sidebar && !zen.value;

  useEffect(() => {
    if (r.name === "note") {
      pushRecent(r.path);
      expandTo(r.path.split("/").slice(0, -1).join("/"));
    }
    setDrawer(false);
  }, [r]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = e.ctrlKey || e.metaKey;
      if (m && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K" || e.key === "p" || e.key === "P")) {
        e.preventDefault();
        searchOpen.value = !searchOpen.value;
      } else if (m && !e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        runSync();
      } else if (e.altKey && !m && e.code === "KeyN") {
        e.preventDefault();
        newNote();
      } else if (m && !e.shiftKey && (e.key === "e" || e.key === "E") && route.value.name !== "folder") {
        e.preventDefault();
        setSetting("mode", settings.value.mode === "preview" ? "edit" : "preview");
      } else if (m && e.shiftKey && e.code === "KeyF") {
        e.preventDefault();
        zen.value = !zen.value;
      } else if (m && e.key === "\\") {
        e.preventDefault();
        if (innerWidth < 760) setDrawer((d) => !d);
        else setSetting("sidebar", !settings.value.sidebar);
      } else if (e.key === "Escape" && zen.value && !document.querySelector(".overlay")) {
        zen.value = false;
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  let content;
  if (r.name === "settings") content = <SettingsView />;
  else if (r.name === "note" || r.name === "new") content = <NoteView key="note" path={r.name === "note" ? r.path : null} draftDir={r.name === "new" ? r.path : ""} />;
  else content = <FolderView path={r.path} />;

  return (
    <div
      class={`app ${showSidebar ? "with-sidebar" : ""} ${zen.value ? "zen" : ""} ${drawer ? "drawer-open" : ""}`}
      style={{
        "--editor-size": `${settings.value.fontSize}px`,
        "--editor-font": settings.value.editorFont === "mono" ? "var(--font-mono)" : "var(--font-text)",
      }}
    >
      {!zen.value && (
        <header class="topbar">
          <button class="icon-btn drawer-btn" onClick={() => setDrawer(!drawer)} aria-label={t("notes")}>
            <IconMenu />
          </button>
          <button class="icon-btn sidebar-btn" onClick={() => setSetting("sidebar", !settings.value.sidebar)} title={`${t("scSidebar")} (${mod}+\\)`} aria-label={t("scSidebar")}>
            <IconSidebar />
          </button>
          <a class="brand" href="#/">
            <Logo size={26} />
            <span>Notewing</span>
          </a>
          {s.demo && (
            <span class="demo-badge" title={t("demoHint")}>
              {t("demo")}
            </span>
          )}
          <button class="search-btn" onClick={() => (searchOpen.value = true)}>
            <IconSearch size={16} />
            <span class="hide-sm">{t("searchPlaceholder")}</span>
            <kbd class="hide-sm">{mod}+K</kbd>
          </button>
          <div class="topbar-right">
            <SyncStatus />
            <button class="icon-btn" onClick={() => newNote()} title={`${t("newNote")} (Alt+N)`} aria-label={t("newNote")}>
              <IconPlus />
            </button>
            <a class={`icon-btn ${r.name === "settings" ? "on" : ""}`} href="#/settings" title={t("settings")} aria-label={t("settings")}>
              <IconSettings />
            </a>
          </div>
        </header>
      )}
      {sync.value.auth && (
        <div class="banner error" role="alert">
          {t("errTokenExpired")}{" "}
          <a href="#/settings">{t("reconnect")}</a>
        </div>
      )}
      <div class="main-area">
        {(showSidebar || drawer) && <Sidebar onNavigate={() => setDrawer(false)} />}
        {drawer && <div class="scrim" onClick={() => setDrawer(false)} />}
        <main class="content">{content}</main>
      </div>
      {zen.value && (
        <button class="zen-exit icon-btn" onClick={() => (zen.value = false)} title={`${t("exitFocus")} (Esc)`} aria-label={t("exitFocus")}>
          <IconClose />
        </button>
      )}
      <SearchPalette />
    </div>
  );
}

export function App({ ready }: { ready: boolean }) {
  return (
    <>
      {!ready ? <div class="splash"><Logo size={56} /></div> : session.value ? <Shell /> : <Setup />}
      <DialogHost />
      <MenuHost />
      <Toasts />
    </>
  );
}
