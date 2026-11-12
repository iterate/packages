import { expect, test } from "vitest";
import { frameCarriesStyle, frameSheet } from "./host.ts";

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

test("a sheet on the page's own host goes into the frame as text, since the frame has no sign-in to ask for it with; a sheet of another host stays a link", () => {
  const page = "https://agents.example.com";
  const theme = [
    ":root { color-scheme: light; --primary: oklch(0.2 0 0); }",
    "body { margin: 0px; }",
  ];
  // the mind's theme, behind the app's guard: its rules, and no address for the frame to ask
  const own = frameSheet({ href: `${page}/theme.css`, media: "", rules: theme }, page);
  expect(own).toBe(`<style>${theme.join("\n")}</style>`);
  expect(own).not.toContain("theme.css");
  // this package's sheet on a module server: public, so the link, whether the page can read it or not
  const kit = "https://esm.example.com/@iterate-com/ui@1.0.0/dist/styles.css";
  expect([
    frameSheet({ href: kit, media: "", rules: null }, page),
    frameSheet({ href: kit, media: "", rules: [".flex { display: flex; }"] }, page),
  ]).toEqual([`<link rel="stylesheet" href="${kit}">`, `<link rel="stylesheet" href="${kit}">`]);
  // a sheet of the page's own that has not loaded yet: the link, as before
  expect(frameSheet({ href: `${page}/app.css`, media: "", rules: null }, page)).toBe(
    `<link rel="stylesheet" href="${page}/app.css">`,
  );
  // the sheet's media goes with it, and no text of a rule ends the style element early
  expect(
    frameSheet(
      { href: `${page}/print.css`, media: "print", rules: ['a::after { content: "</style>"; }'] },
      page,
    ),
  ).toBe('<style media="print">a::after { content: "<\\/style>"; }</style>');
});
