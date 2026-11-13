// panel.js — the whole extension, after packages/spa/public/app.js: a sign-in at the mind through
// Chrome's identity window, then ONE WebSocket to the mind's API (`https://iterate.<address>/api`)
// with the bearer on the upgrade request, and this Chrome lent to the mind's root context as
// `itx.chrome` — a live RpcTarget (open a page, raw CDP on the tabs the mind may drive) that the
// mind's agents and workers call back into while the panel is open. capnweb.js (the package's own
// browser bundle) and oauth.js (the SPA's) are copied beside this file by the build (README).
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

/** Let every tab go: on sign-out, and when the panel moves to another mind. An attach still in
 *  flight settles first, so it cannot leave the debugger on a tab nobody tracks any more. */
async function releaseTabs() {
  for (const [tabId, known] of tabs) {
    await known.attaching?.catch(() => undefined);
    if (known.attached) await chrome.debugger.detach({ tabId }).catch(console.error);
  }
  tabs.clear();
}
/** Where the browser's facts go: the connected root context's append, set by `connect`. */
let report = () => {};
const fact = (type, payload) => report({ type, ephemeral: true, payload });

/** Attach the debugger to a tab the mind may drive (once; Chrome shows its bar on the tab). */
async function attach(tabId) {
  const known = tabs.get(tabId);
  if (!known) throw new Error(`Tab ${tabId} is not one this mind opened or was lent.`);
  if (known.attached) return;
  known.attaching ??= (async () => {
    await chrome.debugger.attach({ tabId }, "1.3");
    known.attached = true;
    await chrome.debugger.sendCommand({ tabId }, "Page.enable"); // main-frame navigations, below
    const { result } = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    fact("events.iterate.com/chrome/attached", { tabId, url: result.value });
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
   *  loaded (or after ten seconds) with the tab's id and URL. */
  async openPage(input) {
    if (!input || typeof input.url !== "string") throw new Error("openPage() takes { url }.");
    const target = new URL(input.url);
    if (target.protocol !== "http:" && target.protocol !== "https:")
      throw new Error("openPage() only accepts http and https URLs.");
    const tab = await chrome.tabs.create({ active: true, url: target.href });
    grant(tab.id);
    await new Promise((loaded) => {
      const onUpdated = (tabId, change) => {
        if (tabId !== tab.id || change.status !== "complete") return;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        loaded();
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      // Listener first, then the current status: a page that was already complete fires nothing.
      void chrome.tabs.get(tab.id).then((current) => onUpdated(tab.id, { status: current.status }));
      setTimeout(() => onUpdated(tab.id, { status: "complete" }), 10_000);
    });
    return { tabId: tab.id, url: target.href };
  }

  /** One CDP command on a tab the mind may drive (attached on first use): the command's result,
   *  e.g. `cdp(tabId, "Runtime.evaluate", { expression: "document.title", returnByValue: true })`. */
  async cdp(tabId, method, params) {
    await attach(tabId);
    return chrome.debugger.sendCommand({ tabId }, method, params);
  }

  /** Let go of a tab: the debugger bar goes; the tab stays open and stays drivable later. */
  async detach(tabId) {
    if (tabs.get(tabId)?.attached) await chrome.debugger.detach({ tabId });
  }
}

// ── The panel.

/** The mind's address as it was typed last — remembered across panel openings. */
async function settings() {
  const stored = await chrome.storage.local.get(["mind"]);
  return { mind: stored.mind || "" };
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

async function signedOut(mind) {
  generation += 1;
  live?.[Symbol.dispose]();
  live = null;
  app.innerHTML = `
    <h1>Iterate <small class="muted">v${escape(chrome.runtime.getManifest().version)}</small></h1>
    <p class="muted">Sign in at an iterate mind: this Chrome becomes that mind's
    <code>itx.chrome</code>.</p>
    <label>Mind
      <input id="mind" value="${escape(mind)}" placeholder="example.com" spellcheck="false" />
    </label>
    <p><button id="login">Sign in with Iterate</button></p>`;
  const input = element("mind", HTMLInputElement);
  element("login", HTMLButtonElement).onclick = async () => {
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
      fail(app, error);
    }
  };
}

async function signedIn(session) {
  app.innerHTML = `
    <header>
      <h1>Iterate <small class="muted">v${escape(chrome.runtime.getManifest().version)}</small></h1>
      <button id="logout" class="secondary">Sign out</button>
    </header>
    <p class="muted">Signed in at <code>${escape(session.issuer)}</code>.</p>
    <section id="connection"></section>`;
  element("logout", HTMLButtonElement).onclick = async () => {
    generation += 1;
    live?.[Symbol.dispose]();
    live = null;
    await releaseTabs();
    await writeBearerRule(() =>
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [BEARER_RULE] }),
    ).catch(console.error);
    await oauth.signOut();
    await signedOut((await settings()).mind);
  };
  await connect(session);
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
  const view = element("connection", HTMLElement);
  view.innerHTML = `<p class="muted">Connecting…</p>`;

  let socket;
  let itx;
  try {
    socket = await openApiSocket(session.issuer, await oauth.freshAccessToken(), mine);
    if (!socket) return;
    // The session's root is the mind's root context, `/`, as the person signed in. The lend is a
    // rewrite rule of THAT context, so a caller in another context of the mind (an agent's script
    // runs in its own) spells it `itx.cd('/').chrome`.
    itx = newWebSocketRpcSession(socket);
    live = itx;
    const [whoami] = await Promise.all([
      itx.whoami(),
      itx.provide("itx.chrome", new ChromeBrowser(), {
        description:
          "A person's Chrome: tabs(), openPage({ url }), cdp(tabId, method, params), detach(tabId).",
      }),
    ]);
    if (mine !== generation) return;
    report = (event) => itx.append(event).catch(console.error);
    const mindName = whoami.mindSlug || new URL(session.issuer).hostname;
    const proofUrl = `https://example.com/?iterate-chrome-proof=${encodeURIComponent(mindName)}`;
    view.innerHTML = `
      <p>Connected as <strong>${escape(whoami.principal?.email || whoami.principal?.actor || "a member")}</strong>,
      mind <code>${escape(mindName)}</code>.</p>
      <div class="capability">
        <div class="status"><span>Chrome capability</span><span>lent as <code>itx.chrome</code></span></div>
        <p><button id="prove">Open a page through the mind</button>
          <button id="lend" class="secondary">Lend the current tab</button></p>
        <p id="proof-result" class="muted"></p>
        <p class="muted">Or post this to one of the mind's agents:</p>
        <p class="prompt">Call itx.cd('/').chrome.openPage({ url: "${escape(proofUrl)}" }), then
          itx.cd('/').chrome.cdp(tabId, "Runtime.evaluate", { expression: "document.title", returnByValue: true })
          on the tabId it returned, and report the title.</p>
      </div>`;
    const result = element("proof-result", HTMLElement);
    element("prove", HTMLButtonElement).onclick = async () => {
      result.textContent = "Calling…";
      try {
        // The round trip: these calls leave for the mind, whose rule resolves `itx.chrome` to
        // the stub lent above and calls back into this very panel.
        const opened = await itx.invoke(["itx", "chrome", ["openPage", { url: proofUrl }]]);
        const evaluated = await itx.invoke([
          "itx",
          "chrome",
          [
            "cdp",
            opened.tabId,
            "Runtime.evaluate",
            { expression: "document.title", returnByValue: true },
          ],
        ]);
        result.textContent = `The mind opened tab ${opened.tabId} and read its title: ${JSON.stringify(evaluated.result.value)}`;
      } catch (error) {
        result.textContent = "";
        fail(result, error);
      }
    };
    element("lend", HTMLButtonElement).onclick = async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) return;
      grant(tab.id);
      try {
        await attach(tab.id);
        result.textContent = `Tab ${tab.id} is lent: the mind may drive it with cdp(${tab.id}, …).`;
      } catch (error) {
        result.textContent = "";
        fail(result, error);
      }
    };
  } catch (error) {
    if (mine !== generation) return;
    view.innerHTML = `<p><button id="retry" class="secondary">Retry</button></p>`;
    fail(view, error);
    element("retry", HTMLButtonElement).onclick = () => connect(session);
    return;
  }
  socket.addEventListener("close", () => {
    if (mine !== generation) return;
    view.innerHTML = `<p class="muted">The connection closed; connecting again…</p>`;
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
    view.innerHTML = `<p class="muted">The connection stopped answering; connecting again…</p>`;
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
