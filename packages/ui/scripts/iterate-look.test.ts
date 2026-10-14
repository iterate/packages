import { expect, test } from "vitest";
import {
  fontFilesOf,
  overlayCss,
  themeAppliedProblems,
  themeItem,
  withFontsBeside,
} from "./iterate-look.ts";

test("the overlay keeps what the look's build has and the neutral build lacks, in the at-rules around it, with its font files beside it", () => {
  const neutral = [
    "@layer theme{:root,:host{--font-sans:system-ui;--radius-2xl:1rem}}",
    "@layer utilities{.p-1{padding:.25rem}.rounded-full{border-radius:calc(infinity*1px)}",
    "@media (width>=40rem){.sm\\:rounded-full{border-radius:calc(infinity*1px)}}}",
    ":root{--background:oklch(1 0 0)}",
  ].join("");
  const look = [
    "@layer theme{:root,:host{--font-sans:Ubuntu;--radius-2xl:0}}",
    "@layer utilities{.p-1{padding:.25rem}.rounded-full{border-radius:0}",
    "@media (width>=40rem){.sm\\:rounded-full{border-radius:0}}",
    ".font-readme{font-family:var(--font-mono)}}",
    ":root{--background:oklch(1 0 0)}:root{--background:#fff}",
    '@font-face{font-family:Ubuntu;src:url(./files/ubuntu-latin-400-normal.woff2)format("woff2"),url(./files/ubuntu-latin-400-normal.woff)format("woff")}',
  ].join("");

  expect(withFontsBeside(overlayCss({ neutral, look }))).toMatchInlineSnapshot(`
    {
      "css": "@layer theme{:root,:host{--font-sans:Ubuntu;--radius-2xl:0}}@layer utilities{.rounded-full{border-radius:0}}@layer utilities{@media (width>=40rem){.sm\\:rounded-full{border-radius:0}}}@layer utilities{.font-readme{font-family:var(--font-mono)}}:root{--background:#fff}@font-face{font-family:Ubuntu;src:url(./fonts/ubuntu-latin-400-normal.woff2) format("woff2")}",
      "files": [
        "ubuntu-latin-400-normal.woff2",
      ],
    }
  `);
});

test("a stylesheet the theme item was added to is checked for each of its values", () => {
  const item = themeItem({
    css: `@import "@fontsource/ubuntu/400.css";
:root { --background: #ffffff; }
@theme inline { --font-sans: "Ubuntu", sans-serif; }
@layer base { :where([data-slot="card-description"]) { @apply font-readme; } }`,
    read: () => "",
  });
  const added = `@import "tailwindcss";
@import "@fontsource/ubuntu/400.css";
@theme inline { --color-background: var(--background); --font-sans: "Ubuntu", sans-serif; }
:root { --background: #ffffff; }
@layer base { :where([data-slot="card-description"]) { @apply font-readme; } }`;

  expect(themeAppliedProblems({ item, css: added })).toEqual([]);
  expect(
    themeAppliedProblems({
      item,
      css: added
        .replace('@import "@fontsource/ubuntu/400.css";', "")
        .replace("#ffffff", "oklch(1 0 0)")
        .replace("@apply font-readme;", ""),
    }),
  ).toEqual([
    ":root --background: oklch(1 0 0)",
    '@import "@fontsource/ubuntu/400.css" missing',
    ':where([data-slot="card-description"]) lacks @apply font-readme',
  ]);
});

test("the font files are each woff2 the look's font imports name, which the package exports one by one", () => {
  const faces = (weight: number) =>
    ["latin", "latin-ext"]
      .map(
        (subset) =>
          `@font-face{font-weight:${weight};src:url(./files/ubuntu-${subset}-${weight}-normal.woff2) format("woff2"),url(./files/ubuntu-${subset}-${weight}-normal.woff) format("woff")}`,
      )
      .join("");

  expect(
    fontFilesOf({
      css: `@import "@fontsource/ubuntu/700.css";\n@import "@fontsource/ubuntu/400.css";\n@import "iterate/tokens.css";`,
      read: (specifier) => faces(Number(/(\d+)\.css$/.exec(specifier)![1])),
    }),
  ).toEqual([
    "ubuntu-latin-400-normal.woff2",
    "ubuntu-latin-700-normal.woff2",
    "ubuntu-latin-ext-400-normal.woff2",
    "ubuntu-latin-ext-700-normal.woff2",
  ]);
});
