// THE MODULES A NO-BUILD PAGE IMPORTS FROM @iterate-com/ui, as the published package names them
// (tsdown.config.ts builds one file per entry; package.json's publishConfig.exports maps each name to
// it, and `node scripts/ci/shadcn-registry.ts update` writes that map). A page imports the same names the apps in this repo do (`@iterate-com/ui/components/…`),
// plus React's own modules, which its import map points `react`, `react/…` and `react-dom/…` at.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ui = import.meta.dirname;

/** Each entry's name, with the source tsdown builds it from: the modules in src/browser/, one
 *  per registry item of files (its file named after it, `context-view/context-view.tsx`; the theme
 *  item is a stylesheet's, iterate.css), and one per vendored shadcn component
 *  (`components/ui/button`). */
export function browserEntries(): Record<string, string> {
  const registry: { items: { name: string; files?: { path: string }[] }[] } = JSON.parse(
    readFileSync(path.join(ui, "registry.json"), "utf8"),
  );
  const items = registry.items.flatMap((item) => {
    if (!item.files) return [];
    const file = item.files.find(
      ({ path: file }) => path.basename(file, path.extname(file)) === item.name,
    );
    if (!file)
      throw new Error(
        `registry item ${item.name} has no file named after it (${item.name}.tsx or ${item.name}.ts) for a page to import`,
      );
    return [file.path];
  });
  const shadcn = readdirSync(path.join(ui, "src/components/ui"))
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => `src/components/ui/${file}`);
  return {
    page: "src/browser/page.ts",
    live: "src/browser/live.ts",
    // the icons a page takes from this package, and not from lucide-react (src/browser/icons.ts)
    icons: "src/browser/icons.ts",
    react: "src/browser/react.ts",
    "react/jsx-runtime": "src/browser/react-jsx-runtime.ts",
    "react/compiler-runtime": "src/browser/react-compiler-runtime.ts",
    "react-dom": "src/browser/react-dom.ts",
    "react-dom/client": "src/browser/react-dom-client.ts",
    // the page's side of a kind's own chat view (src/agent-kind-view/host.ts); the frame's side is
    // one classic script beside these modules (`AGENT_KIND_VIEW_FRAME`)
    "agent-kind-view/host": "src/agent-kind-view/host.ts",
    ...Object.fromEntries(
      [...items, ...shadcn]
        .sort()
        .map((file) => [file.slice("src/".length).replace(/\.tsx?$/, ""), file]),
    ),
  };
}

/** THE VENDOR CHUNKS of the build: one file per library, whichever components load it
 *  (tsdown.config.ts makes one chunk per group). Each is also an export of the published package
 *  (`publishExports`), and the export is what keeps it ONE file on esm.sh. esm.sh builds every
 *  lazily loaded chunk again, and copies into it each file that chunk imports, unless the file is
 *  an export or two exports import it directly. Only lazy chunks import CodeMirror. So without the
 *  export, a page with two of them (the repo IDE: its own wiring, and `code-editor`) got two
 *  CodeMirrors, and the editor refused the extensions the other one made. */
/** The lucide icons that only src/components/docs-editor imports, by their file names. */
export const docsEditorIcons = [
  "bold",
  "code-xml",
  "dot",
  "heading-1",
  "heading-2",
  "heading-3",
  "italic",
  "link",
  "list",
  "list-checks",
  "list-ordered",
  "message-square-plus",
  "pilcrow",
  "redo",
  "rotate-ccw",
  "separator-horizontal",
  "strikethrough",
  "table",
  "text-quote",
  "trash-2",
  "undo",
];

export const vendorChunks = [
  { name: "vendor-react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
  // CodeMirror, without the languages only the docs editor loads: those are the next group's. A
  // group also takes every module its modules import that no earlier group has taken (rolldown's
  // `codeSplitting.groups`), so this one comes first and keeps the core
  {
    name: "vendor-codemirror",
    test: /node_modules[\\/](?!@codemirror[\\/](?:lang-(?:cpp|go|java|php|python|rust|xml)|legacy-modes)[\\/]|@lezer[\\/](?:cpp|go|java|php|python|rust|xml)[\\/])(@codemirror|@lezer|codemirror|crelt|style-mod|w3c-keyname|@marijn)[\\/]/,
  },
  // the languages of the docs editor's code blocks (Atomic's `code-languages`) that the repo IDE has
  // none of: a chunk of their own, so the pages that load vendor-codemirror do not pay for them
  {
    name: "vendor-codemirror-more-languages",
    test: /node_modules[\\/](@codemirror[\\/](lang-(cpp|go|java|php|python|rust|xml)|legacy-modes)|@lezer[\\/](cpp|go|java|php|python|rust|xml))[\\/]/,
  },
  { name: "vendor-codemirror-themes", test: /node_modules[\\/]@fsegurai[\\/]/ },
  { name: "vendor-base-ui", test: /node_modules[\\/](@base-ui|@floating-ui)[\\/]/ },
  { name: "vendor-yaml", test: /node_modules[\\/]yaml[\\/]/ },
  { name: "vendor-zod", test: /node_modules[\\/]zod[\\/]/ },
  { name: "vendor-yjs", test: /node_modules[\\/](yjs|lib0|y-protocols|y-codemirror\.next)[\\/]/ },
  // Atomic's live preview holds CodeMirror state fields and facets: one copy, beside CodeMirror's
  { name: "vendor-atomic", test: /node_modules[\\/]@atomic-editor[\\/]/ },
  { name: "vendor-posthog", test: /node_modules[\\/]posthog-js[\\/]/ },
  // FEWER FILES FOR A PAGE TO ASK FOR, AT NO COST IN BYTES. Without these three, each icon is a
  // chunk of its own, and a page asks for each vendored shadcn component by its own file of two
  // kilobytes. A group also takes what its files import and no earlier group holds, so the order
  // here says who holds what:
  //   vendor-icons  every icon that a component or src/browser/icons.ts uses
  //   ui-base       what nearly every page with a component loads: the button and the text
  //                 fields, with the class helpers under them. A public page of one button and one
  //                 card loads this and no more, as before.
  //   ui-shell      the components that only the app shell brings: a page with the shell loads
  //                 what it loaded before, in one file, and a page without it loads none of it.
  // `components/ui/<name>` stays an entry, which hands on what its file holds.
  // every icon but the docs editor's own, and lucide's shared parts (the group after this one
  // says why the order is this)
  {
    name: "vendor-icons",
    test: new RegExp(
      `node_modules[\\\\/]lucide-react[\\\\/](?!dist[\\\\/]esm[\\\\/]icons[\\\\/](?:${docsEditorIcons.join("|")})\\.m?js$)`,
    ),
  },
  {
    name: "ui-base",
    test: /[\\/]src[\\/]components[\\/]ui[\\/](button|input|label|textarea)\.tsx$/,
  },
  {
    name: "ui-shell",
    test: /[\\/]src[\\/]components[\\/]ui[\\/](avatar|dialog|dropdown-menu|input-group|separator|sheet|skeleton|tooltip)\.tsx$/,
  },
  // The icons that the docs editor alone draws: a page that shows no doc loads none of them.
  // AFTER vendor-icons, whose test leaves them out: a group also takes what its files import, so
  // ahead of it this one would hold lucide's shared parts, and every page would load it.
  // src/components/docs-editor/icons.test.ts holds the list to what the sources import.
  {
    name: "docs-editor-icons",
    test: new RegExp(
      `node_modules[\\\\/]lucide-react[\\\\/]dist[\\\\/]esm[\\\\/]icons[\\\\/](?:${docsEditorIcons.join("|")})\\.m?js$`,
    ),
  },
];

/** THE SCRIPT OF THE FRAME a kind's chat view runs in, as one classic script of the published
 *  package (scripts/build-agent-kind-view-frame.ts builds it from src/browser/agent-kind-view-frame.ts).
 *  The frame is sandboxed with an opaque origin: a module script would need CORS and an import
 *  map; a classic `<script src>` needs neither. A page names it by its URL at the build it pins. */
export const AGENT_KIND_VIEW_FRAME = "agent-kind-view-frame.js";

/** package.json's publishConfig.exports for `entries`: each name at its built file, the
 *  stylesheet, and iterate's look over it with each font file its url()s name beside it
 *  (`fonts`, scripts/iterate-look.ts). esm.sh serves a file by a name only an export names, and a
 *  wildcard export does not count. */
export function publishExports(entries: Record<string, string>, fonts: string[]) {
  return {
    ...Object.fromEntries(Object.keys(entries).map((name) => [`./${name}`, `./dist/${name}.mjs`])),
    ...Object.fromEntries(
      vendorChunks.map(({ name }) => [`./chunks/${name}`, `./dist/chunks/${name}.mjs`]),
    ),
    "./styles.css": "./dist/styles.css",
    // the docs editor's file tree, its own build (scripts/build-docs-tree.ts)
    "./components/docs-editor/doc-tree": "./dist/components/docs-editor/doc-tree.mjs",
    // the docs editor's page's whole stylesheet (src/browser/docs-editor.css), in place of styles.css
    "./docs-editor.css": "./dist/docs-editor.css",
    [`./${AGENT_KIND_VIEW_FRAME}`]: `./dist/${AGENT_KIND_VIEW_FRAME}`,
    "./iterate.css": "./dist/iterate.css",
    ...Object.fromEntries(fonts.map((file) => [`./fonts/${file}`, `./dist/fonts/${file}`])),
  };
}
