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
    react: "src/browser/react.ts",
    "react/jsx-runtime": "src/browser/react-jsx-runtime.ts",
    "react/compiler-runtime": "src/browser/react-compiler-runtime.ts",
    "react-dom": "src/browser/react-dom.ts",
    "react-dom/client": "src/browser/react-dom-client.ts",
    ...Object.fromEntries(
      [...items, ...shadcn]
        .sort()
        .map((file) => [file.slice("src/".length).replace(/\.tsx?$/, ""), file]),
    ),
  };
}

/** package.json's publishConfig.exports for `entries`: each name at its built file, the
 *  stylesheet, and iterate's look over it with each font file its url()s name beside it
 *  (`fonts`, scripts/iterate-look.ts). esm.sh serves a file by a name only an export names, and a
 *  wildcard export does not count. */
export function publishExports(entries: Record<string, string>, fonts: string[]) {
  return {
    ...Object.fromEntries(Object.keys(entries).map((name) => [`./${name}`, `./dist/${name}.mjs`])),
    "./styles.css": "./dist/styles.css",
    "./iterate.css": "./dist/iterate.css",
    ...Object.fromEntries(fonts.map((file) => [`./fonts/${file}`, `./dist/fonts/${file}`])),
  };
}
