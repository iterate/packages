import type { Compartment, Extension } from "@codemirror/state";
import type { ViewPlugin } from "@codemirror/view";

/** VS Code's light or dark theme, as the page's theme is. A change swaps it in the open editor
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
  // The page's theme is the class `dark` on <html> (components/mode-toggle.tsx): the person's
  // choice, or the system's setting while the choice is "system".
  const root = document.documentElement;
  const theme = new codemirror.Compartment();
  const current = () =>
    root.classList.contains("dark") ? codemirror.vsCodeDark : codemirror.vsCodeLight;
  return [
    theme.of(current()),
    codemirror.ViewPlugin.define((view) => {
      const watch = new MutationObserver(() =>
        view.dispatch({ effects: theme.reconfigure(current()) }),
      );
      watch.observe(root, { attributes: true, attributeFilter: ["class"] });
      return { destroy: () => watch.disconnect() };
    }),
  ];
}
