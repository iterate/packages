import { expect, test } from "vitest";
import { componentTokens } from "./component-tokens.ts";

test("an item carries the tokens its files use, and only those", () => {
  const tokens = componentTokens({
    tokensCss: TOKENS_CSS,
    sources: [
      `<span className="bg-success/10 text-2xs">Live</span>`,
      `const gutter = { backgroundColor: "var(--info)" };`,
      `<div className="bg-chart-10" />`,
    ],
  });

  expect(tokens).toEqual({
    cssVars: {
      theme: {
        "color-success": "var(--success)",
        "color-info": "var(--info)",
        "text-2xs": "0.6875rem",
        "text-2xs--line-height": "calc(1 / 0.6875)",
      },
      light: { success: "oklch(0.5 0.1 165)", info: "oklch(0.5 0.1 242)" },
    },
  });
});

test("an item that uses none carries nothing", () => {
  expect(
    componentTokens({ tokensCss: TOKENS_CSS, sources: [`<p className="text-sm">Hi</p>`] }),
  ).toEqual({});
});

const TOKENS_CSS = `
@theme inline {
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-info: var(--info);
  --color-chart-1: var(--chart-1);
  --text-2xs: 0.6875rem;
  --text-2xs--line-height: calc(1 / 0.6875);
}
:root {
  --success: oklch(0.5 0.1 165);
  --warning: oklch(0.5 0.1 49);
  --info: oklch(0.5 0.1 242);
  --chart-1: #2a78d6;
}
`;
