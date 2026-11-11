import type { Compartment, Extension } from "@codemirror/state";
import type { ViewPlugin } from "@codemirror/view";

/** VS Code's light or dark theme, as the OS's setting is. A change swaps it in the open editor
 *  (a compartment), which keeps the text, the selection and the undo history.
 *
 *  Takes the editor's own CodeMirror rather than importing it: on esm.sh each module that uses
 *  CodeMirror carries its own copy, and an editor throws on an extension made by another copy. */
export function systemCodeMirrorTheme(codemirror: {
  Compartment: typeof Compartment;
  ViewPlugin: typeof ViewPlugin;
  vsCodeLight: Extension;
  vsCodeDark: Extension;
}): Extension {
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const theme = new codemirror.Compartment();
  const current = () => (dark.matches ? codemirror.vsCodeDark : codemirror.vsCodeLight);
  return [
    theme.of(current()),
    codemirror.ViewPlugin.define((view) => {
      const swap = () => view.dispatch({ effects: theme.reconfigure(current()) });
      dark.addEventListener("change", swap);
      return { destroy: () => dark.removeEventListener("change", swap) };
    }),
  ];
}
