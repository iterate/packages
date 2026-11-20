# Iterate browser extension

A Chrome extension that lends this Chrome to an iterate mind, at the mind's own address
(`iterate.<address>`) — the [static SPA archetype](../spa/README.md)
as an extension: the files in `public/` run as written, and
`pnpm --filter @iterate-com/browser-extension build` writes `dist/`, the unpacked extension:
`public/` plus capnweb's browser bundle as `capnweb.js` and the SPA's `oauth.js`. The SPA's build
runs it and zips `dist/` for its downloads page.

The service worker owns sharing state and browser access. An offscreen document hosts a dedicated
worker with the authenticated WebSocket and capnweb session. The panel is a view; closing it leaves
sharing on. Chrome restart or extension reload leaves sharing off.

- `public/manifest.json` — MV3; `debugger`, `declarativeNetRequestWithHostAccess`, `identity`,
  `alarms`, `offscreen`, `sidePanel`, `storage`, `tabGroups`. Not `tabs`: URLs and titles come from the debugger's target
  list. No host permission at install: at sign-in the panel asks for the mind's
  host (`https://iterate.<address>/*` and its `wss:` twin), from `optional_host_permissions`.
- `public/background.js` — the service worker owns one lending controller and its UI ports.
  `SHARE_ON_BROWSER_START = false` is the single startup-sharing policy setting.
- `public/lend.js` — sign-in, bounded recovery, live group checks, CDP and the API proxy.
  `chrome.storage.session` holds sharing intent, retry budget/deadline and owned debugger IDs
  across worker termination. Chrome clears this state on browser restart or extension reload.
- `public/offscreen-client.js` — one validated runtime port, serialized document creation/cleanup
  and an API proxy. A fresh document URL nonce rejects old or unrelated ports.
- `public/offscreen.html` and `public/offscreen.js` — the hidden document uses only Chrome's runtime
  API and hosts `public/socket-worker.js`, which owns the socket and external capnweb session.
  `public/rpc-transport.js` carries capnweb strings across the port; it does not queue browser actions
  for recovery. The `WORKERS` offscreen reason matches the dedicated worker it creates.
- `public/address.js` — the mind's address from what a person typed, by the rule of
  `iterate/mind-api`, applied once; and its issuer.
- `public/profile.js` — the mind's name and logo, read from its website's public profile
  (below, **How a mind is shown**).
- `public/instructions.js` — agent instructions prepared by the worker; the panel copies the text.
- `public/icon-{16,32,48,128}.png` — the iterate logo, as
  PNGs (Chrome takes no SVG icons). Flat in `public/`: the SPA's zip packs only top-level files.
- `public/index.html` — the panel page (its styles inline).
- `public/indicator.js` — the frame and label the person sees on a tab the mind is attached to
  (below, **What the person sees**). `lend.js` reads it and runs it in the page through CDP.
- `public/panel.js` — a control view of the worker. It cannot lend a second socket.
  It requests sign-in through Chrome's identity window and shows the worker's live lending state.
  The worker registers a public client at each sign-in and keeps its session in `chrome.storage.local`.
  The service worker controls one offscreen transport to `wss://iterate.<address>/api` and the
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

**Closing the panel.** Sharing continues with no panel open. Turn sharing off or sign out to end
the lend. Taking tabs out of the mind's group revokes those tabs. Chrome startup sharing is off;
a stopped worker within the same Chrome run uses the bounded recovery below.

**Which tabs.** The mind drives the tabs in its tab group: every Chrome tab group whose title is
exactly the mind's address (`iterate.com`), in any window. Membership is the permission. The worker
reads it live from Chrome on every call, and stores no group id. So a Chrome restart, a group moved
to another window and one group per window all work. A renamed group loses its tabs; a group named
back gets them back.

A tab joins when the person drags it into the group or clicks **Add this tab** in the panel, and
when the mind opens it with `openPage`. A page that a grouped tab opens joins too, by Chrome's
opener rule. A tab leaves when the person drags it out, clicks **Remove** in the panel's list, or
closes it. `cdp` on a tab outside the group is refused, also while the debugger is still attached.
The worker makes a group with a fixed color per mind, and never changes a group after that.

The debugger attaches on the first `cdp` (Chrome shows its "is debugging this browser" bar on the
tab). It lets go on `detach`, when the tab leaves the group, and on sign-out. **Cancel** on
Chrome's debugging bar detaches every tab: the worker then takes every tab out of the group, so the
mind cannot attach again. Sign-out, or a switch to another mind, keeps the group: with no lend, or
a lend to a mind with another address, no tab is drivable.

**What the person sees.** While the mind's debugger is attached to a tab, besides Chrome's
debugging bar:

- A frame on the edge of the tab's page, in one iterate color, and a small label at the top
  center: the mind (below, **How a mind is shown**) and what it does ("is using this tab", "is
  clicking"), with a **Stop** button. The frame glows stronger and pulses for 3 s after each
  command (no pulse with reduced motion). The words come from the command's method: clicking,
  typing, opening a page, looking (a screenshot), reading the page (`Runtime.*`, `DOM.*`,
  `Accessibility.*`, `CSS.*`), working.
- `indicator.js` runs in an isolated world, `iterate-indicator`, of the top frame only, on the page
  that shows at attach and on every page the tab loads after; its elements sit in a closed shadow
  root, so the page's scripts and CSS cannot reach inside. It goes before the worker detaches; after
  a detach Chrome does by itself (Cancel on the bar, a stopped worker), the page cannot tell
  (a binding outlives its session): the worker writes a heartbeat every 4 s, and the indicator
  removes itself after 12 s without one.
- **Stop** calls a CDP binding that only that world has: the tab leaves the group and the
  debugger lets go, as if the person had dragged it out. It never reaches the stream as a page
  report.
- The toolbar button shows "on" on that tab, in a stronger color while the mind acts. The panel's
  tab list shows the word while the mind acts, "in use" otherwise.
- A mind's `Page.captureScreenshot` leaves the frame and label out: the worker hides them, waits
  two frames, takes the screenshot and shows them again.
- Closing a panel leaves the worker and its lend active. Worker termination ends that socket;
  the next wake releases recorded debugger targets before it makes a fresh lend. The group stays.
- The worker keeps the Page and Runtime domains on (the indicator, navigation facts and page
  reports need them): `cdp` answers `Page.disable` and `Runtime.disable` with `{}` and does not
  send them.

**How a mind is shown.** Everywhere the extension names a mind (the panel's header once signed
in, the label on a tab), it shows the mind's logo on the left, then its name over its address, or
the address alone for a mind with no name. The address is always there: it is what the person
signed in to and the title of the tab group.

- The name and the logo are the mind's profile, `https://<address>/.well-known/iterate-profile`
  (`core/configs/default/profile.ts`). Its website answers it to anyone with
  `access-control-allow-origin: *`, so the worker reads it with no host permission and no
  credential: when a session shows, at sign-in and at each connect. A read with no answer keeps
  what an earlier read of the same mind got.
- The profile is the owner's own words, unsigned, and proves nothing. `profile.js` takes two
  fields from it and drops the rest. The name is one line of at most 80 characters, with no
  control character and none that reorders text, and is only ever written as text. The profile's
  default name is the hostname, which counts as no name. The logo must be an `https:` address on
  the mind's website or a host under it, and is only ever an `<img>`, asked for with no referrer.
- A mind with no logo, and a logo that does not load, show iterate's mark in the panel and the
  plain dot in the label. A page whose content policy refuses the image gets the dot too.
- No lend, group or permission depends on the profile.

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
  The event type is always the extension's own: the worker appends as the person.
- `chrome/attached { tabId, url }`, `chrome/navigated { tabId, url }` (main-frame navigations of
  attached tabs) and `chrome/detached { tabId, reason }` are ephemeral: live subscribers see them,
  and `readEvents` with `includeEphemeral` reads the recent ones.

**The socket.** The API accepts a bearer on its WebSocket upgrade. The service worker adds one
`declarativeNetRequest` session rule for this extension's own `websocket` request to that exact URL.
The next connection replaces the rule; sign-out removes it. Chrome drops session rules when it quits.
A service-worker WebSocket bypasses DNR in Chromium 155. The dedicated worker hosted by the
[offscreen document](https://developer.chrome.com/docs/extensions/reference/api/offscreen) uses
that existing header path. No core authentication route or stack change is needed.

The API has no other transport than the socket, and checks the bearer inside the session: the
socket's worker calls `authenticate()` with no token, which reads the bearer of the upgrade, and
takes the session's `mind`. A bearer that the mind refuses fails the first call with the code
`UNAUTHENTICATED`, which ends recovery and waits for the person. The socket closes with 1008 and
the reason "the sign-in for this session ended: authenticate again" at the token's end, which
renews the token, and with 1012 when the mind behind the session restarted, which reconnects.

The worker creates the offscreen document when it connects. Closing the panel does not touch it.
Document loss ends that transport; the worker's bounded recovery creates a fresh document. Losing
the worker's runtime port terminates the document's socket worker. Chrome alarms restore the
service-worker controller after suspension. Only the controller chooses whether and when to lend;
the offscreen document has no retry policy, tab access or stored credentials.

Transient overloaded/unavailable answers and deploy disconnects retry for 30 minutes from the
first failure. Exponential backoff uses jitter; after reaching its 60-second cap, waits use narrow
54–60-second jitter until that original deadline. Overload waits at least 10 seconds. A valid longer
server cooldown is respected. No attempt starts after
the recovery deadline. The panel shows **Reconnecting, try N**, then **Lend again** when the window
ends. Successful probes must demonstrate 60 seconds of continuous health before resetting the window
and count. A reply gap beyond the 20-second cadence plus its 15-second deadline restarts that
health interval. Time asleep is not credited; a restarted worker starts fresh health evidence.
The deadline and count survive worker loss; restarting the worker does not extend the window.
Turning sharing off, signing out or a displaced lend stops recovery. Authentication refusals and
interrupted token refreshes still need a person. A handshake has 20 seconds to answer; the live
connection checks a read-only `tabs()` round trip through its own lent name every 20 seconds, with
a 15-second deadline. This detects a failed internal pager even while the API socket stays alive. This sends traffic within
Chrome's 30-second worker idle window: one setup `whoami()` and lend probe, then at most three
read-only heartbeat probes per minute. Resolved offline notices also start recovery; an explicit
return or replacement still waits for the person.
Opening a panel adds no mind calls. A local Chrome alarm wakes recovery at 30-second intervals;
it makes no mind call while the existing connection is healthy. Retry deadlines and counts survive
worker termination. The OAuth client awaits a durable refresh-intent callback at its actual rotating refresh
boundary. Worker loss there waits for a person; a cached-token read remains recoverable. Repeated worker losses share the same 30-minute deadline.

During a disconnect, the worker clears the local lend and releases its debuggers. The tab groups
stay in Chrome. Recovery makes a fresh lend and reads membership again. It never repeats browser
actions or queued page reports from an old connection. Old browser/page handles are refused;
get the current lend and make fresh handles after recovery. Teardown has separate bounded waits;
a native attach or detach that has not answered must settle before that tab can attach again.
Sign-out cancels retries. A lend displaced
by another install still waits for **Lend again**. Retry and give-up records go to the service-worker console
as `browser-extension.platform-failure-retry` and `browser-extension.platform-failure-gave-up`.

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
`itx.chrome.jonas.mac3f9a.openPage(...)` there runs it in the worker while sharing is on; from another context of the mind (an agent's script runs in its own) the spelling is
`itx.cd('/').chrome.jonas.mac3f9a.openPage(...)`. The panel's **Copy instructions for an agent**
button copies that spelling, the methods, how a page reports to the mind and the tabs in
the group right now, for a person to paste to an agent.

## Playwright-shaped controls (prototype)

`page(tabId)` returns an RPC handle for one tab. Agents can pipeline locator calls:

```js
const chrome = itx.cd("/").chrome.jonas.mybrowser;
const { tabId } = await chrome.openPage({ url: "https://example.com/form" });
const page = chrome.page(tabId);
await page.getByLabel("Email", { exact: true }).fill("agent@example.com");
await page.getByRole("button", { name: "Save", exact: true }).click({ timeout: 5000 });
```

Use a browser name from the capability tree. `page` does not navigate or authorize tabs.
All of its CDP calls pass through the existing `cdp` method, including calls from retained
handles. The mind's tab group remains the grant. Raw `cdp` and `detach` remain available.

Supported methods:

- `page.getByRole(role, { name, exact, disabled, includeHidden, checked, expanded, level,
pressed, selected })`, `getByText(text, { exact })`, `getByLabel(text, { exact })`,
  and `locator(selector)`. These can also chain from a locator.
- `locator.first()`, `nth(index)` (nonnegative), `count()`, and `textContent({ timeout })`.
- `locator.click({ timeout })`, `fill(text, { timeout })`, and `press(key, { timeout })`.
  Keys: `Enter`, `Tab`, `Backspace`, `Escape`, `ArrowLeft`, `ArrowRight`.

Matchers are strings. Matching defaults to substring matching; use `exact: true` where needed.
[`ivya` 1.8.2](https://github.com/vitest-dev/ivya) supplies selector, role, label and accessible-name
semantics. [Vitest's locator API](https://vitest.dev/api/browser/locators) uses the same engine.
We bundle it at build time; there is no runtime CDN dependency or copied selector engine.
The preview provider uses synthetic user events; this prototype uses CDP for trusted mouse,
text and keyboard input. Focus and text selection happen in an isolated world in the target tab.

Actions resolve the locator again on every poll. They wait for visibility, enabled state,
a stable bounding box, and a center point that receives input. Fill also requires an editable
text input or textarea. Duplicate matches fail immediately with sample HTML. A timeout includes
the locator and the last unmet condition. Calls on one tab run in order. Queue wait counts toward
the deadline: default 5,000 ms, allowed range 1–30,000 ms. Mouse/key release has a separate bounded
cleanup allowance of 1,000 ms, including on failure. A stalled CDP command cannot hold the caller
forever, but a command already sent to Chrome cannot be cancelled.

This is a small subset, not Playwright compatibility. It supports the main frame and open shadow
roots. Frames, regular expressions over RPC, modifiers, contenteditable, numeric/date/select/file
inputs, assertions, screenshots and navigation methods are outside this facade. Use raw CDP where
needed. A locator retained across a completed navigation resolves in the new document. A navigation
that destroys a context or changes the document before input fails the action. Actions do not wait
for navigation and never replay dispatched input. DOM and navigation changes can still race the
separate CDP commands; this does not give atomic or exactly-once interaction guarantees. Raw CDP
input can also race the facade's queue.

### Development checks and release

`pnpm --filter @iterate-com/browser-extension test` builds the extension and runs real Chromium
fixture tests, including the packaged facade through `chrome.debugger` in a fresh headless
extension profile. It also runs the panel connection tests in a VM with controlled Chrome, RPC
and clock fixtures. Install the test browser with
`pnpm --filter @iterate-com/browser-extension exec playwright install chromium` first.
Tests use local HTTP/TLS fixtures only. The signed-in lifecycle test uses fixture-only session
values and a local WebSocket mind API with the unmodified extension. It covers group removal and
restoration, group rename, detach and reattach, sign-out, switching minds, continued lending after
panel closure, and alarm recovery after forced service-worker termination. VM tests cover the
persistent retry budget, heartbeat rate, interrupted refresh and startup sharing policy. No real
account, credential, browser profile or user tab is imported. It exercises the lending and group
policy; it does not automate a member's passkey login and consent.

Before release: review the subset and input races, run the controlled fixture tests, bump the
manifest version, and publish the SPA's downloads bundle through
the normal release process, and reload each unpacked install. A source change alone does not
update an installed extension.

## Install

Download the current ZIP from [the SPA's downloads page](https://chrome.iterate.com/)
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
host, then the mind's own sign-in and consent pages open in a Chrome identity window. Click
**Share this browser**. Closing the panel keeps sharing on. **Turn sharing off** or **Sign out**
ends it. The panel shows **Connected · sharing on** only after the mind accepts the current lend.

To update an existing install to 0.8.3: replace the files in the installed folder, click **Reload**
on its extension card, then close and reopen the panel. Confirm **v0.8.3** and click
**Share this browser**. After Chrome restarts, sharing is off even if sign-in was remembered.
Open the panel and turn sharing on again. Automatic sharing on browser startup is not enabled;
the policy is the one `SHARE_ON_BROWSER_START` setting in `public/background.js`.

After editing a file, build again and click **Reload** on the extension's card.
Unpacked extensions do not update automatically: the downloads page says how to update one.

To package locally: `pnpm --filter @iterate-com/spa build` writes the ZIP to `packages/spa/dist/assets/downloads/`.
