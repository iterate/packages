// React Doctor's settings for this package (`npx react-doctor@latest --yes .` here scores 100).
export default {
  ignore: {
    // The vendored shadcn components are upstream's, byte for byte (src/components/ui/AGENTS.md):
    // the drift check refuses an edit, and a finding in them is fixed upstream or at a call site.
    files: ["src/components/ui/**"],
    overrides: [
      // A `*.client.tsx` module IS the lazy chunk: code-block.tsx and code-editor.tsx load it with
      // import(), so that CodeMirror and its grammars stay out of every other page.
      {
        files: ["src/components/*.client.tsx"],
        rules: ["react-doctor/prefer-dynamic-import"],
      },
      // The docs editor IS the page that loads it: DocEditor mounts CodeMirror bound to the doc's
      // Y.Text as the page opens, showing the text the page read, so a lazy import would only
      // delay that first paint (src/components/docs-editor/AGENTS.md). The shared source setup is
      // also loaded on demand by the repo IDE (src/components/repo-ide/codemirror.ts).
      {
        files: ["src/components/docs-editor/*.ts", "src/lib/source-editor.ts"],
        rules: ["react-doctor/prefer-dynamic-import"],
      },
      // AN ENTRY OF THE PUBLISHED PACKAGE hands a page its component AND the readers of that
      // component's state in ONE module: a no-build page loads the entry with one import() and
      // calls both (`kit.SecretsPage`, `kit.secretsPageStateOf(view)`). The rule keeps Fast Refresh
      // whole in a dev server, which costs these four files a full reload when they are edited.
      {
        files: [
          "src/components/analytics-page.tsx",
          "src/components/context-explorer/context-explorer.tsx",
          "src/components/repo-ide/repo-ide.tsx",
          "src/components/secrets-page.tsx",
        ],
        rules: ["react-doctor/only-export-components"],
      },
      // An example page's inline script runs in a browser and nowhere else: it has no server render
      // to guard a global from.
      {
        files: ["examples/*.html"],
        rules: ["react-doctor/no-unguarded-browser-global-at-module-scope"],
      },
    ],
  },
};
