// Small popup menu, opened from a button or at the mouse position (context menu).

import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export interface MenuItem {
  label: string;
  icon?: ComponentChildren;
  onSelect: () => void;
  danger?: boolean;
  hint?: string;
}
export type MenuEntry = MenuItem | "-";

const open = signal<{ x: number; y: number; items: MenuEntry[]; alignRight?: boolean } | null>(null);

export function showMenu(e: MouseEvent, items: MenuEntry[]) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  if (e.type === "contextmenu") open.value = { x: e.clientX, y: e.clientY, items };
  else {
    const r = target.getBoundingClientRect();
    open.value = { x: r.right, y: r.bottom + 4, items, alignRight: true };
  }
}

export function MenuHost() {
  const m = open.value;
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [active, setActive] = useState(-1);

  useLayoutEffect(() => {
    if (!m || !el.current) return;
    const w = el.current.offsetWidth;
    const h = el.current.offsetHeight;
    let left = m.alignRight ? m.x - w : m.x;
    let top = m.y;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    if (top + h > innerHeight - 8) top = Math.max(8, m.y - h - (m.alignRight ? 40 : 0));
    setPos({ left, top });
    setActive(-1);
    el.current.focus();
  }, [m]);

  useEffect(() => {
    if (!m) return;
    const close = () => (open.value = null);
    const onDown = (e: MouseEvent) => {
      if (!el.current?.contains(e.target as Node)) close();
    };
    addEventListener("mousedown", onDown, true);
    addEventListener("resize", close);
    addEventListener("blur", close);
    return () => {
      removeEventListener("mousedown", onDown, true);
      removeEventListener("resize", close);
      removeEventListener("blur", close);
    };
  }, [m]);

  if (!m) return null;
  const items = m.items.filter((i): i is MenuItem => i !== "-");
  const run = (item: MenuItem) => {
    open.value = null;
    item.onSelect();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      open.value = null;
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + d + items.length) % items.length);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      run(items[active]);
    }
  };
  let i = -1;
  return (
    <div class="menu" role="menu" ref={el} tabIndex={-1} style={pos} onKeyDown={onKey}>
      {m.items.map((item, k) => {
        if (item === "-") return <hr key={k} />;
        const idx = ++i;
        return (
          <button
            key={k}
            role="menuitem"
            class={`${item.danger ? "danger" : ""} ${idx === active ? "active" : ""}`}
            onClick={() => run(item)}
            onMouseEnter={() => setActive(idx)}
          >
            <span class="menu-icon">{item.icon}</span>
            <span class="menu-label">{item.label}</span>
            {item.hint && <kbd>{item.hint}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
