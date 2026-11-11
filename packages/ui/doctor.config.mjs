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
      // An example page's inline script runs in a browser and nowhere else: it has no server render
      // to guard a global from.
      {
        files: ["examples/*.html"],
        rules: ["react-doctor/no-unguarded-browser-global-at-module-scope"],
      },
    ],
  },
};
