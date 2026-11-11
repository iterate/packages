# No-build pages

Each file here is a whole page that imports `@iterate-com/ui` from esm.sh, to copy and change. The
package [README](../README.md) shows the import map and a first page.

> [!WARNING]
> These pages were written against the old platform at `https://os.iterate.com` (`ISSUER` in
> `any-website.html`; `this.auth.require` and `this.getItx()` in the config-worker routes the `.ts`
> pages name). The browser specs that proved them left the repository with that platform. They are
> not yet proven against a mind stack.

- **Pin a version.** `<version>` is exact, for example the `main` dist-tag of
  `https://registry.npmjs.org/@iterate-com/ui` on the day you write the page.
- **Use path-shaped URLs only.** The browser cannot prefix-map a URL with a `?query`: it drops the
  query when it resolves a subpath against it.

## Another React library

`events-chart-page.ts` charts a context's events with recharts, above the same context in
`ContextView`. A library loads from esm.sh with `?external=react,react-dom`, which leaves its React
imports to the page's import map, so it uses the React that this package bundles:

```json
"recharts": "https://esm.iterate.com/recharts@3.10.1?external=react,react-dom"
```

- **Without the flag**, esm.sh gives the library its own React. The page is blank and the console
  says "Cannot read properties of null (reading 'useContext')" (or `'useState'`).
- **`?external=react` alone** leaves a library that imports react-dom (recharts, Floating UI) with a
  second react-dom.
- **React is 19**, and the package serves only `react`, `react/jsx-runtime`,
  `react/compiler-runtime`, `react-dom` and `react-dom/client`. A library that imports another
  module (`react-dom/server`) fails to load on a 404.
- **Only React is shared.** A library built on Base UI or CodeMirror brings its own copy. That works
  while nothing of one copy goes to the other (a CodeMirror extension for our editor would not).
- **The library's styles are its own.** Give it the stylesheet's variables (`var(--border)`,
  `var(--muted-foreground)`) and it matches our components.
- For telemetry over time, use our `components/time-chart`.

## Signing in

A page reads and changes a mind as the person who views it. How it signs them in depends on where
it is served:

| Served from                        | Signs in with                                                                                                                   | Example                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| The mind's own host, by its worker | The host's session: `createIterateClient(...).authenticate(location.href)` from `live`                                          | `mind-host-page.ts`             |
| Any other website                  | Its own OAuth client, written in the page: it registers, sends the person to iterate with PKCE, and opens `/api` with the token | `any-website.html`              |
| A Claude artifact                  | The viewer's iterate connector, through the artifact's `mcp` capability                                                         | None: it runs only on claude.ai |

An agent that builds a page for its mind serves it from the mind's host: there is no sign-in UI, and
the worker can write what it knows into the page.

- **On any website**, the sign-in is the page's own code (about a hundred lines in the example).
  Nothing in `iterate` or this package does it. `live` gives the page only the socket,
  `newWebSocketRpcSession`, from the copy of capnweb that the hooks use.
- **A page that is not framed** goes to iterate and comes back to its own address with the code. The
  pending sign-in waits in `sessionStorage`. There is no popup.
- **A framed page** (jsfiddle's result pane) cannot show iterate's sign-in, and jsfiddle's
  `Cross-Origin-Opener-Policy: same-origin` cuts it off from any window it opens. So its sign-in
  ends on `https://callback.iterate.com/`, where a button copies the result for the person to paste
  back into the page.
- **The token stays in memory**, and a reload signs in again. Hosts like jsfiddle share one origin
  between all pages, so a stored token would belong to every page. The client id is stored, per
  address.
- **A platform on localhost**: Chrome asks the person before a public page reaches it (Local Network
  Access).
- **In a Claude artifact**, load the package from
  `https://cdn.jsdelivr.net/npm/@iterate-com/ui@<version>/dist/` (the artifact's CSP allows that CDN,
  not esm.sh; the files end in `.mjs`) with `styles.css` inlined. Declare
  `{ "mcp": { "servers": [{ "server": "iterate", "tools": ["run"] }] } }`, then
  `(await window.claude.use("mcp")).callTool("iterate", "run", { project, script }, { cache: false })`
  runs `script` (`async (itx) => …`) as the viewer and answers `{ payload: { result } }`. The
  connector's argument is still `project`: it is the old platform's MCP server. Nothing is live: the
  page reads again to refresh.
