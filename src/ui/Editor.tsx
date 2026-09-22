// CodeMirror 6 Markdown editor.

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "preact/hooks";

const style = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.45em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.25em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.1em", fontWeight: "700" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--link)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", fontSize: "0.92em", color: "var(--code-text)" },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: "var(--muted)" },
  { tag: tags.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: tags.list, color: "var(--text)" },
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--hl-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--hl-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--hl-number)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--muted)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--hl-function)" },
  { tag: [tags.typeName, tags.className, tags.tagName], color: "var(--hl-type)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--hl-prop)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--editor-size)", backgroundColor: "transparent", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--editor-font)", lineHeight: "1.65", overflow: "auto" },
  ".cm-content": { padding: "20px 0 40vh", maxWidth: "var(--measure)", margin: "0 auto", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 24px" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection) !important" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--text)", borderColor: "var(--border)" },
  ".cm-panels input, .cm-panels button": { font: "inherit" },
  ".cm-searchMatch": { backgroundColor: "var(--search-hit)" },
  ".cm-selectionMatch": { backgroundColor: "var(--accent-soft)" },
});

/** Marks transactions that load text from outside; they are not user edits. */
const external = Annotation.define<boolean>();

export interface EditorApi {
  view: EditorView;
}

interface Props {
  value: string;
  /** Bumped by the parent when `value` changed from outside the editor. */
  revision: number;
  onChange: (text: string) => void;
  onFiles?: (files: File[]) => Promise<string>;
  placeholder?: string;
  spellcheck?: boolean;
  lang?: string;
  api?: (api: EditorApi | null) => void;
  autofocus?: boolean;
}

export function Editor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const attrs = useRef(new Compartment());

  useEffect(() => {
    const insertFiles = async (files: File[], at?: number) => {
      const v = view.current;
      if (!v || !propsRef.current.onFiles) return;
      const text = await propsRef.current.onFiles(files);
      if (!text) return;
      const pos = at ?? v.state.selection.main.head;
      v.dispatch({ changes: { from: pos, to: at === undefined ? v.state.selection.main.to : pos, insert: text }, selection: { anchor: pos + text.length } });
      v.focus();
    };
    const files = (list: FileList | null | undefined) => [...(list || [])].filter((f) => f.type.startsWith("image/"));

    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          EditorView.lineWrapping,
          search({ top: true }),
          highlightSelectionMatches(),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(style),
          theme,
          cmPlaceholder(props.placeholder || ""),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab, ...formatKeymap]),
          attrs.current.of(contentAttrs(props)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && u.transactions.some((tr) => !tr.annotation(external))) {
              propsRef.current.onChange(u.state.doc.toString());
            }
          }),
          EditorView.domEventHandlers({
            paste(e) {
              const f = files(e.clipboardData?.files);
              if (!f.length) return false;
              e.preventDefault();
              insertFiles(f);
              return true;
            },
            drop(e, v) {
              const f = files(e.dataTransfer?.files);
              if (!f.length) return false;
              e.preventDefault();
              insertFiles(f, v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined);
              return true;
            },
          }),
        ],
      }),
    });
    view.current = v;
    props.api?.({ view: v });
    if (props.autofocus) v.focus();
    return () => {
      props.api?.(null);
      v.destroy();
      view.current = null;
    };
  }, []);

  // External changes (remote update, task toggled in the preview, restored version) come with a
  // new `revision`. Comparing values instead would fight the user's typing with stale renders.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc.toString();
    if (doc !== props.value) {
      const head = Math.min(v.state.selection.main.head, props.value.length);
      v.dispatch({ changes: { from: 0, to: doc.length, insert: props.value }, selection: { anchor: head }, annotations: external.of(true) });
    }
  }, [props.revision]);

  useEffect(() => {
    view.current?.dispatch({ effects: attrs.current.reconfigure(contentAttrs(props)) });
  }, [props.spellcheck, props.lang]);

  return <div class="editor" ref={host} />;
}

const contentAttrs = (p: Props) =>
  EditorView.contentAttributes.of({ spellcheck: p.spellcheck ? "true" : "false", lang: p.lang || "", "aria-label": p.placeholder || "" });

// ---- formatting commands (toolbar and shortcuts) ----

export function wrap(view: EditorView, mark: string, end = mark) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to);
      const before = view.state.sliceDoc(range.from - mark.length, range.from);
      const after = view.state.sliceDoc(range.to, range.to + end.length);
      if (before === mark && after === end) {
        return {
          changes: [
            { from: range.from - mark.length, to: range.from },
            { from: range.to, to: range.to + end.length },
          ],
          range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
        };
      }
      return {
        changes: { from: range.from, to: range.to, insert: mark + text + end },
        range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
      };
    }),
  );
  view.focus();
}

/** Adds or removes a prefix on every selected line ("# ", "- ", "> ", "- [ ] "). */
export function linePrefix(view: EditorView, prefix: string) {
  const { state } = view;
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let l = state.doc.lineAt(r.from).number; l <= state.doc.lineAt(r.to).number; l++) lines.add(l);
  }
  const all = [...lines].map((n) => state.doc.line(n));
  const strip = /^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |> |\d+\. )/;
  const remove = all.every((l) => l.text.startsWith(prefix));
  view.dispatch({
    changes: all.map((l) => {
      const m = l.text.match(strip);
      if (remove) return { from: l.from, to: l.from + prefix.length };
      return { from: l.from, to: l.from + (m ? m[0].length : 0), insert: prefix };
    }),
  });
  view.focus();
}

export function insertLink(view: EditorView) {
  const r = view.state.selection.main;
  const text = view.state.sliceDoc(r.from, r.to);
  const isUrl = /^https?:\/\/\S+$/.test(text);
  const insert = isUrl ? `[](${text})` : `[${text}](https://)`;
  const cursor = isUrl ? r.from + 1 : r.from + text.length + 3;
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: isUrl ? { anchor: cursor } : { anchor: cursor, head: cursor + 8 } });
  view.focus();
}

export function insertBlock(view: EditorView, block: string, select?: [number, number]) {
  const r = view.state.selection.main;
  const line = view.state.doc.lineAt(r.from);
  const lead = line.text.trim() ? "\n\n" : "";
  const from = line.text.trim() ? line.to : line.from;
  view.dispatch({
    changes: { from, insert: lead + block + "\n" },
    selection: select ? { anchor: from + lead.length + select[0], head: from + lead.length + select[1] } : { anchor: from + lead.length + block.length },
  });
  view.focus();
}

const formatKeymap = [
  { key: "Mod-b", run: (v: EditorView) => (wrap(v, "**"), true) },
  { key: "Mod-i", run: (v: EditorView) => (wrap(v, "*"), true) },
  { key: "Mod-Shift-x", run: (v: EditorView) => (wrap(v, "~~"), true) },
  { key: "Mod-`", run: (v: EditorView) => (wrap(v, "`"), true) },
  { key: "Mod-Shift-7", run: (v: EditorView) => (linePrefix(v, "1. "), true) },
  { key: "Mod-Shift-8", run: (v: EditorView) => (linePrefix(v, "- "), true) },
  { key: "Mod-Shift-9", run: (v: EditorView) => (linePrefix(v, "- [ ] "), true) },
];
