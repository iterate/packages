// The docs editor's own icons have a chunk of their own (browser-entries.ts `docsEditorIcons`), so
// that the pages that show no doc do not load them with the icons every page shares. The list is
// held to the sources: an icon that only the docs editor imports is on it, and no other is.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";
import { docsEditorIcons } from "../../../browser-entries.ts";

test("the docs editor's icon chunk holds exactly the icons that no other file of the kit imports", () => {
  const src = join(import.meta.dirname, "../..");
  const importers = new Map<string, string[]>();
  for (const file of sourceFiles(src)) {
    const code = readFileSync(file, "utf8");
    // an import and a re-export alike (browser/icons.ts hands its icons on with `export { … }`),
    // and an icon by either of the names lucide gives it: `Trash2` and `Trash2Icon` are one file
    for (const [, names] of code.matchAll(
      /(?:import|export)\s*\{([^}]*)\}\s*from\s*"lucide-react"/g,
    ))
      for (const name of names!.split(",").map((part) => iconOf(part.trim().split(/\s+/)[0]!)))
        if (name) importers.set(name, [...(importers.get(name) || []), relative(src, file)]);
  }
  const ofTheDocsEditorAlone = [...importers]
    .filter(([, files]) => files.every((file) => file.startsWith("components/docs-editor/")))
    .map(([name]) => fileNameOf(name))
    .sort();
  expect(ofTheDocsEditorAlone.length).toBeGreaterThan(0);
  expect([...docsEditorIcons].sort()).toEqual(ofTheDocsEditorAlone);
});

/** An icon by its one name: lucide exports each as `X`, `XIcon` and `LucideX`. */
const iconOf = (name: string) => name.replace(/^Lucide(?=[A-Z])/, "").replace(/Icon$/, "");

/** lucide's file for an icon: `Heading1` is heading-1, `CodeXml` is code-xml. */
const fileNameOf = (icon: string) =>
  icon
    .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();

/** Every source file under `dir` that is not a test. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
