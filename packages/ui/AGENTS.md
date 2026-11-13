# packages/ui

`@iterate-com/ui`, the UI kit that every client app in this repo imports as `@iterate-com/ui/*`.
The same files are also a shadcn registry for apps in other repos, and an npm package built for
no-build pages. [README.md](README.md) tells outside users which one to use. `packages/` is copied
to the public iterate/packages repo, so write nothing private here.

## Layout and imports

The package has the layout of an app after `shadcn add`, so the registry serves its files as they
are:

- `src/components/ui/`: shadcn's components, vendored byte for byte. Do not edit them
  ([src/components/ui/AGENTS.md](src/components/ui/AGENTS.md)).
- `src/components/` and `src/lib/`: our components and their plain helpers. Each file or folder is
  one registry item.
- `src/apps/` (the shell that every app's `server.ts`, `router.tsx`, `document.tsx` and `head.ts`
  call), `src/hooks/` and `src/agent-kind-view/`: not in the registry. Apps in this repo import them
  through the workspace.
- Imports use the `#/*` subpath import, with extensions: `#/components/ui/button.tsx`. `shadcn add`
  rewrites these to the installing app's aliases. The CLI identifies a shadcn component only by the
  `ui/` in its path. Files of one item import each other relatively (`./filters.tsx`), because they
  travel together.

## The registry

`registry.json` names each item, gives a one-line description and lists its files.
`node scripts/ci/shadcn-registry.ts update` calculates the rest (dependencies, registry
dependencies, the `theme` item, `publishConfig.exports`) and writes `registry.json` and
`package.json`. Run it after you add or move a file, or change an import, and commit both files.
Lint and Typecheck fails when they are stale. The script's header explains the registry.

- `update` throws when an installing app would get an import it cannot resolve: a file in
  `src/components/` or `src/lib/` that no item lists, a relative import of another item's file, a
  `#/` import of a file outside the registry (`src/apps/`, `src/hooks/`), or an `@iterate-com/*`
  import.
- Hooks and providers are not items. They belong in `iterate/react`. `use-context-explorer` stays
  here until it moves.
- The shadcn CLI drops a file's leading comment when it installs it (shadcn-ui/ui#9206). The copy
  here keeps it.

## The npm package

`pnpm --dir packages/ui build` (tsdown, `tsdown.config.ts`) makes the package that a no-build page
imports from esm.sh. Main publishes it under the `main` dist-tag.

- The build bundles every dependency, React included, so the runtime dependencies are
  `devDependencies`. For this reason, do not `npm install` the package into an app: the app gets a
  second React, and our hooks fail with "Invalid hook call".
- `browser-entries.ts` names the entries: one for each item and each vendored component, plus
  `page`, `live`, React's own modules (`src/browser/`) and `styles.css`. esm.sh needs each entry
  named, not a wildcard, to keep shared chunks shared.
- The default config's apps (`core/configs/default/apps/*/index.html`) import one pinned build
  through their import maps, so a change here reaches them only when that pin moves.
- How a page uses the package and signs in: [examples/README.md](examples/README.md).

## Quality bar

- Colours are tokens and text sizes are steps (`lint/design-tokens.test.ts`). The tokens and the
  look are in [src/styles/AGENTS.md](src/styles/AGENTS.md).
- The repo IDE, the virtual log, the context view and the agent chat score 100 on React Doctor.
  Keep them there. The commands are in the folders' `AGENTS.md` files.
- The browser specs of this package (`test/playwright/ui/*.spec.ts`) left the repo with `core/os`.
  `git show cbf560aa7:test/playwright/ui/<name>.spec.ts` shows what they held.

## Topic notes

- [src/components/virtual-log/AGENTS.md](src/components/virtual-log/AGENTS.md): the root of every
  view of a log.
- [src/components/agent-chat/AGENTS.md](src/components/agent-chat/AGENTS.md): one agent's
  conversation.
- [src/components/repo-ide/AGENTS.md](src/components/repo-ide/AGENTS.md): the IDE over one repo.
- `components/dash` is a mind's Dash, drawn from lists, for a no-build page: the shell takes
  the pages and the groups of links, and each kit page (`DashRepo`, `DashSecrets`, …) takes the
  member's `itx` and does its own reads. A page imports its larger part with `import()` of that
  item's own entry file, never of a file that is no entry: on esm.sh only an entry stays one
  module. Its URL is `lib/page-url`; the member's socket is `live`'s `memberItx`.
- The Agents app's parts (`components/agents-nav`, `components/agents-home`, `lib/agent-summary`)
  serve the hosted app and a mind's own no-build page. None imports a router. They take
  `agentHref(path)` and `onOpen(path)`, so that a page with a client router can make a plain click
  a route change.
