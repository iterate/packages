# The stylesheets

- `globals.css` (`@iterate-com/ui/globals.css`): shadcn's neutral look. Every app's stylesheet
  imports it, and the published `dist/styles.css` and the registry items are written against it.
- `tokens.css`, which `globals.css` imports: our tokens beyond shadcn's variables, with neutral
  values. The status colours `success`, `warning` and `info` (beside shadcn's `destructive`),
  `highlight`, `chart-1` to `chart-5`, and the `text-2xs` size. A registry item carries the tokens
  its files use as `cssVars` (`scripts/component-tokens.ts`).
- `iterate.css` (`@iterate-com/ui/iterate.css`): iterate's look over the neutral one. Ubuntu, the
  issuer's palette, square corners, hard shadows on what floats, inline `<code>` on a grey fill, and
  the `font-readme` role. No app in this repo loads it: the apps use shadcn's neutral palette, and
  should stay that way unless the owner asks otherwise. The look stays here for a page that asks for
  it.

## Rules

- Every look is light, whatever the system says, and there is no theme switch. shadcn's dark
  palette is in `globals.css` under the class `dark` on `<html>`, for a page that sets it. Our
  tokens give both values as `light-dark(light, dark)`, so a registry item carries one value.
  CodeMirror follows the class through `src/lib/codemirror-theme.ts`.
- `font-readme` is for a description, help text or an empty state. `font-mono` is for ids, paths and
  code. `font-readme` produces nothing without the look, so a component that uses it is plain on a
  neutral page.
- A page opts in to the look in one of three ways, all cut from `iterate.css`: an app's stylesheet
  imports `@iterate-com/ui/iterate.css` after `globals.css`; a no-build page links the published
  `iterate.css` after `styles.css`; an app in another repo runs
  `npx shadcn@latest add iterate/packages/theme`. After you change `iterate.css`, `pnpm build` cuts
  `dist/iterate.css` and copies its fonts (`scripts/build-iterate-css.ts`), and
  `node scripts/ci/shadcn-registry.ts update` rewrites the `theme` item.
- `dist/styles.css` (`src/browser/styles.css`) makes Tailwind scan every file in the package except
  `registry.json` and `scripts/`, which name the look's utilities without using them.
- `globals.css` also holds the agent chat's `.animate-token-in`. An app that installs the chat from
  the registry copies those lines.
