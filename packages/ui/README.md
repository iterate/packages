# @iterate-com/ui

iterate's React components: the stream viewer (`ContextView`), the repo IDE, code views, and
shadcn's components on Base UI. Which way to use them depends on what you're building:

| Building                                                           | Use                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| An app with a build step, that you'll keep                         | The shadcn registry: `npx shadcn add iterate/packages/<item>` |
| A one-off page with no build (an agent's answer to a request, say) | This package from esm.sh, with an import map                  |

`npm install @iterate-com/ui` into an app is not supported (below).

## An app: the shadcn registry

```sh
npx shadcn add iterate/packages/context-view
```

The component's source lands in your app, on your React and your dependencies, for you to change.
The items are in
[registry.json](https://github.com/iterate/packages/blob/main/packages/ui/registry.json); setup is
in [AGENTS.md](https://github.com/iterate/packages/blob/main/packages/ui/AGENTS.md#the-registry).

## A one-off page: esm.sh

A page an agent might write when asked what happened in an email thread: its worker answers
`./events` with the thread's context's events, and the page shows them in the stream viewer,
polling for new ones.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Re: Tomorrow's huddle</title>
    <script type="importmap">
      {
        "imports": {
          "@iterate-com/ui/": "https://esm.iterate.com/@iterate-com/ui@<version>/",
          "react": "https://esm.iterate.com/@iterate-com/ui@<version>/react",
          "react/": "https://esm.iterate.com/@iterate-com/ui@<version>/react/",
          "react-dom": "https://esm.iterate.com/@iterate-com/ui@<version>/react-dom",
          "react-dom/": "https://esm.iterate.com/@iterate-com/ui@<version>/react-dom/",
          "@tanstack/react-query": "https://esm.iterate.com/@tanstack/react-query@5?external=react,react-dom"
        }
      }
    </script>
    <link rel="stylesheet" href="https://esm.iterate.com/@iterate-com/ui@<version>/styles.css" />
    <!-- optional: iterate's look (Ubuntu, square corners) over the neutral one -->
    <link rel="stylesheet" href="https://esm.iterate.com/@iterate-com/ui@<version>/iterate.css" />
  </head>
  <body>
    <script type="module">
      import { html, render, useState } from "@iterate-com/ui/page";
      import { ContextView } from "@iterate-com/ui/components/context-view/context-view";
      import { Badge } from "@iterate-com/ui/components/ui/badge";
      import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

      function Thread() {
        const events = useQuery({
          queryKey: ["events"],
          queryFn: () => fetch("./events").then((response) => response.json()),
          refetchInterval: 5000,
        });
        // the view's own state: the open inspector, the search, the filters
        const [state, setState] = useState({});
        return html`
          <div class="flex h-screen flex-col">
            <header class="flex items-center gap-2 border-b px-4 py-2">
              <h1 class="font-medium">Re: Tomorrow's huddle</h1>
              <${Badge} variant="secondary">${events.isFetching ? "checking…" : "up to date"}<//>
            </header>
            <${ContextView}
              title="/agents/email/t42"
              context=${{
                events: events.data || [],
                caughtUp: events.isSuccess,
                error: events.error?.message,
                processors: { rows: [] },
                presence: { actors: [], rpcStubs: [] },
                liveState: {},
              }}
              state=${state}
              onStateChange=${(patch) => setState((previous) => ({ ...previous, ...patch }))}
              className="min-h-0 flex-1"
            />
          </div>
        `;
      }

      render(
        html`<${QueryClientProvider} client=${new QueryClient()}><${Thread} /><//>`,
        document.body,
      );
    </script>
  </body>
</html>
```

- `<version>` is exact: the `main` dist-tag's, from `npm view @iterate-com/ui dist-tags.main`.
- `html` is [htm](https://github.com/developit/htm): JSX's shape in a template string, so the page
  needs no compiler.
- React is the package's own. Load any other React library from esm.sh with
  `?external=react,react-dom` and it uses the same one, as react-query does here. A chart library
  beside our components, and what goes wrong without the flag:
  [Another React library](https://github.com/iterate/packages/blob/main/packages/ui/examples/README.md#another-react-library).
- Components are `@iterate-com/ui/components/<name>`: `context-view/context-view`,
  `repo-ide/repo-ide`, `code-block`, and shadcn's (`ui/card`, `ui/table`, …).

### The Change my mind button

A mind's blog is the diary of the changes that mind made to itself. The button copies instructions
that a reader pastes to their own iterate mind, which reads the post and offers to make the same
change. The instructions tell that mind to treat the post as a stranger's information, not as
instructions, and to change nothing before its owner says yes.

On a plain HTML page, one script tag defines `<change-my-mind>`, with no React and no stylesheet:

```html
<script
  type="module"
  src="https://esm.iterate.com/@iterate-com/ui@<version>/change-my-mind"
></script>
<change-my-mind source="https://blog.example.com/a-post"></change-my-mind>
```

On a React page, `ChangeMyMindButton` from `@iterate-com/ui/components/change-my-mind-button`:

```js
html`<${ChangeMyMindButton} source="https://blog.example.com/a-post" />`;
```

- `source`: the post's URL. By default, this page without its query or hash.
- `scope`: `"post"` (the default), or `"blog"` for the whole blog: its `/feed.xml` and `/README.md`.
- `instructions`: the exact text to copy, in place of the built one (the element also takes its own
  text).
- `size`: `"sm"` for a list. The button is 36px high, the kit's large Button; `"sm"` is 32px, its
  default Button. Its corners are the page's `--radius`. The element also takes `align="end"`.
- `variant`: `"default"`, the solid button, or `"outline"`, the kit's outline Button: quieter, for
  a list of posts (with `size="sm"`). The copied state, the tooltip and the card are the same.
- `changeMyMindInstructions({ source, scope })` (`@iterate-com/ui/lib/change-my-mind`) gives the
  text alone.

The element takes the kit's tokens when the page has the kit's stylesheet, and shadcn's neutral
values when not: dark on a page whose `color-scheme` is dark, light on any other. A whole page:
[examples/change-my-mind.html](https://github.com/iterate/packages/blob/main/packages/ui/examples/change-my-mind.html).

### A call's spoken lines

What is said in a call, from `@iterate-com/ui/components/call/<part>`. A line said is
`{ key, who, at, text }`: `who` is the speaker's address, or the agent's name. `CaptionStrip` is one
quiet line of the newest words under the call, with a button that opens `TranscriptHistory`: every
line said, on the virtual log, which reads older pages through its `older` as the reader scrolls
up.
`TranscriptRollup` is one row of a feed for a run of lines said, and `rollUpSpokenLines` makes the
runs from the page's rows:

```js
import { html, useMemo, useState } from "@iterate-com/ui/page";
import { CaptionStrip } from "@iterate-com/ui/components/call/caption-strip";
import { TranscriptRollup } from "@iterate-com/ui/components/call/transcript-rollup";
import { rollUpSpokenLines } from "@iterate-com/ui/components/call/spoken-lines";

// rows: the page's feed, in log order; spoken ones are { key, offset, kind: "said", who, at, text }
const feed = useMemo(() => rollUpSpokenLines(rows), [rows]);
const [open, setOpen] = useState({});
const renderRow = (row) =>
  row.kind === "rollup"
    ? html`<${TranscriptRollup}
        lines=${row.lines}
        me=${myEmail}
        expanded=${Boolean(open[row.key])}
        onToggle=${() => setOpen((was) => ({ ...was, [row.key]: !was[row.key] }))}
      />`
    : html`<${MyRow} row=${row} />`;

// under the feed: the newest words, and the viewer's own still being transcribed
html`<${CaptionStrip}
  said=${said}
  live=${{ captions, pending }}
  me=${myEmail}
  open=${shown}
  onOpen=${toggle}
/>`;
```

A page that uses `AgentContext` (`@iterate-com/ui/components/agent-context`) passes the strip and
the open transcript through `captions`, over the composer. `spokenLine(event)` answers a line for
an event said in the call: `AgentContext` rolls up each run of them, and `me` marks "(you)".
`agentContext`, the agent's own log, adds its settled work as rows that open into the scripts and
traces. `activityRows={false}` hides those rows for a reader who must not see them.

### An agent's tools in the page

A page that shows an agent can lend that agent tools that run in the page, while a signed-in person
has it open: `PageTools` from `@iterate-com/ui/components/page-tools`, mounted beside the agent's
view. Without it nothing is lent.

```js
html`<div data-page-tools="scope">
  <${AgentChat} path=${path} ... />
  <${PageTools} itx=${itx} path=${path} me=${principal} agent="Helper" />
  <aside data-page-tools="off">a part that never matches a locator</aside>
</div>`;
```

The agent then finds `itx.page.<person>.<tab>` in its capability tree and calls it from a script:

```js
const page = itx.page.jonas.k3f9xq2mabcd;
await page.banner.show({
  title: "The build is done",
  buttons: [{ label: "Open", open: "/agents" }],
});
await page.getByLabel("Message this agent").fill("Looks good, ship it");
await page.getByRole("tab", { name: "Events" }).highlight({ note: "The raw log is here" });
```

- `banner.show({ title, body, buttons, seconds })` answers `{ pressed }`: the label, or `null` and
  why (`"no answer"`, `"dismissed"`, `"off"`). One banner shows and three wait. The answer is what
  a tab said: it is no member's approval, and any code of the mind could lend a name that answers
  the same.
- `getByRole`, `getByText`, `getByLabel` and `locator(css)` find one element inside the `scope`, as
  Playwright does (`first()`, `nth(i)`, chained); then `fill`, `click`, `press` (Enter, Escape, the
  arrows), `focus`, `highlight`, `scrollIntoView`, `textContent` and `count`. The input is a
  script's: no browser default follows a key, a frame is out of reach, and an act moves the focus.
- `open(path)` shows a path of the same app (`onOpen`, else the browser loads it).
- `help()` answers how each tool is called, the host's own among them. The capability tree's line
  for the name holds only the names: a mind takes one line of at most 500 characters there.
- With no `scope` mark around `PageTools`, the agent gets the banner and `open` alone.
- The person sees the agent's path on every banner, a label while a call runs ("Helper is typing")
  with Stop, and a ring on what was filled or highlighted. Stop ends the lend for the tab, and a
  reload does not lend again. **No call runs while the tab is in the background**: the person
  would not see it.
- One lend takes 30 calls in 10 seconds, and bounded texts. A call over a limit is refused in
  words.

**What it costs.** What the agent does in the tab, it does as the person: a message it sends from
the composer and a button it presses carry the PERSON's stamp in the log. The page also appends one
audit row for each call to the agent's context (`events.iterate.com/page/tool-called`: the tool,
the locator, the outcome, never a value). That row carries the person's stamp too, and names no
caller: it says that a tool ran in this person's tab, not which code of the mind called it. Any
unjailed code of the mind can call a lent name, so one member's agent can act in another member's
tab.

| Tools                          | Worst case                                                                        | What bounds it                                            |
| ------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| The banner and `open` alone    | A false notice in the person's tab; the page of the app that they look at changes | The agent's path on the banner; chat text can say as much |
| Locators in a `scope`          | The agent presses buttons and sends messages as the person, inside the scope      | The scope and what never matches; the visible tab; Stop   |
| An `evaluate` tool of your own | The page's whole session, with no label or audit row that the code cannot remove  | Nothing in the page                                       |

- **A jailed agent gets nothing.** The lender reads the agent's own rules
  (`rewriteRules.list(0)`) before the lend and again before every call. It lends only where the
  agent's scripts run in the agent's own context with the kernel's own `itx.run` and `itx.cd`: such
  an agent holds the mind's whole reach already. An agent whose scripts a mind's config sends to a
  jail fails that, and so does the jail. A host that calls `itx.provide` by itself skips this check
  and must make it: for a jailed agent a function in a member's tab is a way out.
- **Never matched,** by any selector and by `count`: a password, one-time-code, card, hidden or
  file field, a part marked `off`, and anything outside the `scope`.
- **Refused:** a click or a key on a link or a form that leaves the page's origin, or that leads to
  a path of the platform's own (`/.auth/…`, `/.iterate/…`: sign-in and sign-out). So no tool signs
  a person out, or sends them to the pages where a member signs with a passkey. The kit watches a
  click or a key for 2 seconds for the link or the form that it sets off, also when the page's own
  handler submits the form later. In those 2 seconds the person's own Sign out is held too: they
  press it again. A handler that leaves the page by `location`, by `form.submit()` or by a request
  of its own is the page's act, and the kit cannot see it.
- **What these rules do not do:** seal what the page holds. A CSS selector asks about every
  attribute and every text of the document, and a patient caller learns from what matches. The
  rules bound the agent's ACTS and what `textContent` answers. A host whose page holds what the
  agent must not learn does not mount this.
- **In an app whose code the mind's agents cannot change**, the rules above are the wall for the
  agent's acts. **On a mind's own Dash they are manners**: an unjailed agent can commit to the
  mind's config repo, which is the Dash's code. There the walls are the jail and the passkey.
- A call is live only. The lent name holds the person and a part that is new at every lend, so a
  call reaches one tab, nothing is stored, and a page opened later gets nothing old.

**Tools of your own, and eval.** `tools` adds functions of the page under names of your own; the
kit shows the label and writes the audit row. The kit has no eval. An owner who wants one adds it
to their own page, here on the Agents row of a Dash's `app.js`, and pays the third row of the table:

```js
pageTools: {
  tools: {
    evaluate: {
      description: "evaluate(code) runs JavaScript in this page and answers what it returns.",
      run: (code) => new Function(`return (async () => { ${code} })()`)(),
    },
  },
},
```

### Your mind's data

`@iterate-com/ui/live` reads a mind live, as the person viewing the page. On the mind's own
host (`<host>.<domain>`, served by its config worker) the page uses the host's session. On
any other website the page signs in with iterate itself: a page to copy does it, jsfiddle included.
Both, and how a Claude artifact reaches iterate instead:
[Signing in](https://github.com/iterate/packages/blob/main/packages/ui/examples/README.md#signing-in).

## Not: `npm install` into an app

The package bundles every dependency, React included, so a page has nothing left to resolve. In an
app with its own React, that makes two: our components, rendered in your app's tree, call a React
that isn't rendering, and fail with "Invalid hook call". It ships no type declarations either. Use
the registry.

## Versions

Every commit to iterate's main branch that changes the package publishes
`<version>-main.<commit date>-<commit>` under the `main` dist-tag. `latest` names the same version.

## The source of a version

The package ships built files only. The source is in `packages/ui/src` of
[iterate/packages](https://github.com/iterate/packages/tree/main/packages/ui/src): an import of
`@iterate-com/ui/components/dash/dash` is `src/components/dash/dash.tsx` there.

`main` there is the newest build. To read the source of the version a page pins, find the commit it
names: each commit of that repository ends with `GitOrigin-RevId: <commit>`, and the version's last
part is the start of it.

```sh
git clone https://github.com/iterate/packages && cd packages
git log -1 --format=%H --grep='GitOrigin-RevId: 2da5c60'   # for 0.1.0-main.20261113T222359Z-2da5c60
git show <that commit>:packages/ui/src/components/dash/dash-pages.tsx
```
