// After `pnpm build`'s stylesheets: dist/docs-editor.css, which the docs editor's page links in
// place of dist/styles.css, holds every rule of dist/styles.css in its order (stylesheet-order.ts),
// or the build fails.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rulesMissingInOrder } from "./stylesheet-order.ts";

const dist = resolve(import.meta.dirname, "../dist");
const missing = rulesMissingInOrder({
  sheet: readFileSync(resolve(dist, "styles.css"), "utf8"),
  whole: readFileSync(resolve(dist, "docs-editor.css"), "utf8"),
});
if (missing.length > 0)
  throw new Error(
    `dist/docs-editor.css lacks ${missing.length} rules of dist/styles.css, or has them out of order, so the docs editor's page would compute other styles than every other page:\n${missing.slice(0, 20).join("\n\n")}`,
  );
console.log("dist/docs-editor.css holds every rule of dist/styles.css, in its order");
