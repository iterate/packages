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
// root context runs HERE). The mind drives the tabs in its tab group, over raw CDP, commands only:
// the wire stays a wire. The browser's facts go to the root stream: who joined and left the group
// (durable, per lend), and a tab attached, navigated, detached (ephemeral).

/** The mind's tab group: every Chrome tab group, in any window, whose title is exactly this. No
 *  group id is kept: membership is read live from Chrome on every call, so a Chrome restart, a
 *  group moved to another window and one group per window all just work. */
const groupTitle = () => lend?.title ?? "";
const GROUP_COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
/** A fixed color per mind, set only when the panel makes a group: the person may change it. */
function groupColorOf(title) {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) % 2_147_483_647;
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

/** The mind's groups. `tabGroups.query({ title })` matches titles as globs, so compare here. */
async function mindGroups() {
  const title = groupTitle();
  if (!title) return [];
  return (await chrome.tabGroups.query({})).filter((group) => group.title === title);
}

/** The ids of the tabs in the mind's groups. `tabs.query({ groupId })` needs no `tabs` permission
 *  (the tabs it answers carry no URL or title). */
async function memberIds() {
  const lists = await Promise.all(
    (await mindGroups()).map((group) => chrome.tabs.query({ groupId: group.id })),
  );
  return lists.flat().map((tab) => tab.id);
}

/** Whether a tab is in the mind's group right now; a closed tab is `tabGone`. */
async function isMember(tabId) {
  const title = groupTitle();
  if (!title) return false;
  const tab = await chrome.tabs.get(tabId).catch(() => {
    throw tabGone(tabId);
  });
  if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return false;
  const group = await chrome.tabGroups.get(tab.groupId).catch(() => null);
  return group?.title === title;
}

/** Chrome refuses tab and group edits while the person drags a tab: try again, 10 times at most,
 *  200 ms apart. */
async function whileNotDragging(edit) {
  for (let retries = 0; ; retries += 1) {
    try {
      return await edit();
    } catch (error) {
      if (retries === 10 || !/user may be dragging a tab/.test(error?.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

/** Put a tab in the mind's group of its window, or in a new group there. */
async function addToGroup(tabId, windowId) {
  const title = groupTitle();
  if (!title) throw new Error("This Chrome is not lent to a mind.");
  const existing = (await mindGroups()).find((group) => group.windowId === windowId);
  if (existing) {
    await whileNotDragging(() => chrome.tabs.group({ groupId: existing.id, tabIds: [tabId] }));
    return;
  }
  const groupId = await whileNotDragging(() =>
    chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } }),
  );
  await whileNotDragging(() =>
    chrome.tabGroups.update(groupId, { title, color: groupColorOf(title), collapsed: false }),
  );
}

/** The debugger's state per tab: whether it is attached and, while it is being attached, that
 *  promise (so overlapping first calls share one attach). Not a grant: the group is the grant. */
const debuggees = new Map();

/** Let the debugger go from a tab. An attach still in flight settles first, so it cannot leave the
 *  debugger on a tab the mind may no longer drive. */
async function release(tabId) {
  const state = debuggees.get(tabId);
  if (!state) return;
  await state.attaching?.catch(() => undefined);
  if (!state.attached) return;
  await chrome.debugger.detach({ tabId }).catch(console.error);
  state.attached = false;
}
/** Let the debugger go from every tab: on sign-out, and when the panel moves to another mind. The
 *  tabs stay in their group: the group is the person's. */
async function releaseTabs() {
  for (const tabId of [...debuggees.keys()]) await release(tabId);
}

/** This Chrome's lend, set by `connect`: its name, the group's title, where its events go, and the
 *  tabs it announced as added. A new lend announces every member again: the facts belong to a lend. */
let lend = null;
const fact = (type, payload) =>
  lend?.append({ type, ephemeral: true, payload: { ...payload, lendName: lend.name } });
const record = (type, payload) =>
  lend?.append({ type, payload: { ...payload, lendName: lend.name } });
/** Redraws the panel's list of tabs, and writes a line in its tab card (`connect` sets both). */
let showTabs = () => {};
let tellTabCard = () => {};

/** Brings the announced members and the debugger in step with the group: a tab that joined is
 *  `chrome/tab-added`; a tab that left (or closed) loses the debugger and is `chrome/tab-removed`. */
async function reconcile() {
  const current = lend;
  const members = new Set(await memberIds());
  const announced = current?.announced ?? new Set();
  const attached = [...debuggees].filter(([, state]) => state.attached || state.attaching);
  const left = new Set(
    [...announced, ...attached.map(([tabId]) => tabId)].filter((tabId) => !members.has(tabId)),
  );
  for (const tabId of left) {
    await release(tabId);
    if (announced.delete(tabId) && lend === current)
      record("events.iterate.com/chrome/tab-removed", { tabId });
  }
  const joined = [...members].filter((tabId) => !announced.has(tabId));
  if (joined.length && current && lend === current) {
    const targets = await chrome.debugger.getTargets();
    for (const tabId of joined) {
      announced.add(tabId);
      const url = targets.find((target) => target.tabId === tabId)?.url;
      record("events.iterate.com/chrome/tab-added", { tabId, url });
    }
  }
  showTabs();
}

// One reconcile at a time, and a request while one runs makes exactly one more. Requests wait
// 500 ms for quiet: Chrome sends short-lived `groupId = -1` updates while a group is dragged or
// moved to another window.
let reconcileTimer;
let reconciling = false;
let reconcileAgain = false;
async function reconcileNow() {
  if (reconciling) {
    reconcileAgain = true;
    return;
  }
  reconciling = true;
  try {
    await reconcile();
  } catch (error) {
    console.error(error);
  } finally {
    reconciling = false;
    if (reconcileAgain) {
      reconcileAgain = false;
      void reconcileNow();
    }
  }
}
function reconcileSoon() {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(reconcileNow, 500);
}

chrome.tabs.onUpdated.addListener((_tabId, change) => {
  // `status` too: Chrome opens a grouped tab's child inside the group and sends no groupId change.
  if ("groupId" in change || change.status) reconcileSoon();
});
chrome.tabs.onRemoved.addListener((tabId) => {
  debuggees.delete(tabId);
  reconcileSoon();
});
// A tab Chrome replaces (a prerendered page swapped in) is a new debuggee: the debugger stayed with
// the old page, so the next `cdp` attaches again.
chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
  debuggees.delete(removedTabId);
  reconcileSoon();
});
chrome.tabGroups.onCreated.addListener(reconcileSoon);
chrome.tabGroups.onUpdated.addListener(reconcileSoon);
chrome.tabGroups.onRemoved.addListener(reconcileSoon);

/** Chrome's "No tab with given id", in words an agent can act on. */
function tabGone(tabId) {
  return new Error(
    `Tab ${tabId} is gone: it was closed, or Chrome replaced it. Call tabs() for the tabs you may drive.`,
  );
}

/** Refuse a tab that is not in the mind's group right now, attached or not. */
async function requireMember(tabId) {
  if (await isMember(tabId)) return;
  const title = groupTitle();
  throw new Error(
    `Tab ${tabId} is not in the "${title}" tab group: the mind drives only the tabs in that group. Call tabs() for them.`,
  );
}

/** Attach the debugger to a tab in the mind's group (once; Chrome shows its bar on the tab). The
 *  membership check runs on every call, so every `cdp` command makes it. */
async function attach(tabId) {
  await requireMember(tabId);
  const state =
    debuggees.get(tabId) ?? debuggees.set(tabId, { attached: false, attaching: null }).get(tabId);
  if (state.attached) return;
  state.attaching ??= (async () => {
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
    state.attached = true;
    fact("events.iterate.com/chrome/attached", { tabId, url });
    showTabs();
  })().finally(() => {
    state.attaching = null;
  });
  await state.attaching;
}

/** The longest page report the panel appends. */
const BINDING_PAYLOAD_LIMIT = 8_192;
/** Page reports in the order the pages made them: the membership check is async. */
let bindingReports = Promise.resolve();

chrome.debugger.onEvent.addListener(({ tabId }, method, params) => {
  if (method === "Page.frameNavigated" && !params.frame.parentId)
    fact("events.iterate.com/chrome/navigated", { tabId, url: params.frame.url });
  if (method !== "Runtime.bindingCalled") return;
  const { name, payload } = params;
  if (payload.length > BINDING_PAYLOAD_LIMIT) {
    console.warn(`Dropped a ${payload.length}-character ${name} report from tab ${tabId}.`);
    return;
  }
  // The type is always the panel's own: the panel appends as the signed-in person, and some mind
  // code trusts only a person's own append, so a type the page chose would let it act as them.
  bindingReports = bindingReports.then(async () => {
    if (await isMember(tabId).catch(() => false))
      record("events.iterate.com/chrome/binding-called", { tabId, name, payload });
  });
});
chrome.debugger.onDetach.addListener(({ tabId }, reason) => {
  const state = debuggees.get(tabId);
  if (state) state.attached = false;
  fact("events.iterate.com/chrome/detached", { tabId, reason });
  // Cancel on Chrome's debugging bar detaches every tab, and the person meant "stop": the tabs
  // leave the group, so the mind cannot attach again. Any other reason leaves the group alone: an
  // injected iframe's stray `target_closed` must not take a tab away.
  if (reason === "canceled_by_user") void ungroupMembers();
  showTabs();
});

async function ungroupMembers() {
  try {
    const ids = await memberIds();
    if (ids.length) await whileNotDragging(() => chrome.tabs.ungroup(ids));
    tellTabCard("You clicked Cancel on Chrome's debugging bar: the tabs left the group.");
  } catch (error) {
    console.error(error);
  }
}

/** The tabs in the mind's group, still open. URLs and titles come from the debugger's target list,
 *  which carries them without the `tabs` permission. */
async function memberTabs() {
  const [ids, targets] = await Promise.all([memberIds(), chrome.debugger.getTargets()]);
  return ids.map((tabId) => {
    const target = targets.find((candidate) => candidate.tabId === tabId);
    return {
      tabId,
      url: target?.url,
      title: target?.title,
      attached: debuggees.get(tabId)?.attached ?? false,
    };
  });
}

class ChromeBrowser extends RpcTarget {
  /** The tabs in the mind's group: how an agent finds a tab the person added. */
  async tabs() {
    return memberTabs();
  }

  /** Open an http(s) page in a new active tab in the mind's group; answers once the page has
   *  loaded (or after ten seconds) with the tab's id and URL. A tab Chrome replaces while it loads
   *  answers with its new id; a tab closed while it loads is an error. */
  async openPage(input) {
    if (!input || typeof input.url !== "string") throw new Error("openPage() takes { url }.");
    const target = new URL(input.url);
    if (target.protocol !== "http:" && target.protocol !== "https:")
      throw new Error("openPage() only accepts http and https URLs.");
    // The group in the panel's own window, else any window's, else a new one in the panel's.
    const [panelWindow, groups] = await Promise.all([chrome.windows.getCurrent(), mindGroups()]);
    const group = groups.find((candidate) => candidate.windowId === panelWindow.id) ?? groups[0];
    const windowId = group?.windowId ?? panelWindow.id;
    const tab = await chrome.tabs.create({ active: true, url: target.href, windowId });
    try {
      await addToGroup(tab.id, windowId);
    } catch (error) {
      await chrome.tabs.remove(tab.id).catch(() => {});
      throw error;
    }
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

  /** One CDP command on a tab in the mind's group (attached on first use): the command's result,
   *  e.g. `cdp(tabId, "Runtime.evaluate", { expression: "document.title", returnByValue: true })`. */
  async cdp(tabId, method, params) {
    await attach(tabId);
    return chrome.debugger.sendCommand({ tabId }, method, params).catch((error) => {
      throw /No tab with given id/.test(error?.message) ? tabGone(tabId) : error;
    });
  }

  /** Let go of a tab: the debugger bar goes; the tab stays in the group and stays drivable. */
  async detach(tabId) {
    await release(tabId);
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
        <p class="muted">The mind's agents can then open pages here and drive the tabs in its tab
        group, while this panel stays open.</p>
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
    tellTabCard = () => {};
    lend = null;
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

/** What a person pastes to one of the mind's agents: how to reach this Chrome, and which tabs it
 *  may drive. */
function agentInstructions(address, name, members) {
  const spelled = `itx.cd("/").${name.replace(/^itx\./, "")}`;
  const call = `\`await ${spelled}`;
  return [
    `My Chrome is lent to the mind ${address} as \`${name}\` on its root context, while my Iterate side panel is open. You drive the tabs in the "${address}" tab group of this Chrome. From an agent's script, spell it \`${spelled}\`:`,
    "",
    `- ${call}.tabs()\`: the tabs in the group, as [{ tabId, url, title, attached }]. If this call fails, my panel is closed: tell me.`,
    `- ${call}.openPage({ url })\`: opens an http(s) page in a new tab in the group and answers { tabId, url } once it has loaded.`,
    `- ${call}.cdp(tabId, method, params)\`: one Chrome DevTools Protocol command on a tab in the group, for example \`"Runtime.evaluate", { expression: "document.title", returnByValue: true }\`, \`"Page.navigate", { url }\`, \`"Page.captureScreenshot", {}\` or \`"Accessibility.getFullAXTree", {}\`.`,
    `- ${call}.detach(tabId)\`: removes Chrome's debugging bar; the tab stays drivable.`,
    `- A page can report to the mind: \`cdp(tabId, "Runtime.enable", {})\` and \`cdp(tabId, "Runtime.addBinding", { name, executionContextName: "iterate" })\`; then \`cdp(tabId, "Page.getFrameTree", {})\` for the main frame's id, \`cdp(tabId, "Page.createIsolatedWorld", { frameId, worldName: "iterate" })\` for its \`executionContextId\`, and \`cdp(tabId, "Runtime.evaluate", { expression, contextId: executionContextId })\` with a script that calls \`window[name](string)\`. The page's own scripts cannot see that world. Each call appends \`events.iterate.com/chrome/binding-called { lendName, tabId, name, payload }\` to the mind's root stream. Not \`Page.addScriptToEvaluateOnNewDocument\`: the mind reads an argument with a \`source\` field as a worker and refuses it.`,
    "",
    "Run openPage and cdp in separate scripts, so a failed cdp does not lose the tabId. You can drive only the tabs in the group: I add a tab by dragging it into the group, and take it back by dragging it out.",
    "",
    members.length ? "Tabs in the group right now:" : "No tabs are in the group right now.",
    ...members.map((tab) => `- ${tab.tabId}: ${tab.title || "(no title)"} (${tab.url})`),
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
  if (session.issuer !== connectedIssuer) {
    lend = null;
    await releaseTabs();
  }
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
    const provided = await itx.provide(name, browser, {
      description: `${personSegment}'s Chrome (${browserName}), while its Iterate side panel is open: tabs(), openPage({ url }), cdp(tabId, method, params), detach(tabId).`,
    });
    if (mine !== generation) return;
    lend = {
      name,
      title: address,
      append: (event) => itx.append(event).catch(console.error),
      announced: new Set(),
    };
    void reconcileNow();
    // The newest lend of a name wins. When another panel takes this one's name, this panel stops
    // and says so: lending again by itself would take the name back, and two panels would trade it
    // forever. A closed socket rejects this instead, and the reconnect below handles it.
    void Promise.resolve(provided.lendEnded()).then(
      (reason) => {
        if (mine !== generation) return;
        generation += 1;
        live?.[Symbol.dispose]();
        live = null;
        // no lend, no drivable tab: the debugging bars go too
        lend = null;
        void releaseTabs();
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
          <h2>Tab group <code class="badge mono">${escape(address)}</code></h2>
          <p class="muted">The mind drives the tabs in this group. Drag a tab into it, or click Add
          this tab; drag it out, or click Remove, to take it back. Chrome shows a debugging bar on
          each tab in use.</p>
        </div>
        <ul id="tabs" class="tabs"></ul>
        <div class="actions">
          <button id="add" class="btn btn-primary btn-sm">Add this tab</button>
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
    const result = element("proof-result", HTMLElement);
    let members = [];
    let drawing = null;
    // Chrome's tab events come in bursts: one redraw for each burst.
    showTabs = () => {
      drawing ??= setTimeout(async () => {
        drawing = null;
        if (mine !== generation) return;
        members = await memberTabs();
        if (mine !== generation) return;
        list.innerHTML = members.length
          ? members
              .map(
                (tab) => `
            <li>
              <div class="grow">
                <div class="title truncate">${escape(tab.title || tab.url)}</div>
                <div class="muted mono truncate">${escape(tab.url)}</div>
              </div>
              ${tab.attached ? `<span class="badge">in use</span>` : ""}
              <button class="btn btn-ghost btn-sm" data-remove="${tab.tabId}">Remove</button>
            </li>`,
              )
              .join("")
          : `<li class="empty">No tabs in the group yet. Add this tab, or let an agent open one.</li>`;
        instructions.textContent = agentInstructions(address, name, members);
      }, 100);
    };
    tellTabCard = (text) => {
      if (mine === generation) result.textContent = text;
    };
    showTabs();

    // Out of the group is out of the mind's reach: the reconcile detaches it and says so.
    list.onclick = async (event) => {
      const remove = event.target instanceof Element && event.target.closest("[data-remove]");
      if (!remove) return;
      result.textContent = "";
      try {
        const tabId = Number(remove.getAttribute("data-remove"));
        await whileNotDragging(() => chrome.tabs.ungroup(tabId));
        await reconcileNow();
      } catch (error) {
        fail(result, error);
      }
    };

    const copy = element("copy", HTMLButtonElement);
    copy.onclick = async () => {
      await copyText(agentInstructions(address, name, members));
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
    element("add", HTMLButtonElement).onclick = async () => {
      result.textContent = "";
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id) return;
        if (await isMember(tab.id)) {
          result.textContent = "This tab is in the group already.";
          return;
        }
        await addToGroup(tab.id, tab.windowId);
        result.textContent = `Added: agents can drive it as tab ${tab.id}.`;
      } catch (error) {
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
