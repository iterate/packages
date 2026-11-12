// The check that dist/docs-editor.css holds dist/styles.css in its order. The sheets here are cut
// from Tailwind's minified output; the build runs the check on the real ones
// (check-docs-editor-css.ts).
import { expect, test } from "vitest";
import { rulesMissingInOrder } from "./stylesheet-order.ts";

const styles = [
  "@layer theme,base,components,utilities;",
  "@layer theme{:root,:host{--color-red-500:red}}",
  "@layer utilities{.hidden{display:none}.flex{display:flex}",
  "@media (width>=48rem){.md\\:block{display:block}.md\\:hidden{display:none}}}",
  "@supports (-moz-orient:inline){@layer base{*{--tw-ring-color:initial}}}",
].join("");

test.for([
  { name: "the same sheet", whole: styles, missing: [] },
  {
    name: "a whole build with the docs editor's classes too: a utility and a variant more, a theme and fallback with more properties, Atomic's rules after",
    whole: [
      "@layer theme,base,components,utilities;",
      "@layer theme{:root,:host{--color-red-500:red;--color-highlight:var(--highlight)}}",
      "@layer utilities{.hidden{display:none}.flex{display:flex}.grid-cols-6{grid-template-columns:repeat(6,minmax(0,1fr))}",
      "@media (width>=48rem){.md\\:block{display:block}.md\\:flex-row{flex-direction:row}.md\\:hidden{display:none}}}",
      "@supports (-moz-orient:inline){@layer base{*{--tw-ring-color:initial;--tw-shadow:0 0 #0000}}}",
      ".atomic-cm-editor{position:relative}",
    ].join(""),
    missing: [],
  },
  {
    // a second sheet of utilities alone, linked after styles.css, is not a whole: its plain
    // `.hidden` would come after styles.css's `md:block` in the one `utilities` layer, and win
    name: "the docs editor's utilities alone, as a second sheet",
    whole:
      "@layer utilities{.hidden{display:none}.grid-cols-6{grid-template-columns:repeat(6,minmax(0,1fr))}}",
    missing: [
      "@layer theme,base,components,utilities",
      "@layer theme\n:root,:host",
      "@layer utilities\n.flex",
      "@layer utilities\n@media (width>=48rem)\n.md\\:block",
      "@layer utilities\n@media (width>=48rem)\n.md\\:hidden",
      "@supports (-moz-orient:inline)\n@layer base\n*",
    ],
  },
  {
    name: "a variant before the plain utility it overrides",
    whole: [
      "@layer theme,base,components,utilities;",
      "@layer theme{:root,:host{--color-red-500:red}}",
      "@layer utilities{@media (width>=48rem){.md\\:block{display:block}.md\\:hidden{display:none}}",
      ".hidden{display:none}.flex{display:flex}}",
      "@supports (-moz-orient:inline){@layer base{*{--tw-ring-color:initial}}}",
    ].join(""),
    missing: [
      "@layer utilities\n@media (width>=48rem)\n.md\\:block",
      "@layer utilities\n@media (width>=48rem)\n.md\\:hidden",
    ],
  },
  {
    name: "a rule whose declarations differ",
    whole: styles.replace(".flex{display:flex}", ".flex{display:inline-flex}"),
    missing: ["@layer utilities\n.flex"],
  },
])("$name", ({ whole, missing }) => {
  expect(rulesMissingInOrder({ sheet: styles, whole })).toEqual(missing);
});
