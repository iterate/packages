import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
} from "@codemirror/view";
import { vsCodeDark, vsCodeLight } from "@fsegurai/codemirror-theme-bundle";
import { systemCodeMirrorTheme } from "#/lib/codemirror-theme.ts";

/** Shared source editor setup for the repo IDE and Docs. Collaborative buffers supply their
 *  own undo manager; installing CodeMirror's history too would undo remote edits. */
export function sourceEditorExtensions(options: { history: "local" | "external" }): Extension {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    options.history === "local" ? history() : [],
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...defaultKeymap,
      ...(options.history === "local" ? historyKeymap : []),
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    systemCodeMirrorTheme({ Compartment, ViewPlugin, vsCodeLight, vsCodeDark }),
    EditorView.theme({
      "&": { height: "100%", fontSize: "12px" },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono, monospace)" },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
    }),
  ];
}
