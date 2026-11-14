"use client";
// The composer textarea: a CodeMirror editor that grows with the draft — Enter submits (never
// mid-IME-composition), Shift+Enter is a new line, ⌘/Ctrl+Enter submits too; 16px type so iOS does
// not zoom on focus.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";

const isTouchFirst = () => globalThis.matchMedia?.("(pointer: coarse)").matches;

export type ComposerTextareaProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  focusOnMount?: boolean;
};

export function ComposerTextareaClient({
  value,
  onValueChange,
  onSubmit,
  placeholder,
  focusOnMount = false,
}: ComposerTextareaProps) {
  const [initialFocusOnMount] = useState(focusOnMount);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncingExternalValueRef = useRef(false);
  const valueRef = useRef(value);
  const onValueChangeRef = useRef(onValueChange);
  const onSubmitRef = useRef(onSubmit);

  useLayoutEffect(() => {
    valueRef.current = value;
    onValueChangeRef.current = onValueChange;
    onSubmitRef.current = onSubmit;
  });

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    let disposed = false;
    void (async () => {
      const [{ EditorState, Prec }, { EditorView, keymap, placeholder: placeholderExtension }] =
        await Promise.all([import("@codemirror/state"), import("@codemirror/view")]);
      if (disposed) return;
      const doc = valueRef.current;
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc,
          selection: { anchor: doc.length },
          extensions: [
            placeholderExtension(placeholder),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({
              "aria-label": placeholder,
              enterkeyhint: "enter",
              "aria-placeholder": placeholder,
              placeholder,
            }),
            Prec.high(
              keymap.of([
                {
                  key: "Enter",
                  run: (editor) => {
                    // a phone's Return starts a new line: its Send button is right there
                    if (editor.composing || isTouchFirst()) return false;
                    onSubmitRef.current();
                    return true;
                  },
                },
                {
                  key: "Mod-Enter",
                  run: () => {
                    onSubmitRef.current();
                    return true;
                  },
                },
              ]),
            ),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged || syncingExternalValueRef.current) return;
              onValueChangeRef.current(update.state.doc.toString());
            }),
            EditorView.theme({
              "&": {
                backgroundColor: "transparent",
                fontSize: "16px",
                maxHeight: "8rem",
                minHeight: "2.5rem",
              },
              "&.cm-focused": { outline: "none" },
              ".cm-scroller": { fontFamily: "inherit", overflow: "auto" },
              ".cm-content": { caretColor: "var(--foreground)", padding: "8px" },
              ".cm-line": { lineHeight: "1.375" },
              ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
                backgroundColor: "color-mix(in oklab, var(--primary) 20%, transparent) !important",
              },
              ".cm-cursor": { borderLeftColor: "var(--foreground)" },
              // below `sm`, where the pill is compact (composer.tsx): the words start nearer the `+`
              "@media (max-width: 639px)": {
                ".cm-content": { padding: "8px 2px" },
                ".cm-line": { paddingLeft: "2px" },
              },
            }),
          ],
        }),
      });
      viewRef.current = view;
      // CodeMirror arrives after the page: a person may already be elsewhere
      // on a phone focus opens the keyboard over what a person came to read
      if (initialFocusOnMount && document.activeElement === document.body && !isTouchFirst())
        view.focus();
    })();
    return () => {
      disposed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // The editor is long-lived; controlled values synchronize below.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- mount focus is captured once.
  }, [placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentText = view.state.doc.toString();
    if (currentText === value) return;
    syncingExternalValueRef.current = true;
    view.dispatch({
      changes: { from: 0, to: currentText.length, insert: value },
      selection: { anchor: value.length },
    });
    syncingExternalValueRef.current = false;
  }, [value]);

  return <div ref={containerRef} className="min-h-10 min-w-0 flex-1" />;
}
