# Iterate browser extension

A Chrome side panel that lends this Chrome to an iterate mind, at the mind's own address
(`iterate.<address>`) — the [static SPA archetype](../spa/README.md)
as an extension: the files in `public/` run as written, and
`pnpm --filter @iterate-com/browser-extension build` writes `dist/`, the unpacked extension:
`public/` plus capnweb's browser bundle as `capnweb.js` and the SPA's `oauth.js`. The SPA's build
runs it and zips `dist/` for its downloads page.

- `public/manifest.json` — MV3; `debugger`, `declarativeNetRequestWithHostAccess`, `identity`,
  `sidePanel`, `storage`, `tabGroups`. Not `tabs`: URLs and titles come from the debugger's target
  list. No host permission at install: at sign-in the panel asks for the mind's
  host (`https://iterate.<address>/*` and its `wss:` twin), from `optional_host_permissions`.
- `public/background.js` — the service worker: makes the toolbar button open the panel, from
  install on.
- `public/icon-{16,32,48,128}.png` — the iterate logo, as
  PNGs (Chrome takes no SVG icons). Flat in `public/`: the SPA's zip packs only top-level files.
- `public/index.html` — the panel page (its styles inline).
- `public/indicator.js` — the frame and label the person sees on a tab the mind is attached to
  (below, **What the person sees**). `panel.js` reads it and runs it in the page through CDP.
- `public/panel.js` — everything else: the sign-in at the mind through Chrome's identity window (a
  public client registered at each sign-in, so the consent page shows every time; the session in
  `chrome.storage.local`), one WebSocket to the mind's API, `wss://iterate.<address>/api`, and the
  lend: `itx.provide("itx.chrome.<person>.<browser>", new ChromeBrowser())` on the mind's root
  context (below, **The name**) — an
  `RpcTarget` with `tabs()` (the tabs in the mind's tab group: id, URL, title),
  `openPage({ url })` (a new tab in the group, answered once loaded), `cdp(tabId, method, params)` (one raw Chrome DevTools Protocol command; of CDP's events only
  `Runtime.bindingCalled` comes back, as a page report, below; `Runtime.evaluate`, `Page.captureScreenshot`, `Accessibility.getFullAXTree`, `Page.navigate`,
  `Input.dispatchMouseEvent` cover most of what an agent wants) and `detach(tabId)`.
- `dist/oauth.js` — the SPA's OAuth client, `packages/spa/public/oauth.js`, copied by the build: one
  client for both.
- `dist/capnweb.js` — capnweb's browser bundle, copied from `node_modules` by the build: the
  catalog's version, the one a mind speaks. Chrome loads no remote code from an
  extension, so this is the one thing the SPA's CDN import map cannot give us.

**Which tabs.** The mind drives the tabs in its tab group: every Chrome tab group whose title is
exactly the mind's address (`iterate.com`), in any window. Membership is the permission. The panel
reads it live from Chrome on every call, and stores no group id. So a Chrome restart, a group moved
to another window and one group per window all work. A renamed group loses its tabs; a group named
back gets them back.

A tab joins when the person drags it into the group or clicks **Add this tab** in the panel, and
when the mind opens it with `openPage`. A page that a grouped tab opens joins too, by Chrome's
opener rule. A tab leaves when the person drags it out, clicks **Remove** in the panel's list, or
closes it. `cdp` on a tab outside the group is refused, also while the debugger is still attached.
The panel makes a group with a fixed color per mind, and never changes a group after that.

The debugger attaches on the first `cdp` (Chrome shows its "is debugging this browser" bar on the
tab). It lets go on `detach`, when the tab leaves the group, and on sign-out. **Cancel** on
Chrome's debugging bar detaches every tab: the panel then takes every tab out of the group, so the
mind cannot attach again. Sign-out, or a switch to another mind, keeps the group: with no lend, or
a lend to a mind with another address, no tab is drivable.

**What the person sees.** While the mind's debugger is attached to a tab, besides Chrome's
debugging bar:

- A frame on the edge of the tab's page, in one iterate color, and a small label at the top
  center: the mind's address and what it does ("iterate.com is using this tab", "iterate.com is
  clicking"), with a **Stop** button. The frame glows stronger and pulses for 3 s after each
  command (no pulse with reduced motion). The words come from the command's method: clicking,
  typing, opening a page, looking (a screenshot), reading the page (`Runtime.*`, `DOM.*`,
  `Accessibility.*`, `CSS.*`), working.
- `indicator.js` runs in an isolated world, `iterate-indicator`, of the top frame only, on the page
  that shows at attach and on every page the tab loads after; its elements sit in a closed shadow
  root, so the page's scripts and CSS cannot reach inside. It goes before the panel detaches; after
  a detach Chrome does by itself (Cancel on the bar, a closed or crashed panel), the page cannot tell
  (a binding outlives its session): the panel writes a heartbeat every 4 s, and the indicator
  removes itself after 12 s without one.
- **Stop** calls a CDP binding that only that world has: the tab leaves the group and the
  debugger lets go, as if the person had dragged it out. It never reaches the stream as a page
  report.
- The toolbar button shows "on" on that tab, in a stronger color while the mind acts. The panel's
  tab list shows the word while the mind acts, "in use" otherwise.
- A mind's `Page.captureScreenshot` leaves the frame and label out: the panel hides them, waits
  two frames, takes the screenshot and shows them again.
- A closed panel leaves its debugger sessions attached (a session is the extension's, not the
  page's), so Chrome's bar stays. The next panel takes such a session on at its first `cdp` on
  that tab: Chrome refuses the attach ("Another debugger is already attached"), and a command that
  still goes through shows the session is this extension's.
- The panel keeps the Page and Runtime domains on (the indicator, navigation facts and page
  reports need them): `cdp` answers `Page.disable` and `Runtime.disable` with `{}` and does not
  send them.

**What reaches the stream.** The CDP wire stays a wire, but the browser's facts go to the mind's
root stream, each with the `lendName`:

- `events.iterate.com/chrome/tab-added { tabId, url }` and `chrome/tab-removed { tabId }` are
  durable: a tab joined or left the group. Each lend announces every member again.
- `chrome/binding-called { tabId, name, payload }` is durable: a page report. The mind adds a CDP
  binding (`Runtime.addBinding`, best in an isolated world from `Page.createIsolatedWorld`), and
  each call of it from a tab in the group appends its string. To keep the script on every page
  the tab loads, the mind also sends `Page.addScriptToEvaluateOnNewDocument` with
  `{ source, worldName }` (a mind whose stack is older than this refuses the `source` argument:
  then the script lives in the current page only). A payload over 8,192 characters is dropped.
  The event type is always the panel's own: the panel appends as the person.
- `chrome/attached { tabId, url }`, `chrome/navigated { tabId, url }` (main-frame navigations of
  attached tabs) and `chrome/detached { tabId, reason }` are ephemeral: live subscribers see them,
  and `readEvents` with `includeEphemeral` reads the recent ones.

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
button copies that spelling, the four methods, how a page reports to the mind and the tabs in
the group right now, for a person to paste to an agent.

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
