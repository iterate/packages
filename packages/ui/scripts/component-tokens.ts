// component-tokens.ts — what a registry component item carries of src/styles/tokens.css, the
// variables packages/ui's components use beyond shadcn's own (the status colours, the highlight,
// chart series, `text-2xs`). An app that installs the item from the shadcn registry gets the ones its
// files use as the item's `cssVars`: each theme name, and a colour's neutral value. shadcn 4.21's
// `add` writes a component item's values only where the app has none, so an app that installed
// iterate's `theme` item first keeps iterate's colours.
import postcss from "postcss";

/** The path of the tokens' file in packages/ui. */
export const TOKENS_SOURCE = "src/styles/tokens.css";

/** The `cssVars` for what `sources` use of `tokensCss`: a colour by any utility (`bg-success/10`)
 *  or `var(--success)`, any other theme value by its utility (`text-2xs`, and its line height with
 *  it). Nothing when they use none. Pure. */
export function componentTokens(input: { tokensCss: string; sources: string[] }) {
  const root = postcss.parse(input.tokensCss);
  const values = new Map<string, string>();
  root.walkRules(":root", (rule) =>
    rule.walkDecls((decl) => void values.set(decl.prop.slice(2), decl.value)),
  );
  const theme: Record<string, string> = {};
  const light: Record<string, string> = {};
  root.walkAtRules("theme", (atRule) =>
    atRule.walkDecls((decl) => {
      const name = decl.prop.slice(2);
      const colour = name.match(/^color-(.+)$/)?.[1];
      const used = colour
        ? new RegExp(`(?<![\\w-])[a-z-]+-${colour}(?:/\\d+)?(?![\\w-])|var\\(--${colour}\\)`)
        : new RegExp(`(?<![\\w-])${name.replace(/--.*$/, "")}(?![\\w-])`);
      if (!input.sources.some((source) => used.test(source))) return;
      theme[name] = decl.value;
      if (colour) light[colour] = values.get(colour)!;
    }),
  );
  if (Object.keys(theme).length === 0) return {};
  return {
    cssVars: { theme, ...(Object.keys(light).length > 0 && { light }) },
  };
}
