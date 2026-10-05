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
  `?external=react,react-dom` and it uses the same one, as react-query does here.
- Components are `@iterate-com/ui/components/<name>`: `context-view/context-view`,
  `repo-ide/repo-ide`, `code-block`, and shadcn's (`ui/card`, `ui/table`, …).

### Your project's data

`@iterate-com/ui/live` reads a project live, as the person viewing the page. On the project's own
host (`<slug>--<project>.iterate.app`, served by its worker) the page uses the host's session. On
any other website the page signs in with iterate itself: a page to copy does it, jsfiddle included.
Both, and how a Claude artifact reaches iterate instead:
[Signing in](https://github.com/iterate/packages/blob/main/packages/ui/AGENTS.md#signing-in).

## Not: `npm install` into an app

The package bundles every dependency, React included, so a page has nothing left to resolve. In an
app with its own React, that makes two: our components, rendered in your app's tree, call a React
that isn't rendering, and fail with "Invalid hook call". It ships no type declarations either. Use
the registry.

## Versions

Every commit to iterate's main branch that changes the package publishes
`<version>-main.<commit date>-<commit>` under the `main` dist-tag. `latest` names the same version.
