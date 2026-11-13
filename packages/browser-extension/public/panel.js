// panel.js — the whole extension, after packages/spa/public/app.js: a sign-in at the mind through
// Chrome's identity window, then ONE WebSocket to the mind's API (`https://iterate.<address>/api`)
// with the bearer on the upgrade request, and this Chrome lent to the mind's root context under its
// own name, `itx.chrome.<person>.<browser>` — a live RpcTarget (open a page, raw CDP on the tabs the
// mind may drive) that the mind's agents and workers call back into while the panel is open.
// capnweb.js (the package's own browser bundle) and oauth.js (the SPA's) are copied beside this
// file by the build (README).
import { newWebSocketRpcSession, RpcTarget } from "./capnweb.js";
import { oauthClient } from "./oauth.js";

// ── Signing in: the SPA's oauth.js, through Chrome's identity window, everything kept in
// chrome.storage.local until sign-out.

/** chrome.storage.local as oauth.js's store. */
const chromeStore = {
  get: async (key) => (await chrome.storage.local.get(key))[key],
  set: (key, value) => chrome.storage.local.set({ [key]: value }),
  remove: (key) => chrome.storage.local.remove(key),
};

const oauth = oauthClient({
  sessions: chromeStore,
  // `https://<extension id>.chromiumapp.org/`: the published zip's manifest `key` keeps the id, and so
  // this URL, the same on every install (scripts/build.ts replaces manifest.json's placeholder).
  redirectUri: chrome.identity.getRedirectURL(),
  // the issuer's own login and consent pages, which share the profile's cookies
  launch: async (url) => {
    const callback = await chrome.identity.launchWebAuthFlow({ interactive: true, url });
    if (!callback) throw new Error("The sign-in window closed before the issuer sent Chrome back.");
    return callback;
  },
  registration: {
    client_name: "iterate Chrome extension",
    client_uri: "https://iterate.com",
  },
});

// ── What this Chrome lends: an RpcTarget (capnweb passes it by reference, so a call on the mind's
// root context runs HERE). The mind drives the tabs it opened and the tabs the person lent it,
// over raw CDP, commands only: the wire stays a wire, and the browser's FACTS — a tab attached,
// navigated, detached — go to the root stream as ephemeral events.

/** The tabs the mind may drive — opened by it, or lent by the person — each with whether the
 *  debugger is attached and, while it is being attached, that promise (so overlapping first calls
 *  share one attach). */
const tabs = new Map();
const grant = (tabId) =>
  tabs.get(tabId) ?? tabs.set(tabId, { attached: false, attaching: null }).get(tabId);

/** Let a tab go: on its Stop button. An attach still in flight settles first, so it cannot leave
 *  the debugger on a tab nobody tracks any more. With `keep`, the tab stays drivable. */
async function release(tabId, { keep = false } = {}) {
  const known = tabs.get(tabId);
  if (!known) return;
  await known.attaching?.catch(() => undefined);
  if (known.attached) await chrome.debugger.detach({ tabId }).catch(console.error);
  if (!keep && tabs.get(tabId) === known) tabs.delete(tabId);
}
/** Let every tab go: on sign-out, and when the panel moves to another mind. */
async function releaseTabs() {
  for (const tabId of [...tabs.keys()]) await release(tabId);
  tabs.clear();
}
/** Where the browser's facts go, and the name this Chrome is lent under: both set by `connect`. */
let report = () => {};
let lendName = "";
const fact = (type, payload) =>
  report({ type, ephemeral: true, payload: { ...payload, lendName } });
/** Redraws the panel's list of tabs, when one is shown (`connect` sets it). */
let showTabs = () => {};

// A closed tab leaves the map; a tab Chrome replaces (a prerendered page swapped in) keeps its grant
// under its new id.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabs.delete(tabId)) showTabs();
});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (!tabs.delete(removedTabId)) return;
  grant(addedTabId);
  showTabs();
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabs.has(tabId) && (change.title || change.status === "complete")) showTabs();
});

/** Chrome's "No tab with given id", in words an agent can act on. The map is left to Chrome's
 *  own events: `onReplaced` moves a replaced tab's grant only while its old id is still there. */
function tabGone(tabId) {
  return new Error(
    `Tab ${tabId} is gone: it was closed, or Chrome replaced it. Call tabs() for the tabs you may drive.`,
  );
}

/** Attach the debugger to a tab the mind may drive (once; Chrome shows its bar on the tab). */
async function attach(tabId) {
  const known = tabs.get(tabId);
  if (!known)
    throw new Error(
      `Tab ${tabId} is not one you may drive: it was closed, or it was never opened by the mind or lent. Call tabs() for the tabs you may drive.`,
    );
  if (known.attached) return;
  known.attaching ??= (async () => {
    await chrome.debugger.attach({ tabId }, "1.3").catch((error) => {
      throw /No tab with given id/.test(error?.message) ? tabGone(tabId) : error;
    });
    let url;
    try {
      await chrome.debugger.sendCommand({ tabId }, "Page.enable"); // main-frame navigations, below
      const { result } = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: "location.href",
        returnByValue: true,
      });
      url = result.value;
    } catch (error) {
      // never a debugging bar on a tab whose attach failed halfway
      await chrome.debugger.detach({ tabId }).catch(() => {});
      throw error;
    }
    known.attached = true;
    fact("events.iterate.com/chrome/attached", { tabId, url });
    showTabs();
  })().finally(() => {
    known.attaching = null;
  });
  await known.attaching;
}

chrome.debugger.onEvent.addListener(({ tabId }, method, params) => {
  if (method === "Page.frameNavigated" && !params.frame.parentId)
    fact("events.iterate.com/chrome/navigated", { tabId, url: params.frame.url });
});
chrome.debugger.onDetach.addListener(({ tabId }, reason) => {
  const known = tabs.get(tabId);
  if (known) known.attached = false;
  fact("events.iterate.com/chrome/detached", { tabId, reason });
  showTabs();
});

class ChromeBrowser extends RpcTarget {
  /** The tabs the mind may drive, still open: how an agent finds a tab the person lent. The
   *  `chrome/attached` event says the same, but only while the root context stays awake. */
  async tabs() {
    // The debugger's target list, not chrome.tabs: it carries each tab's URL and title without the
    // `tabs` permission.
    const targets = await chrome.debugger.getTargets();
    return targets
      .filter((target) => target.tabId !== undefined && tabs.has(target.tabId))
      .map(({ tabId, url, title }) => ({ tabId, url, title, attached: tabs.get(tabId).attached }));
  }

  /** Open an http(s) page in a new active tab the mind may drive; answers once the page has
   *  loaded (or after ten seconds) with the tab's id and URL. A tab Chrome replaces while it loads
   *  answers with its new id; a tab closed while it loads is an error. */
  async openPage(input) {
    if (!input || typeof input.url !== "string") throw new Error("openPage() takes { url }.");
    const target = new URL(input.url);
    if (target.protocol !== "http:" && target.protocol !== "https:")
      throw new Error("openPage() only accepts http and https URLs.");
    const tab = await chrome.tabs.create({ active: true, url: target.href });
    grant(tab.id);
    showTabs();
    let tabId = tab.id;
    await new Promise((loaded, failed) => {
      const done = (settle) => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onReplaced.removeListener(onReplaced);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        clearTimeout(timer);
        settle();
      };
      const onUpdated = (id, change) => {
        if (id === tabId && change.status === "complete") done(loaded);
      };
      const onReplaced = (added, removed) => {
        if (removed === tabId) tabId = added;
      };
      const onRemoved = (id) => {
        if (id === tabId) done(() => failed(new Error(`Tab ${id} was closed before it loaded.`)));
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onReplaced.addListener(onReplaced);
      chrome.tabs.onRemoved.addListener(onRemoved);
      const timer = setTimeout(() => done(loaded), 10_000);
      // Listeners first, then the current status: a page that was already complete fires nothing.
      void chrome.tabs.get(tabId).then(
        (current) => onUpdated(tabId, { status: current.status }),
        () => onRemoved(tabId),
      );
    });
    return { tabId, url: target.href };
  }

  /** One CDP command on a tab the mind may drive (attached on first use): the command's result,
   *  e.g. `cdp(tabId, "Runtime.evaluate", { expression: "document.title", returnByValue: true })`. */
  async cdp(tabId, method, params) {
    await attach(tabId);
    return chrome.debugger.sendCommand({ tabId }, method, params).catch((error) => {
      throw /No tab with given id/.test(error?.message) ? tabGone(tabId) : error;
    });
  }

  /** Let go of a tab: the debugger bar goes; the tab stays open and stays drivable later. */
  async detach(tabId) {
    await release(tabId, { keep: true });
  }
}

// ── The panel.

/** The mind's address as it was typed last — remembered across panel openings. */
async function settings() {
  const stored = await chrome.storage.local.get(["mind"]);
  return { mind: stored.mind || "" };
}

// ── The lend's name. Every lent Chrome has its own: `itx.chrome.<person>.<browser>`, so two people,
// or one person's two Chrome profiles, never take each other's. `chrome` comes first: a lent name
// never starts with a name of the platform's (core's `lendRefusal`), and a person's segment could be
// one (`email`, `run`). A name is letters and digits, each segment starting with a letter
// (`iterate provide`'s rule).
const SEGMENT = /^[a-zA-Z][a-zA-Z0-9]*$/;

/** The person's segment: the signed-in address before its `@`, letters and digits only. */
function personSegmentOf(principal) {
  const local = (principal?.email || "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return SEGMENT.test(local) ? local : "member";
}

/** This Chrome's segment: a name the person gave it, or one made at its first connect from the
 *  platform and a random suffix (`mac3f9a`), kept in this install's storage. */
async function browserSegment() {
  const { browserName } = await chrome.storage.local.get("browserName");
  if (browserName && SEGMENT.test(browserName)) return browserName;
  const platform = (navigator.userAgentData?.platform || navigator.platform || "chrome")
    .toLowerCase()
    .replace(/^macos$|^macintel$/, "mac")
    .replace(/^win.*/, "windows")
    .replace(/[^a-z0-9]/g, "");
  const suffix = crypto.getRandomValues(new Uint16Array(1))[0].toString(16).padStart(4, "0");
  const made = `${SEGMENT.test(platform) ? platform : "chrome"}${suffix}`;
  await chrome.storage.local.set({ browserName: made });
  return made;
}

/** Where a typed mind may sign in, in the order to ask (iterate/mind-api `mindAddressCandidatesOf`):
 *  a mind at `example.com` serves its sign-in and its API at `iterate.example.com`, and a person
 *  may type either. Only discovery says which one is the mind. */
function issuerCandidatesOf(typed) {
  const text = typed.trim().toLowerCase();
  const { hostname } = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`);
  if (!hostname.includes(".")) throw new Error("Enter the mind's address, like example.com.");
  const under = hostname.startsWith("iterate.") ? hostname.slice("iterate.".length) : "";
  const addresses = under.includes(".") ? [under, hostname] : [hostname];
  return addresses.map((address) => `https://iterate.${address}`);
}

/** The first candidate that answers as an OAuth issuer. */
async function issuerOf(candidates) {
  for (const issuer of candidates) {
    const answer = await fetch(`${issuer}/.well-known/oauth-authorization-server`).catch(
      () => null,
    );
    if (answer?.ok) return issuer;
  }
  throw new Error(`No mind signs in at ${candidates.join(" or ")}.`);
}

// ── The socket. A mind's API takes its bearer on the upgrade request, a header a page cannot set
// on a WebSocket: one session rule sets it, for this extension's own socket to that one URL. Each
// connect replaces the rule with its own token and sign-out removes it; the rule is never removed
// on a handshake, so a superseded socket cannot take the rule from the connect that replaced it.
// Every write to the rule waits in one queue, and a connect's write runs only while its generation
// is current: sign-out bumps the generation before it queues the removal, so a connect still in
// flight cannot put the token back after it.
const BEARER_RULE = 1;
let bearerRuleWrites = Promise.resolve();
const writeBearerRule = (write) => (bearerRuleWrites = bearerRuleWrites.then(write, write));

/** The socket, or null when a newer connect or a sign-out came first. */
async function openApiSocket(issuer, token, mine) {
  const url = new URL("/api", issuer);
  url.protocol = "wss:";
  const addRules = [
    {
      id: BEARER_RULE,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "authorization", operation: "set", value: `Bearer ${token}` }],
      },
      condition: {
        urlFilter: `|${url.href}|`,
        // never a web page's socket to the same URL
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ["websocket"],
      },
    },
  ];
  await writeBearerRule(async () => {
    if (mine !== generation) return;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [BEARER_RULE],
      addRules,
    });
  });
  return mine === generation ? new WebSocket(url) : null;
}

/** An element the page holds, by id and kind — the templates below always render it. */
function element(id, kind) {
  const found = document.getElementById(id);
  if (found instanceof kind) return found;
  throw new Error(`The panel rendered no ${kind.name} #${id}.`);
}

const app = element("app", HTMLElement);
const escape = (text) =>
  String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function fail(into, error) {
  console.error(error);
  const alert = document.createElement("p");
  alert.setAttribute("role", "alert");
  alert.className = "error";
  alert.textContent = error instanceof Error ? error.message : String(error);
  into.append(alert);
}

// A view or a connection that is no longer current stops acting: every async step compares its
// generation to this counter before touching the page or the socket.
let generation = 0;
let live = null;
let connectedIssuer = "";

const version = () => escape(chrome.runtime.getManifest().version);
const header = (right) => `
  <header class="header">
    <div class="brand"><img src="icon-32.png" alt="" />Iterate</div>
    ${right}
  </header>`;
/** The mind's address, from its issuer `https://iterate.<address>`. */
const addressOf = (issuer) => new URL(issuer).hostname.replace(/^iterate\./, "");

async function signedOut(mind) {
  generation += 1;
  live?.[Symbol.dispose]();
  live = null;
  app.innerHTML = `
    ${header(`<span class="badge">v${version()}</span>`)}
    <section class="card">
      <div class="card-head">
        <h2>Lend this Chrome to a mind</h2>
        <p class="muted">The mind's agents can then open pages here and drive the tabs you lend,
        while this panel stays open.</p>
      </div>
      <label class="field">Mind
        <input id="mind" class="input" value="${escape(mind)}" placeholder="example.com"
          spellcheck="false" autocomplete="off" />
      </label>
      <button id="login" class="btn btn-primary btn-block">Sign in with Iterate</button>
      <div id="sign-in-error"></div>
    </section>`;
  const input = element("mind", HTMLInputElement);
  const errors = element("sign-in-error", HTMLElement);
  element("login", HTMLButtonElement).onclick = async () => {
    errors.replaceChildren();
    try {
      const candidates = issuerCandidatesOf(input.value);
      // First, while the click still counts as the person's gesture: Chrome asks them for the
      // mind's hosts. The bearer rule needs the `wss:` origin: an `https:` one does not cover the
      // socket.
      const granted = await chrome.permissions.request({
        origins: candidates.flatMap((issuer) => [
          `${issuer}/*`,
          `${issuer.replace(/^https/, "wss")}/*`,
        ]),
      });
      if (!granted) throw new Error("The panel needs access to the mind's host to connect to it.");
      await chrome.storage.local.set({ mind: input.value.trim() });
      await signedIn(await oauth.signIn(await issuerOf(candidates)));
    } catch (error) {
      fail(errors, error);
    }
  };
}

async function signedIn(session) {
  app.innerHTML = `
    ${header(`<div class="row"><span class="badge">v${version()}</span>
      <button id="logout" class="btn btn-ghost btn-sm">Sign out</button></div>`)}
    <div id="connection" class="stack"></div>`;
  element("logout", HTMLButtonElement).onclick = async () => {
    generation += 1;
    live?.[Symbol.dispose]();
    live = null;
    showTabs = () => {};
    await releaseTabs();
    await writeBearerRule(() =>
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [BEARER_RULE] }),
    ).catch(console.error);
    await oauth.signOut();
    await signedOut((await settings()).mind);
  };
  await connect(session);
}

/** A card with a status dot (`wait`, `ok` or `bad`), a title, and HTML for its corner and body. */
const statusCard = (dot, title, { corner = "", body = "" } = {}) => `
  <section class="card">
    <div class="row"><span class="dot ${dot}"></span><h2 class="grow">${title}</h2>${corner}</div>
    ${body}
  </section>`;

/** What a person pastes to one of the mind's agents: how to reach this Chrome, and what is lent. */
function agentInstructions(address, name, lent) {
  const spelled = `itx.cd("/").${name.replace(/^itx\./, "")}`;
  const call = `\`await ${spelled}`;
  return [
    `My Chrome is lent to the mind ${address} as \`${name}\` on its root context, while my Iterate side panel is open. From an agent's script, spell it \`${spelled}\`:`,
    "",
    `- ${call}.tabs()\`: the tabs you may drive, as [{ tabId, url, title, attached }]. If this call fails, my panel is closed: tell me.`,
    `- ${call}.openPage({ url })\`: opens an http(s) page in a new tab and answers { tabId, url } once it has loaded.`,
    `- ${call}.cdp(tabId, method, params)\`: one Chrome DevTools Protocol command on a tab you may drive, for example \`"Runtime.evaluate", { expression: "document.title", returnByValue: true }\`, \`"Page.navigate", { url }\`, \`"Page.captureScreenshot", {}\` or \`"Accessibility.getFullAXTree", {}\`.`,
    `- ${call}.detach(tabId)\`: removes Chrome's debugging bar; the tab stays drivable.`,
    "",
    "Run openPage and cdp in separate scripts, so a failed cdp does not lose the tabId. You can drive only the tabs you open and the tabs I lend you.",
    "",
    lent.length ? "Tabs lent right now:" : "No tabs are lent right now.",
    ...lent.map((tab) => `- ${tab.tabId}: ${tab.title || "(no title)"} (${tab.url})`),
  ].join("\n");
}

/** Copy text from a click: the clipboard API, or a selection where the panel's focus refuses it. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

/** One socket, one lend. When the mind closes the socket (the hour-old access token expired, the
 *  grant ended) the panel connects again — a fresh token is a fresh socket, and the lend goes with
 *  the socket, so it is made again too. */
async function connect(session) {
  const mine = ++generation;
  live?.[Symbol.dispose]();
  live = null;
  // Another mind must not inherit this one's tabs (a reconnect to the same mind keeps them).
  if (session.issuer !== connectedIssuer) await releaseTabs();
  connectedIssuer = session.issuer;
  const address = addressOf(session.issuer);
  const view = element("connection", HTMLElement);
  view.innerHTML = statusCard("wait", "Connecting…", {
    body: `<p class="muted">to ${escape(address)}</p>`,
  });

  let socket;
  let itx;
  try {
    socket = await openApiSocket(session.issuer, await oauth.freshAccessToken(), mine);
    if (!socket) return;
    // The session's root is the mind's root context, `/`, as the person signed in. The lend is a
    // rewrite rule of THAT context, so a caller in another context of the mind (an agent's script
    // runs in its own) spells it `itx.cd('/').chrome.<person>.<browser>`.
    itx = newWebSocketRpcSession(socket);
    live = itx;
    const browser = new ChromeBrowser();
    const [whoami, browserName] = await Promise.all([itx.whoami(), browserSegment()]);
    const personSegment = personSegmentOf(whoami.principal);
    const name = `itx.chrome.${personSegment}.${browserName}`;
    const lend = await itx.provide(name, browser, {
      description: `${personSegment}'s Chrome (${browserName}), while its Iterate side panel is open: tabs(), openPage({ url }), cdp(tabId, method, params), detach(tabId).`,
    });
    if (mine !== generation) return;
    lendName = name;
    report = (event) => itx.append(event).catch(console.error);
    // The newest lend of a name wins. When another panel takes this one's name, this panel stops
    // and says so: lending again by itself would take the name back, and two panels would trade it
    // forever. A closed socket rejects this instead, and the reconnect below handles it.
    void Promise.resolve(lend.lendEnded()).then(
      (reason) => {
        if (mine !== generation) return;
        generation += 1;
        live?.[Symbol.dispose]();
        live = null;
        view.innerHTML = statusCard("bad", "No longer lent", {
          corner: `<button id="lend-again" class="btn btn-outline btn-sm">Lend again</button>`,
          body: `<p class="muted">The mind ended the lend of <code>${escape(name)}</code>: the lent stub
            ${escape(reason)}. Another panel may hold the same name: lend again to take it back, then
            rename one of the two.</p>`,
        });
        element("lend-again", HTMLButtonElement).onclick = () => connect(session);
      },
      () => {},
    );
    const mindName = whoami.mindSlug || address;
    const person = whoami.principal?.email || whoami.principal?.actor || "a member";
    const proofUrl = `https://example.com/?iterate-chrome-proof=${encodeURIComponent(mindName)}`;
    view.innerHTML = `
      ${statusCard("ok", "Connected", {
        body: `<dl class="facts">
          <dt>Mind</dt><dd>${escape(mindName)} · ${escape(address)}</dd>
          <dt>Signed in as</dt><dd>${escape(person)}</dd>
          <dt>Lent as</dt><dd><code>${escape(name)}</code></dd>
        </dl>
        <details id="rename">
          <summary>Rename this browser</summary>
          <form id="rename-form" class="row rename">
            <input id="browser-name" class="input grow" value="${escape(browserName)}"
              spellcheck="false" autocomplete="off" aria-label="Browser name" />
            <button class="btn btn-outline">Save</button>
          </form>
          <div id="rename-error"></div>
        </details>`,
      })}
      <section class="card">
        <div class="card-head">
          <h2>Tabs the mind can drive</h2>
          <p class="muted">Tabs it opens, and tabs you lend. Chrome shows a debugging bar on each one
          in use.</p>
        </div>
        <ul id="tabs" class="tabs"></ul>
        <div class="actions">
          <button id="lend" class="btn btn-primary btn-sm">Lend this tab</button>
          <button id="prove" class="btn btn-outline btn-sm">Test: open a page</button>
        </div>
        <div id="proof-result" class="muted"></div>
      </section>
      <section class="card">
        <div class="card-head">
          <h2>Tell an agent</h2>
          <p class="muted">Paste this to any agent of ${escape(mindName)}: it says how to use this
          browser.</p>
        </div>
        <button id="copy" class="btn btn-outline btn-block">Copy instructions for an agent</button>
        <details><summary>Show the instructions</summary><pre id="instructions"></pre></details>
      </section>`;

    const list = element("tabs", HTMLUListElement);
    const instructions = element("instructions", HTMLPreElement);
    let lent = [];
    let drawing = null;
    // Chrome's tab events come in bursts: one redraw for each burst.
    showTabs = () => {
      drawing ??= setTimeout(async () => {
        drawing = null;
        if (mine !== generation) return;
        lent = await browser.tabs();
        list.innerHTML = lent.length
          ? lent
              .map(
                (tab) => `
            <li>
              <div class="grow">
                <div class="title truncate">${escape(tab.title || tab.url)}</div>
                <div class="muted mono truncate">${escape(tab.url)}</div>
              </div>
              ${tab.attached ? `<span class="badge">in use</span>` : ""}
              <button class="btn btn-ghost btn-sm" data-stop="${tab.tabId}">Stop</button>
            </li>`,
              )
              .join("")
          : `<li class="empty">No tabs yet. Lend this tab, or let an agent open one.</li>`;
        instructions.textContent = agentInstructions(address, name, lent);
      }, 100);
    };
    showTabs();

    list.onclick = async (event) => {
      const stop = event.target instanceof Element && event.target.closest("[data-stop]");
      if (!stop) return;
      await release(Number(stop.getAttribute("data-stop")));
      showTabs();
    };

    const copy = element("copy", HTMLButtonElement);
    copy.onclick = async () => {
      await copyText(agentInstructions(address, name, lent));
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy instructions for an agent"), 2_000);
    };

    element("rename-form", HTMLFormElement).onsubmit = async (event) => {
      event.preventDefault();
      const errors = element("rename-error", HTMLElement);
      errors.replaceChildren();
      const chosen = element("browser-name", HTMLInputElement).value.trim();
      if (!SEGMENT.test(chosen))
        return fail(errors, new Error("Letters and digits only, starting with a letter."));
      if (chosen === browserName) return;
      await chrome.storage.local.set({ browserName: chosen });
      await connect(session);
    };

    const result = element("proof-result", HTMLElement);
    const path = name.split(".");
    element("prove", HTMLButtonElement).onclick = async () => {
      result.textContent = "Calling the mind…";
      try {
        // The round trip: these calls leave for the mind, whose rule resolves the lend's name to
        // the stub lent above and calls back into this very panel.
        const opened = await itx.invoke([...path, ["openPage", { url: proofUrl }]]);
        const evaluated = await itx.invoke([
          ...path,
          [
            "cdp",
            opened.tabId,
            "Runtime.evaluate",
            { expression: "document.title", returnByValue: true },
          ],
        ]);
        result.textContent = `The mind opened tab ${opened.tabId} and read its title: ${JSON.stringify(evaluated.result.value)}.`;
      } catch (error) {
        result.textContent = "";
        fail(result, error);
      }
    };
    element("lend", HTMLButtonElement).onclick = async () => {
      result.textContent = "";
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) return;
      if (tabs.has(tab.id)) {
        result.textContent = "This tab is lent already.";
        return;
      }
      grant(tab.id);
      try {
        await attach(tab.id);
        result.textContent = `Lent: agents can drive it as tab ${tab.id}.`;
      } catch (error) {
        tabs.delete(tab.id);
        showTabs();
        fail(result, error);
      }
    };
  } catch (error) {
    if (mine !== generation) return;
    view.innerHTML = statusCard("bad", "Not connected", {
      corner: `<button id="retry" class="btn btn-outline btn-sm">Retry</button>`,
    });
    fail(view.firstElementChild, error);
    element("retry", HTMLButtonElement).onclick = () => connect(session);
    return;
  }
  socket.addEventListener("close", () => {
    if (mine !== generation) return;
    view.innerHTML = statusCard("wait", "Reconnecting…", {
      body: `<p class="muted">The connection closed.</p>`,
    });
    setTimeout(() => {
      if (mine === generation) void connect(session);
    }, 2_000);
  });
  // THE HEARTBEAT, iterate's own (core/lib/src/client/heartbeat.ts says why): `whoami()` every
  // 30 s, and a socket that leaves one unanswered for 15 s is replaced.
  const beat = setInterval(async () => {
    if (mine !== generation) return clearInterval(beat);
    const answered = await Promise.race([
      itx.whoami().then(
        () => true,
        () => true,
      ),
      new Promise((resolve) => setTimeout(() => resolve(false), 15_000)),
    ]);
    if (answered || mine !== generation) return;
    clearInterval(beat);
    view.innerHTML = statusCard("wait", "Reconnecting…", {
      body: `<p class="muted">The connection stopped answering.</p>`,
    });
    void connect(session);
  }, 30_000);
}

/** A mind signs in at `https://iterate.<address>`. A session from before 0.4.0 is the old
 *  platform's (os.iterate.com), whose API a mind does not speak: it goes, and the person signs in
 *  again. */
const isMindSession = (session) => session?.issuer.startsWith("https://iterate.");

try {
  const [session, { mind }] = await Promise.all([oauth.session(), settings()]);
  if (session && !isMindSession(session)) await oauth.signOut();
  if (isMindSession(session)) await signedIn(session);
  else await signedOut(mind);
} catch (error) {
  fail(app, error);
}
