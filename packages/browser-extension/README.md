# Iterate browser extension

A Chrome side panel that lends this Chrome to an iterate mind, at the mind's own address
(`iterate.<address>`) — the [static SPA archetype](../spa/README.md)
as an extension: the files in `public/` run as written, and
`pnpm --filter @iterate-com/browser-extension build` writes `dist/`, the unpacked extension:
`public/` plus capnweb's browser bundle as `capnweb.js` and the SPA's `oauth.js`. The SPA's build
runs it and zips `dist/` for its downloads page.

- `public/manifest.json` — MV3; `debugger`, `declarativeNetRequestWithHostAccess`, `identity`,
  `sidePanel`, `storage`. No host permission at install: at sign-in the panel asks for the mind's
  host (`https://iterate.<address>/*` and its `wss:` twin), from `optional_host_permissions`.
- `public/background.js` — the service worker: makes the toolbar button open the panel, from
  install on.
- `public/icon-{16,32,48,128}.png` — the iterate logo, as
  PNGs (Chrome takes no SVG icons). Flat in `public/`: the SPA's zip packs only top-level files.
- `public/index.html` — the panel page (its styles inline).
- `public/panel.js` — everything else: the sign-in at the mind through Chrome's identity window (a
  public client registered at each sign-in, so the consent page shows every time; the session in
  `chrome.storage.local`), one WebSocket to the mind's API, `wss://iterate.<address>/api`, and the
  lend: `itx.provide("itx.chrome.<person>.<browser>", new ChromeBrowser())` on the mind's root
  context (below, **The name**) — an
  `RpcTarget` with `tabs()` (the tabs it may drive: id, URL, title),
  `openPage({ url })` (a new tab, answered once loaded), `cdp(tabId, method, params)` (one raw Chrome DevTools Protocol command, commands only — no event
  channel; `Runtime.evaluate`, `Page.captureScreenshot`, `Accessibility.getFullAXTree`, `Page.navigate`,
  `Input.dispatchMouseEvent` cover most of what an agent wants) and `detach(tabId)`.
- `dist/oauth.js` — the SPA's OAuth client, `packages/spa/public/oauth.js`, copied by the build: one
  client for both.
- `dist/capnweb.js` — capnweb's browser bundle, copied from `node_modules` by the build: the
  catalog's version, the one a mind speaks. Chrome loads no remote code from an
  extension, so this is the one thing the SPA's CDN import map cannot give us.

**Which tabs.** The mind drives the tabs it opened through `openPage` and the tabs the person
lent it with the panel's **Lend this tab** button, which `tabs()` lists; `cdp` on any other tab is
refused. The panel lists the same tabs, each with a **Stop** button that takes it back. A tab
closed in Chrome leaves the list; a tab Chrome replaces keeps its place under its new id. The
debugger attaches on the first `cdp` (Chrome shows its "is debugging this browser" bar on the tab)
and lets go on `detach`, on **Stop**, or on sign-out for every tab.

**What reaches the stream.** The CDP wire stays a wire, but the browser's facts go to the mind's
root stream as ephemeral events: `events.iterate.com/chrome/attached { tabId, url, lendName }`,
`chrome/navigated { tabId, url, lendName }` (main-frame navigations of attached tabs) and
`chrome/detached { tabId, reason, lendName }` — live subscribers see them, and `readEvents` with
`includeEphemeral` reads the recent ones. Nothing about a tab is written durably.

**The socket.** A mind's API takes its bearer on the WebSocket upgrade request (`Authorization:
Bearer …`), a header a page cannot set on a WebSocket. Before each connect the panel adds one
`declarativeNetRequest` session rule that sets it, for this extension's own `websocket` request to
that one URL. The next connect replaces the rule and sign-out removes it; Chrome drops session
rules when it quits. When the socket closes (the hourly token ends, the grant ends) the panel
connects again with a fresh token.

**The name.** Every lent Chrome has its own name, `itx.chrome.<person>.<browser>`, so two people
in one mind, or one person's two Chrome profiles, never take each other's. `chrome` comes first
because a lent name never starts with a name of the platform's (core's `lendRefusal`), and a
person's segment could be one (`email`, `run`). `<person>` is the
signed-in address before its `@` (`jonas`); `<browser>` is made at the first connect from the
platform and a random suffix (`mac3f9a`), kept in the install's storage, and the panel's **Rename
this browser** changes it (letters and digits). The newest lend of a name wins: when another panel
takes this one's name, the mind ends this lend and the panel stops with **Lend again**, so two
panels never trade a name back and forth. An agent finds every lent Chrome in its capability tree,
or with `(await itx.rewriteRules.list()).filter((rule) => /^itx\.chrome\./.test(rule.match))`.
A 0.4.0 panel lent itself as plain `itx.chrome`; the longer rule wins, so it never takes a call
meant for a named Chrome.

The lend is a rewrite rule of the mind's root context, `/`: anything calling
`itx.chrome.jonas.mac3f9a.openPage(...)` there runs it in the panel for as long as the panel is
open; from another context of the mind (an agent's script runs in its own) the spelling is
`itx.cd('/').chrome.jonas.mac3f9a.openPage(...)`. The panel's **Copy instructions for an agent**
button copies that spelling, the four methods and the tabs lent right now, for a person to paste to
an agent.

## Install

Download the current ZIP from [the SPA's downloads page](https://iterate-spa.iterate.workers.dev/downloads/)
and unzip it, or build `dist/` from this folder. The SPA deployment publishes a new bundle whenever
the SPA or this folder changes on main; a capnweb bump alone does not redeploy it. Bump
`public/manifest.json`'s version when shipping an update. Its `key` is a placeholder:
`scripts/build.ts` puts iterate's key (from iterate's private config) in the SPA's zip, so existing
installs retain their extension ID and OAuth redirect URI, and leaves it out of a `dist/` you build,
so Chrome derives the ID from its folder. The panel heading shows the version.

Chrome 123 or newer (the styles use `light-dark()`). Open `chrome://extensions`, enable **Developer mode**, **Load unpacked**, select
the unzipped folder or `packages/browser-extension/dist`. Pin it from the toolbar's extensions menu and
click its button to open the panel. Enter the mind's address (`iterate.com`, or
`iterate.iterate.com`) and click **Sign in with Iterate**: Chrome asks for access to the mind's
host, then the mind's own sign-in and consent pages open in a Chrome identity window. Once
connected, click **Test: open a page**: the panel calls `openPage` and then
`cdp(tabId, "Runtime.evaluate", …)` on its own name through the mind, which calls back into the panel,
which opens the tab and reads its title.
After editing a file, build again and click **Reload** on the extension's card.
Unpacked extensions do not update automatically: the downloads page says how to update one.

To package locally: `pnpm --filter @iterate-com/spa build` writes the ZIP to `packages/spa/dist/assets/downloads/`.
