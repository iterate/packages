// dist/iterate.css and dist/fonts/, after dist/styles.css: the look's overlay for a no-build page
// (iterate-look.ts says how it is cut). `pnpm build` runs it after the stylesheets.
//
// THE DOCS EDITOR'S PAGE links dist/docs-editor.css in place of dist/styles.css, and this same
// dist/iterate.css after it. The overlay is cut from styles.css, which leaves the docs editor's
// own classes out. So the build also cuts the overlay from docs-editor.css and fails when that one
// holds a rule this one lacks: a class that only the docs editor uses, with a value that the look
// changes, would be drawn in the neutral look on that page.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { LOOK_SOURCE, overlayCss, packagesOf, withFontsBeside } from "./iterate-look.ts";

const ui = resolve(import.meta.dirname, "..");
/** The overlay cut from a build of `source` (a sheet with the look over it) against `neutral`,
 *  the built sheet without it. */
const overlayOf = (source: string, neutral: string) =>
  withFontsBeside(
    overlayCss({
      neutral: readFileSync(join(ui, neutral), "utf8"),
      look: execFileSync(
        join(ui, "node_modules/.bin/tailwindcss"),
        ["--input", source, "--minify"],
        { cwd: ui, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ),
    }),
  );
const { css, files } = overlayOf("src/browser/iterate.css", "dist/styles.css");

const docsOnly = overlayCss({
  neutral: css,
  look: overlayOf("src/browser/docs-editor-look.css", "dist/docs-editor.css").css,
});
if (docsOnly)
  throw new Error(
    `dist/iterate.css lacks the look of classes that only the docs editor uses, so the docs editor's page would draw them in the neutral look. Use a class that another component uses too, or one whose value the look does not change. The rules: ${docsOnly.slice(0, 600)}`,
  );

const require = createRequire(join(ui, "package.json"));
const fontPackages = packagesOf(readFileSync(join(ui, LOOK_SOURCE), "utf8")).map((name) =>
  dirname(require.resolve(`${name}/package.json`)),
);
mkdirSync(join(ui, "dist/fonts"), { recursive: true });
for (const file of files) {
  const from = fontPackages.map((root) => join(root, "files", file)).find(existsSync);
  if (!from) throw new Error(`${file} is in none of ${fontPackages.join(", ")}`);
  copyFileSync(from, join(ui, "dist/fonts", file));
}
const exported = JSON.parse(readFileSync(join(ui, "package.json"), "utf8")).publishConfig.exports;
const unexported = files.filter((file) => !exported[`./fonts/${file}`]);
if (unexported.length > 0)
  throw new Error(
    `package.json does not export ${unexported.join(", ")}: run node scripts/ci/shadcn-registry.ts update`,
  );
writeFileSync(join(ui, "dist/iterate.css"), css);
console.log(
  `dist/iterate.css: ${css.length} bytes, ${files.length} font files; it is the look of the docs editor's classes too`,
);
