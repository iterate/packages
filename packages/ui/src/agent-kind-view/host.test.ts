import { expect, test } from "vitest";
import { frameCarriesStyle } from "./host.ts";

test("the frame carries the page's own style text, and not the rules an editor of the page generated", () => {
  // the page's theme, as a no-build app puts it into itself
  expect(frameCarriesStyle(":root { color-scheme: light; --radius: 0.625rem; }")).toBe(true);
  expect(frameCarriesStyle("")).toBe(true);
  // CodeMirror's own: rules for the class names it counts out, which mean other things in a
  // frame whose editors count again
  expect(
    frameCarriesStyle(
      ".\u037c1 .cm-content { font-family: monospace }\n.\u037c1.cm-focused { outline: 1px dotted #212121 }",
    ),
  ).toBe(false);
});
