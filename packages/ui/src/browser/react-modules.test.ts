// The React modules a page's import map points `react`, `react/…` and `react-dom/…` at
// (src/browser/react*.ts). React is CommonJS, so each lists React's API by name; a name missing here
// is an import that fails in a library esm.sh built with `?external=react,react-dom`.
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "vitest";

test.for([
  { name: "react", entry: "./react.ts", build: "react/cjs/react.production.js" },
  {
    name: "react/jsx-runtime",
    entry: "./react-jsx-runtime.ts",
    build: "react/cjs/react-jsx-runtime.production.js",
  },
  {
    name: "react/compiler-runtime",
    entry: "./react-compiler-runtime.ts",
    build: "react/cjs/react-compiler-runtime.production.js",
  },
  { name: "react-dom", entry: "./react-dom.ts", build: "react-dom/cjs/react-dom.production.js" },
  {
    name: "react-dom/client",
    entry: "./react-dom-client.ts",
    build: "react-dom/cjs/react-dom-client.production.js",
  },
])(
  "the page's $name exports every name React's production build does",
  async ({ entry, build }) => {
    const exported = Object.keys(await import(entry)).filter((name) => name !== "default");
    expect(exported.sort()).toEqual(productionExports(build));
  },
);

/** The public names of one of React's production builds, by its path in the package (React's
 *  exports map hides cjs/, so the file is required by its path on disk). */
function productionExports(build: string) {
  const require = createRequire(import.meta.url);
  const [pkg] = build.split("/");
  const file = path.join(
    path.dirname(require.resolve(`${pkg}/package.json`)),
    build.slice(pkg!.length + 1),
  );
  return Object.keys(require(file))
    .filter((name) => !name.startsWith("__"))
    .sort();
}
