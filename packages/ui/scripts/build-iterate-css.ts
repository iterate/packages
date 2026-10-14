// dist/iterate.css and dist/fonts/, after dist/styles.css: the look's overlay for a no-build page
// (iterate-look.ts says how it is cut). `pnpm build` runs it last.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { LOOK_SOURCE, overlayCss, packagesOf, withFontsBeside } from "./iterate-look.ts";

const ui = resolve(import.meta.dirname, "..");
const look = execFileSync(
  join(ui, "node_modules/.bin/tailwindcss"),
  ["--input", "src/browser/iterate.css", "--minify"],
  { cwd: ui, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
const { css, files } = withFontsBeside(
  overlayCss({ neutral: readFileSync(join(ui, "dist/styles.css"), "utf8"), look }),
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
console.log(`dist/iterate.css: ${css.length} bytes, ${files.length} font files`);
