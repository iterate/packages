# packages/ui

The UI kit every client app in this repo imports as `@iterate-com/ui/*`, as shadcn's own monorepo
setup shares one `packages/ui`. It is also the shadcn registry an app in another repo installs our
rendered components from, keeping its own copy (`npx shadcn add iterate/packages/context-view`).
And it is published to npm, built for a no-build page to import from a URL
([No-build pages](#no-build-pages-the-npm-package)).

**Which way, from outside this repo** (README.md says the same on npm's page): an app with a build
step that someone will keep installs items from [the registry](#the-registry); a one-off page with
no build (an agent's answer to a request) imports [the npm package](#no-build-pages-the-npm-package)
from esm.sh. `npm install @iterate-com/ui` into an app is not supported: the package bundles its own
React, so an app with its own has two.

## Layout and imports

packages/ui is laid out the way an app looks after `shadcn add`, so the registry holds its files
as they are:

- `src/components/ui/`: shadcn's vendored components (below).
- `src/components/`: our rendered components, one registry item each (a file, or a folder such as
  `context-view/`), and `src/lib/`: their plain helpers, items too.
- `src/apps/` (every app's shell) and `src/hooks/`: not in the registry. Apps in this repo import
  them through the workspace.

Imports use package.json's `#/*` subpath imports (`"#/*": "./src/*"`), with extensions. A file
imports another item's file as `#/components/ui/button.tsx` or `#/components/posthog.tsx`, which
`shadcn add` rewrites to the installing app's aliases (`@/components/ui/button` in an app with `@/`
aliases). The CLI only knows `button` is one of shadcn's components from the `ui/` in that path,
which is why they live in `src/components/ui/`. Files of one item import each other relatively
(`./filters.tsx`): they travel together.

## The registry

It is a [GitHub registry](https://ui.shadcn.com/docs/registry/github). Copybara copies `packages/`
to github.com/iterate/packages after each deploy, and `copybara/packages/registry.json` becomes
that repo's root `registry.json`, which includes this folder's. The CLI reads the items and their
files straight from GitHub. The registry is not built or published.

`registry.json` names each item, describes it and lists its files.
`node scripts/ci/shadcn-registry.ts update` works out the rest from the files and writes it back:
each file's type, the packages they import (`dependencies`), and the items they import through `#/`
(`registryDependencies`: shadcn's by name, such as `button`, and ours by their GitHub address,
`iterate/packages/<item>`). Commit it.

An app installs an item once it has run `shadcn init` with a Base UI style (`base-nova`): our items
name shadcn's components by name, and init installs the packages those use. It also needs
`allowImportingTsExtensions`, because an item's files import each other as `./filters.tsx`. Nothing
goes in its `components.json`:

```sh
npx shadcn@latest add iterate/packages/context-view   # src/components/context-view/*, and code-block, button, sheet, …
```

- **To add an item**, put its files in `src/components/` (or a folder there) and add it to
  `registry.json` with a name, a one-line description and its files, then run `update`. It throws
  on a file no item lists, a relative import of another item's file, a `#/` import of a file that is
  not in the registry (`src/apps/`, `src/hooks/`), and an `@iterate-com/*` import. Each would leave
  the installing app with an import it cannot resolve.
- **Hooks and providers are not items.** They belong in `iterate/react`, which an app installs as a
  package; `use-context-explorer` is still here until it moves.
- **The CLI drops a file's leading comment** when it installs it (shadcn-ui/ui#9206, open fix
  shadcn-ui/ui#11920). The copy here keeps it.
- **Checks.** Lint and Typecheck fails when `registry.json` is not what `update` writes, or the CLI
  finds it invalid. The shadcn workflow (below) installs every item as this commit has it, before
  it is public, into an app with this package's `components.json`, and fails unless that writes
  these files back.

## No-build pages (the npm package)

`@iterate-com/ui` on npm is this package built for a plain HTML page that imports components from a
URL, such as an agent's mini app. Main publishes it with the rest
(`scripts/ci/npm-publish.ts`, under the `main` dist-tag). `pnpm --dir packages/ui build` makes it:

- **tsdown bundles every dependency** (`tsdown.config.ts`), so no import is left for the host to
  resolve, and React, Base UI and CodeMirror load once whichever components a page imports. Vendor
  code sits in chunks named by library, which change only when its version does. The runtime
  dependencies are `devDependencies` for that reason: the published manifest asks for nothing.
- **Entries** (`browser-entries.ts`): one per registry item (its file named after it) and per
  vendored shadcn component, by the same names the apps import (`components/context-view/context-view`,
  `components/ui/button`); `page` (htm's `html`, `render`, React's API); `live` (below); React's own
  modules (`react`, `react/jsx-runtime`, `react-dom/client`, …, `src/browser/`), and `styles.css`
  (Tailwind over all of `src/`). `node scripts/ci/shadcn-registry.ts update` writes them into
  `publishConfig.exports`; esm.sh needs each named, not a wildcard, to keep shared chunks shared.
- **Not for `npm install` into an app**: with React bundled, an app with its own React has two, and
  our components' hooks fail in its tree ("Invalid hook call"). It ships no declarations either: a
  page reads none, and an app in another repo installs the registry's copy.

A page names each package once in an import map. React is the package's own, so
[another React library](#another-react-library) loads from esm.sh with `?external=react,react-dom`
and uses it too:

```html
<script type="importmap">
  {
    "imports": {
      "@iterate-com/ui/": "https://esm.sh/@iterate-com/ui@<version>/",
      "react": "https://esm.sh/@iterate-com/ui@<version>/react",
      "react/": "https://esm.sh/@iterate-com/ui@<version>/react/",
      "react-dom": "https://esm.sh/@iterate-com/ui@<version>/react-dom",
      "react-dom/": "https://esm.sh/@iterate-com/ui@<version>/react-dom/",
      "@tanstack/react-query": "https://esm.sh/@tanstack/react-query@5?external=react,react-dom"
    }
  }
</script>
<link rel="stylesheet" href="https://esm.sh/@iterate-com/ui@<version>/styles.css" />
<div id="root" class="flex h-screen flex-col"></div>
<script type="module">
  import { html, render, useState } from "@iterate-com/ui/page";
  import { ContextView } from "@iterate-com/ui/components/context-view/context-view";

  function App() {
    const [state, setState] = useState({});
    const context = {
      events: [],
      caughtUp: true,
      processors: { rows: [] },
      presence: { actors: [], rpcStubs: [] },
      liveState: {},
    };
    return html`<${ContextView}
      title="/agents/demo"
      context=${context}
      state=${state}
      onStateChange=${(patch) => setState((s) => ({ ...s, ...patch }))}
      className="min-h-0 flex-1"
    />`;
  }
  render(html`<${App} />`, document.getElementById("root"));
</script>
```

- **Pin a version**: `<version>` is exact, such as `dist-tags.main` of
  `https://registry.npmjs.org/@iterate-com/ui` when the page is written.
- **Path-shaped URLs only.** A `?query` URL can't be prefix-mapped: the browser drops the query
  when it resolves a subpath against it.
- **Live data**: `live` is the SDK's browser client built in, so its hooks use this React. A page
  reaches a project by [signing in](#signing-in).
- **The spec** (`test/playwright/ui/no-build-page.spec.ts`, the `ui` project) serves this checkout's
  build from its folder and holds the shape: one React, nothing React-related from esm.sh,
  CodeMirror only once an inspector opens, a source file's code block drawn with its grammar, and
  react-query through `?external=react,react-dom`.

### Another React library

A page can use any React library beside ours: a chart, a data fetcher, a date picker. It loads from
esm.sh with `?external=react,react-dom`, which leaves its `react` and `react-dom` imports, and those
of the packages it brings, for the page's import map:

```json
"recharts": "https://esm.sh/recharts@3.10.1?external=react,react-dom"
```

`examples/events-chart-page.ts` is a whole page: a context's events charted by recharts, above the
same context in ContextView, from one `useIterateContext`.

- **Without the flag** esm.sh gives the library a React of its own. The page is blank and the
  console says "Cannot read properties of null (reading 'useContext')" (or `'useState'`, whichever
  hook runs first): a second React, which isn't the one rendering.
- **`?external=react` alone** leaves a library that imports react-dom (recharts, Floating UI) with
  esm.sh's copy of it, beside the one rendering the page.
- **React is 19**, and only these of its modules: `react`, `react/jsx-runtime`,
  `react/compiler-runtime`, `react-dom`, `react-dom/client`. A library that imports another
  (`react-dom/server`) fails to load, on a 404 from under `@iterate-com/ui`.
- **Only React is shared.** A library built on Base UI or CodeMirror brings its own copy beside
  ours. That works while nothing of one copy is handed to the other (a CodeMirror extension to
  our editor).
- **The library's styles are its own.** Give it the stylesheet's variables for colours
  (`var(--border)`, `var(--muted-foreground)`) and it matches our components.
- **For telemetry over time we have a chart**: `components/time-chart`, which Dash's Analytics
  page uses. A page reads a project's telemetry as SQL, where the deployment has a warehouse (prd
  and previews; not `pnpm dev`), and rows trail their events:
  `await api.projects.get(id).telemetry.query(sql, { hours: 48 })`.
- **The spec** (`test/playwright/ui/third-party-library.spec.ts`) commits the example to a fresh
  project, appends an event in ContextView and sees the chart count it, with no React from esm.sh.

### Signing in

A page reads and changes a project as the person viewing it. How it signs them in depends on where
it is served:

| Served from                                                          | Signs in with                                                                                                                                       | Example                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| The project's own host (`<slug>--<project>.iterate.app`), its worker | The host's session: the worker answers `this.auth.require(request)`, the page calls `createIterateClient().authenticate(location.href)`             | `examples/project-host-page.ts` |
| Any other website (GitHub Pages, jsfiddle, a file on S3)             | Its own OAuth, written in the page: it registers as a client, sends the person to iterate with PKCE, and opens `/api` with the token                | `examples/any-website.html`     |
| A Claude artifact                                                    | The viewer's iterate connector (the artifact's CSP blocks iterate itself): the `mcp` capability's `callTool("iterate", "run", { project, script })` | None: it runs only on claude.ai |

An agent building a page for its project serves it from the project's host: no sign-in UI, and the
worker can write what it knows (the project, its contexts) into the page. On the host and on any
website the page ends with `api`, the person's own, so `useContextStub(() => api.projects.get(id))`
is their project.

On the project's host, a route in worker.ts's `fetch`:

```ts
if (routingSlug === "contexts") {
  const denied = this.auth.require(request);
  if (denied) return denied;
  using itx = this.getItx();
  return await projectHostPage(itx); // awaited: `using` releases itx when the function returns
}
```

On any website the sign-in is the page's own code, about a hundred lines in the example, to copy
and change. Nothing in `iterate` or this package does it for the page. `live` gives it one thing,
the socket, from the copy of capnweb the hooks use:

```js
const api = newWebSocketRpcSession("wss://os.iterate.com/api").authenticate({
  type: "bearer",
  token,
});
```

- **A page that isn't framed** leaves for iterate and comes back to its own address with the code
  (the sign-in waits in `sessionStorage`). No popup.
- **A framed page** (jsfiddle's result pane) can't show iterate's sign-in, and jsfiddle.net's
  `Cross-Origin-Opener-Policy: same-origin` cuts it off from any window it opens. Its own address
  answers a window with a 404 there, so its sign-in ends on `https://callback.iterate.com/`
  instead: a page of iterate's (iterate/config `sign-in-callback.ts`) whose button copies the
  sign-in, which the person pastes back into the page, and which warns them to send it to no one.
  The page keeps the sign-in in `sessionStorage` here too: a phone may reload the tab while the
  person is away.
- **The token stays in memory**; a reload signs in again. Hosts like jsfiddle share one origin
  between every page, so a stored token would be every page's. The client id is stored, per
  address.
- **A platform on localhost** (`pnpm dev`): Chrome asks the person before a public page reaches it
  (Local Network Access).
- **In an artifact**, ui loads from `https://cdn.jsdelivr.net/npm/@iterate-com/ui@<version>/dist/`
  (its CSP allows that CDN, not esm.sh; the files end `.mjs`) with `styles.css` inlined, and
  declares `{ "mcp": { "servers": [{ "server": "iterate", "tools": ["run"] }] } }`. Then
  `(await window.claude.use("mcp")).callTool("iterate", "run", { project, script }, { cache: false })`
  runs `script` (`async (itx) => …`) as the viewer and answers `{ payload: { result } }`. Nothing
  is live: the page reads again to refresh.
- **The spec** (`test/playwright/ui/sign-in.spec.ts`) commits the project-host example to a fresh
  project, on the route its own header comment gives, and opens it, and serves the any-website
  example twice: on its own, and as jsfiddle would
  (an editor with that header, the page in a sandboxed frame from another origin, and a stand-in
  for callback.iterate.com, which is on prd and not this repo's to test).

## Vendored shadcn components

shadcn's styled components are copy-only by design: there is no styled package. So packages/ui
vendors them. Each of these files is byte for byte what the pinned shadcn CLI writes through
`components.json` (style `base-nova`, on Base UI), and nobody edits one here: alert-dialog, avatar,
badge, breadcrumb, button, card, checkbox, command, dialog, dropdown-menu, empty, field, input,
label, native-select, select, separator, sheet, sidebar, skeleton, sonner, spinner, table, tabs,
textarea and tooltip in `src/components/ui/`, plus `src/components/ui/input-group.tsx` (command's
dependency) and `src/hooks/use-mobile.ts` (sidebar's). Apps import them as
`@iterate-com/ui/components/ui/<name>`.
core/os keeps its own copies of the ones it uses (avatar, button, checkbox, field, input, label,
native-select, separator and spinner) in `core/os/src/components/ui/`, written through its own
`components.json`, and imports nothing from here. Everything below applies to both folders.
`scripts/ci/shadcn-drift.ts` lists them (`VENDORINGS`).

- **Customise at the call site or in a wrapper** of our own, never in the file: a `className`, a
  prop, or a component here that renders the vendored one. The table below shows where each earlier
  local change went.
- **Keep the `dark:` classes.** Don't strip them. The apps are light mode only, and `globals.css`
  makes `dark:` never match (`@custom-variant dark (@media not all)`). Dev CSS keeps those rules
  inside `@media not all`; the production build drops the block, so they ship no bytes.
- **`cn` comes from the `cn` package** (shadcn's replacement for clsx + tailwind-merge), which the
  CLI's components import directly. Our own files import it the same way. `components.json`'s
  `aliases.utils` is `cn` itself, so the CLI rewrites a registry item's `@/lib/utils` import (the
  AI Elements items still use one) to `import { cn } from "cn"`; there is no `lib/utils.ts`.
- **`globals.css` imports `shadcn/tailwind.css`**: the `data-*` variants these components are
  written against, `no-scrollbar`, `scroll-fade` and `shimmer`. It comes from the `shadcn`
  devDependency, pinned exactly, which is also the CLI.
- **Our tooling leaves them alone.** oxlint (the `iterate/*` and jsx-a11y rules included), oxfmt
  and the `rules/` review rules exclude them, each list naming the files.
  `scripts/ci/shadcn-drift.test.ts` checks that the oxlint list, the oxfmt list, every `rules/`
  rule that would match one and the drift check's path filter cover all of them. knip needs no
  list: the `package.json` exports (`./components/*`, `./hooks/*`) make every file an
  entry, so it never reports their unused exports.

### Refresh

```sh
node scripts/ci/shadcn-drift.ts refresh  # shadcn add <every item> -o -y
git diff                                 # review what upstream changed
```

Review the diff instead of re-applying patches: there are none. Keep a dependency the CLI adds to
`package.json`, run `pnpm install`, then typecheck packages/ui and each app. To look at one file
first, without writing anything:

```sh
pnpm --dir packages/ui exec shadcn add button --dry-run --diff src/components/ui/button.tsx
```

To bump the CLI, change the `shadcn` pin in the catalog (`pnpm-workspace.yaml`) and refresh. To
vendor another item, run `pnpm --dir <folder> exec shadcn add <item>`, then add it to that folder's
`items` in `VENDORINGS` (and any extra file it writes to `extraFiles`) and to the lists above.

### The drift check

- **On a pull request** that touches a vendored file or an input of the CLI in either folder
  (`components.json`, `package.json`, `tsconfig.json`, the stylesheet), `.depot/workflows/shadcn-drift.yml` runs
  `shadcn-drift.ts check`. It asks the CLI's dry run for the exact content `add` would write, from
  shadcn's live registry, and fails on any file whose bytes differ, printing the diff. (The CLI's
  own "identical" ignores line endings and leading and trailing whitespace; the check does not.)
  The fix is a refresh, even when the difference is upstream moving rather than a hand edit. It is
  not a required check, and a pull request that leaves these files alone never runs it: it needs
  the network.
- **The same workflow runs the registry's round trip** (`shadcn-registry.ts round-trip`) when
  `registry.json` or an item's files change. It needs the network for the shadcn items ours name.

### Where the local changes went

| Was in                                   | Now                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| button: hover title                      | Each icon-size `Button`, and each `SidebarTrigger` (upstream's icon-size Button), passes `title`; `iterate/icon-button-has-hover-text` requires it at the call site                                                                                                            |
| sheet: full width (iterate/iterate#1883) | The `SheetContent` call site passes `data-[side=right]:w-full`. Below `sm`, a rule in `globals.css` makes every sheet full width anyway, keyed on its slot: one whose call site forgets, and the phone's sidebar sheet, which the vendored `Sidebar` renders with no className |
| sidebar: close (iterate/iterate#1984)    | `SidebarNav` in `app-shell.tsx`: a same-tab link click closes the phone's sheet (shadcn-ui/ui#5561)                                                                                                                                                                            |
| command: ⌘K look (iterate/iterate#2991)  | `app-shell-palette.tsx`: the classNames it passes, its own search row over cmdk's input, and Dialog's parts instead of `CommandDialog` (whose title sits outside the popup, on every page)                                                                                     |
| sonner: light only                       | `AppProviders` renders `<Toaster theme="light" />`; `toast` is imported from `sonner`                                                                                                                                                                                          |
| dialog, sheet: close                     | Upstream's: an sr-only "Close"                                                                                                                                                                                                                                                 |
| breadcrumb, label                        | Upstream's                                                                                                                                                                                                                                                                     |

Everything else here is our own code.

## The repo IDE

`src/components/repo-ide/` is a small IDE over one of a project's repos: a file tree, an editable
CodeMirror buffer with a diff against the last commit, staging, commit and history. Dash's
`/projects/<slug>/repos/<name>` is the first host; any app that holds the project's root context can
mount it the same way:

```tsx
import { RepoIde } from "@iterate-com/ui/components/repo-ide/repo-ide";
import { RepoIdeSearch } from "@iterate-com/ui/components/repo-ide/repo-ide-search";

// route: `validateSearch: RepoIdeSearch`, so the open file, the diff and the sidebar are the URL
const context = useContextStub(() => api.projects.get(project.id), [api, project.id]);
// in a flex row with `min-h-0 flex-1`; the IDE fills it
<RepoIde
  project={context.stub}
  projectId={project.id}
  repoPath="/repos/config"
  author={{ name: email, email }}
  search={search}
  onSearchChange={(patch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })}
/>;
```

- **The host owns** the project stub, the route and the shell; the IDE owns everything inside its
  box. It imports no SDK at runtime (`project` is typed from `iterate/app`), no router, and nothing
  from an app. Its view state is the `search` prop, so a host without a router keeps it in state.
- **Parts that stand alone**: `repo-file-tree` (pierre, with git-status marks and a right-click
  menu), `repo-code-editor` (one file: language, gutter marks, inline diff), `markdown-preview` and
  `html-preview` (sandboxed), and `repo-client` (`useRepoFiles` follows a repo's commits;
  `readRepoFile`). Import the one you need by its path; the rest of the folder is the IDE's own.
- **Client only**: the working tree is read from `localStorage` while rendering, so mount the IDE
  where the page is not server rendered (a route under an `ssr: false` parent, as Dash's are, or
  `ClientOnly`).
- **CodeMirror loads when an editor first mounts** (every `@codemirror/*` import in the folder is
  a dynamic `import()` in `codemirror.ts`), so a page that never shows a file never pays for it. In
  a TanStack Start file route import `RepoIde` statically: the route's component is already its own
  chunk, prefetched on link hover, and a `lazy()` inside it only starts the download after the
  project opens. A host without route code splitting wraps it in `lazy()` itself.
- **Markdown preview** renders through streamdown, whose classes Tailwind finds only if the app's
  stylesheet scans it: `@source "../node_modules/streamdown/dist/*.js";` (dash's `styles.css`).
- **Text only**: the repo's reads and commits carry text, so images and archives show a notice.
- **React Doctor**: `npx react-doctor@latest --yes src/components/repo-ide/*.tsx src/components/repo-ide/*.ts`
  from this package scores 100; keep it there.

## The agent chat

`src/components/agent-chat/` is one agent's conversation: its chat with a composer, its events
(`ContextView`), and the traces of its LLM requests and script runs. The Agents app's
`/projects/<slug>` is the first host; any page that holds the agent's context mounts it the same way:

```tsx
import {
  AgentChat,
  agentChatContextOptions,
} from "@iterate-com/ui/components/agent-chat/agent-chat";
import { AgentChatState } from "@iterate-com/ui/components/agent-chat/agent-chat-search";

// route: `validateSearch: AgentChatState`, so the tab and the open trace are the URL
const agent = useContextStub(() => project.cd(path), [project, path]);
const log = useIterateContext(agent.stub, agentChatContextOptions);
// in a flex column with a bounded height; the chat fills it
<AgentChat
  path={path}
  context={log}
  error={agent.error}
  state={search}
  onStateChange={(patch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })}
  onMessage={async ({ message, files }) => {
    await project.agents.get(path).message({ message, files });
  }}
  onAppend={agent.stub ? (events) => agent.stub.append(...events) : undefined}
  signedUrl={async (file) => (await agent.stub.files.get(file).url()).url}
/>;
```

- **The host owns** the agent's context, the hook and the route; the chat owns everything inside its
  box. It imports no router and none of the SDK's client. Its view state is the `state` prop, so a
  host without a router keeps it in state.
- **It reads the agent's own events**, so it imports three of the SDK's pure modules at runtime
  (`iterate/agents/contract`, `iterate/agents/codemode-format`, `iterate/stream/run`).
- **`agentChatContextOptions`** is what the chat asks of `useIterateContext`: the streamed chunk
  windows by name (a wildcard never matches an ephemeral) and every page of the log. Without them
  an answer does not stream, and a long chat shows only its newest page.
- **A row of the page's own** goes under a feed item: `itemFooter={(item) => …}`. `renderers` and
  `inspectors` name the page's own event types in the Events tab, over the agent's.
- **For the project's own people**: it shows the raw log, scripts and traces, and its composer
  appends raw events.
- **Toasts**: the copy buttons call sonner's `toast`, so the page renders this package's `Toaster` once
  (`AppProviders` does in the apps).
- **Markdown** renders through streamdown, whose classes an app's stylesheet scans as for the repo
  IDE's preview. The streamed-token reveal is `.animate-token-in` in `globals.css`; an app that
  installs the item from the registry copies those lines, or its tokens appear without it.
- **Tests** sit beside the files: the reducer's (`agent-ui-reducer.test.ts`) and the log's
  (`agent-events.test.ts`). `.agents/skills/fix-stream` says which a broken chat adds a row to.

## Every app's shell

`src/apps/` is what each TanStack Start app's own shell files call with only what the app does
differently: `server.ts` (`appServerEntry`, the Worker entry, typed by `tsconfig.worker.json`
against the Workers types), `router.tsx` (`createAppRouter`), `document.tsx` (`AppDocument`) and
`head.ts` (`appHead`, with the one viewport every app has).
