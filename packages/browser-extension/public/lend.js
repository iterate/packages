// One controller per service worker. UI ports never own the socket or a browser grant.
import { RpcTarget } from "./capnweb.js";
import { ChromePage } from "./page.js";
import { locatorSource } from "./locator-source.js";
import { oauthClient } from "./oauth.js";
import { agentInstructions } from "./instructions.js";
import { answeringIssuer, mindIssuerOf } from "./address.js";
import { openOffscreenApi, disconnectOffscreen } from "./offscreen-client.js";

// Root overload lasted about 12 minutes (measured 2026-11-16), so five retries are too short.
// Keep a 30-minute window; capped jitter stays near one attempt/minute, below healthy heartbeats.
const LENDING_TIMING = Object.freeze({
  recoveryWindowMs: 30 * 60_000,
  retryInitialMs: 2_000,
  overloadedInitialMs: 20_000,
  retryFloorMs: 1_000,
  overloadedFloorMs: 10_000,
  retryCapMs: 60_000,
  retryJitter: 0.5,
  cappedRetryJitter: 0.1,
  setupDeadlineMs: 20_000,
  heartbeatIntervalMs: 20_000,
  heartbeatDeadlineMs: 15_000,
  healthyResetMs: 60_000,
  alarmPeriodMinutes: 0.5,
});

export function createLending(shareOnBrowserStart) {
  // ── Signing in: the SPA's oauth.js, through Chrome's identity window, everything kept in
  // chrome.storage.local until sign-out.

  /** chrome.storage.local as oauth.js's store. */
  let allowSessionWrites = true;
  const chromeStore = {
    get: async (key) => (await chrome.storage.local.get(key))[key],
    set: (key, value) => {
      if (!allowSessionWrites) throw new Error("Sharing ended before the token request ended.");
      return chrome.storage.local.set({ [key]: value });
    },
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
      if (!callback)
        throw new Error("The sign-in window closed before the issuer sent Chrome back.");
      return callback;
    },
    beforeRefresh: async () => {
      const mine = tokenGeneration;
      if (mine !== generation || !state.sharing) throw new Error("This connection ended.");
      refreshInFlight = true;
      publish({ phase: "refreshing" });
      await persist();
      if (mine !== generation || !state.sharing) throw new Error("This connection ended.");
    },
    registration: {
      client_name: "iterate Chrome extension",
      client_uri: "https://iterate.com",
    },
  });

  let tokenRequest = null;
  let signInRequest = null;
  let tokenGeneration;
  let refreshInFlight = false;
  async function freshAccessToken() {
    if (!tokenRequest) {
      tokenGeneration = generation;
      tokenRequest = oauth.freshAccessToken().finally(() => {
        tokenRequest = null;
        refreshInFlight = false;
      });
    }
    const pending = tokenRequest;
    if (refreshInFlight) {
      // Joining an older in-flight refresh must keep its interruption fence durable.
      publish({ phase: "refreshing" });
      await persist();
    }
    return pending;
  }

  // ── What this Chrome lends: an RpcTarget (capnweb passes it by reference, so a call on the mind's
  // root context runs HERE). The mind drives the tabs in its tab group, over raw CDP, commands only:
  // the wire stays a wire. The browser's facts go to the root stream: who joined and left the group
  // (durable, per lend), and a tab attached, navigated, detached (ephemeral).

  /** The mind's tab group: every Chrome tab group, in any window, whose title is exactly this. No
   *  group id is kept: membership is read live from Chrome on every call, so a Chrome restart, a
   *  group moved to another window and one group per window all just work. */
  const groupTitle = () => lend?.title ?? "";
  const GROUP_COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
  /** A fixed color per mind, set only when the extension makes a group: the person may change it. */
  function groupColorOf(title) {
    let hash = 0;
    for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) % (2 ** 31 - 1);
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

  /** The debugger's state per tab: whether it is attached and, while it is being attached or
   *  released, that promise (so overlapping calls share one). Not a grant: the group is the grant.
   *  The rest is what the person sees (below): what the mind does now (`activity`, a word, null once
   *  it settles), and the indicator's world on the page that shows (`indicatorWorld`, a promise of
   *  its execution context id). */
  const debuggees = new Map();
  const owned = new Set();
  let ownedWrites = Promise.resolve();
  function saveOwned() {
    const ids = [...owned];
    ownedWrites = ownedWrites.then(() => chrome.storage.session.set({ debuggeeIds: ids }));
    return ownedWrites;
  }

  /** Track the native detach separately from its caller's deadline. Only the state that owns the
   *  tab may detach it; a retired initializer must never detach its replacement. */
  function detachDebugger(tabId, state) {
    if (debuggees.get(tabId) !== state || state.detached) return Promise.resolve();
    state.detaching ??= chrome.debugger
      .detach({ tabId })
      .catch((error) => {
        if (!/Debugger is not attached|No tab with given id/.test(error?.message)) throw error;
      })
      .then(() => {
        state.detached = true;
        state.attached = false;
        if (debuggees.get(tabId) === state) {
          forgetActivity(tabId);
          owned.delete(tabId);
          return saveOwned();
        }
      })
      .finally(() => {
        state.detaching = null;
      });
    return state.detaching;
  }

  /** Cancel attachment initialization before teardown. A page dialog can hold a CDP initializer
   *  open: wait at most one second, then detach anyway. A late initializer checks its cancellation
   *  before it can issue another command. Indicator removal and detach have separate deadlines. */
  async function release(tabId) {
    const state = debuggees.get(tabId);
    if (!state) return;
    if (state.releasing) return state.releasing;
    if (state.detached || (!state.attached && !state.attaching && !state.detaching)) return;
    state.attachCancelled = true;
    state.releasing ??= (async () => {
      await within(1_000, state.attaching).catch((error) => {
        if (/No answer in/.test(error?.message))
          console.warn({
            event: "browser-extension.platform-failure-release",
            tabId,
            message: error.message,
          });
      });
      if (state.detached || (!state.attached && !state.attaching && !state.detaching)) return;
      if (state.attached)
        await within(1_000, inIndicator(tabId, REMOVE_INDICATOR)).catch(console.warn);
      await within(1_000, detachDebugger(tabId, state)).catch(console.error);
    })().finally(() => {
      state.releasing = null;
    });
    await state.releasing;
  }
  /** Release tabs independently: a blocked tab cannot delay teardown of another. Their groups stay
   *  in Chrome; the groups belong to the person. */
  async function releaseTabs() {
    await Promise.all([...debuggees.keys()].map((tabId) => release(tabId)));
  }

  /** This Chrome's lend, set by `connect`: its name, the group's title, where its events go, and the
   *  tabs it announced as added. A new lend announces every member again: the facts belong to a lend. */
  let lend = null;
  const fact = (type, payload) =>
    lend?.append({ type, ephemeral: true, payload: { ...payload, lendName: lend.name } });
  const record = (type, payload) =>
    lend?.append({ type, payload: { ...payload, lendName: lend.name } });
  /** Redraws the extension's list of tabs, and writes a line in its tab card (`connect` sets both). */
  let showTabs = () => {};
  let tellTabCard = () => {};

  /** Brings the announced members and the debugger in step with the group: a tab that joined is
   *  `chrome/tab-added`; a tab that left (or closed) loses the debugger and is `chrome/tab-removed`. */
  async function reconcile() {
    const current = lend;
    const members = new Set(await memberIds());
    if (lend !== current) return;
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
      if (lend !== current) return;
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
    if (lend) ChromeBrowser.evictPage(lend.browser, tabId);
    debuggees.delete(tabId);
    if (owned.delete(tabId)) void saveOwned();
    reconcileSoon();
  });
  // A tab Chrome replaces (a prerendered page swapped in) is a new debuggee: the debugger stayed with
  // the old page, so the next `cdp` attaches again.
  chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
    if (lend) ChromeBrowser.evictPage(lend.browser, removedTabId);
    debuggees.delete(removedTabId);
    if (owned.delete(removedTabId)) void saveOwned();
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
  async function attach(tabId, requireConnection) {
    let state = debuggees.get(tabId);
    await state?.releasing?.catch(() => undefined);
    requireConnection();
    await state?.detaching?.catch(() => undefined);
    requireConnection();
    if (state?.attachCancelled) {
      // A native attach can still arrive after teardown. Let that request answer before releasing
      // it again; a stalled CDP initializer, in contrast, can be retired once detach has answered.
      await state.attachRequest?.catch(() => undefined);
      requireConnection();
      await release(tabId);
      requireConnection();
      await state.detaching?.catch(() => undefined);
      requireConnection();
      if (!state.detached) throw new Error(`Tab ${tabId}'s debugger teardown has not completed.`);
      if (debuggees.get(tabId) === state) debuggees.delete(tabId);
    }
    await requireMember(tabId);
    requireConnection();
    state =
      debuggees.get(tabId) ?? debuggees.set(tabId, { attached: false, attaching: null }).get(tabId);
    if (state.attached) return;
    state.attaching ??= (async () => {
      state.attachCancelled = false;
      state.detached = false;
      const requireAttachment = () => {
        requireConnection();
        if (state.attachCancelled || debuggees.get(tabId) !== state)
          throw new Error(`Tab ${tabId}'s debugger was released during attachment.`);
      };
      try {
        owned.add(tabId);
        await saveOwned();
        requireAttachment();
        state.attachRequest = chrome.debugger.attach({ tabId }, "1.3").then(() => {
          state.detached = false;
        });
        await state.attachRequest.catch(async (error) => {
          if (/No tab with given id/.test(error?.message)) throw tabGone(tabId);
          // A stopped worker can leave this extension's session attached. Chrome accepts its CDP
          // commands, but refuses commands through a debugger owned by DevTools or another extension.
          if (!/Another debugger is already attached/.test(error?.message)) throw error;
          state.detached = false;
          requireAttachment();
          await chrome.debugger
            .sendCommand({ tabId }, "Runtime.evaluate", { expression: "0" })
            .catch(() => {
              throw error;
            });
        });
        requireAttachment();
        // Page and Runtime carry navigation, the indicator and page reports.
        await chrome.debugger.sendCommand({ tabId }, "Page.enable");
        requireAttachment();
        await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
        requireAttachment();
        const { result } = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
          expression: "location.href",
          returnByValue: true,
        });
        requireAttachment();
        state.attached = true;
        fact("events.iterate.com/chrome/attached", { tabId, url: result.value });
        await showIndicator(tabId);
        requireAttachment();
        showTabs();
      } catch (error) {
        await within(1_000, detachDebugger(tabId, state)).catch(console.warn);
        throw error;
      }
    })().finally(() => {
      state.attaching = null;
    });
    await state.attaching;
  }

  // ── What the person sees while the mind's debugger is attached to a tab: indicator.js on the page
  // (a frame and a label with Stop), the toolbar button's badge on that tab, and a word in the
  // panel's list. A tab is "acting" for 3 s after each `cdp` command. None of it may fail or slow the
  // mind's command: its errors go to console.warn.

  /** The isolated world indicator.js runs in, and the binding its Stop button calls. Only contexts
   *  of that name get the binding: the page's own scripts cannot call Stop. */
  const INDICATOR_WORLD = "iterate-indicator";
  const STOP_BINDING = "iterateIndicatorStop";
  /** At most one write of the indicator's `data-activity` per tab in this time. */
  const INDICATOR_WRITE_MS = 200;
  /** The longest wait for an indicator call: a page with an open dialog answers no evaluate. */
  const INDICATOR_TIMEOUT_MS = 1_000;

  /** The words for what the mind does, from the CDP method of its latest command. */
  const ACTIVITY_WORDS = new Map([
    ["Input.dispatchMouseEvent", "clicking"],
    ["Input.dispatchTouchEvent", "clicking"],
    ["Input.dispatchKeyEvent", "typing"],
    ["Input.insertText", "typing"],
    ["Page.navigate", "opening a page"],
    ["Page.reload", "opening a page"],
    ["Page.navigateToHistoryEntry", "opening a page"],
    ["Page.captureScreenshot", "looking"],
  ]);
  const activityOf = (method) =>
    ACTIVITY_WORDS.get(method) ??
    (/^(Runtime|DOM|Accessibility|CSS)\./.test(method) ? "reading the page" : "working");

  /** indicator.js's text, read once. */
  let indicatorSource;
  async function indicatorScript() {
    indicatorSource ??= fetch(chrome.runtime.getURL("indicator.js")).then((answer) => {
      if (!answer.ok) throw new Error(`indicator.js answered ${answer.status}.`);
      return answer.text();
    });
    // a failed read is tried again next time
    return indicatorSource.catch((error) => {
      indicatorSource = undefined;
      throw error;
    });
  }
  const indicatorExpression = async () =>
    `(${await indicatorScript()})(${JSON.stringify(groupTitle())});`;

  /** The indicator's host element, as an expression for its world. */
  const HOST = `document.documentElement?.querySelector(":scope > iterate-indicator")`;
  const REMOVE_INDICATOR = `${HOST}?.remove()`;
  const SHOW_INDICATOR = `${HOST}?.removeAttribute("data-hidden")`;
  // Two frames, so a screenshot taken after it has no indicator; a tab in the background draws no
  // frames, so 100 ms at most.
  const HIDE_INDICATOR = `(async () => {
  ${HOST}?.setAttribute("data-hidden", "");
  await Promise.race([
    new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn))),
    new Promise((waited) => setTimeout(waited, 100)),
  ]);
})()`;

  /** A promise that rejects after `ms`, unless `promise` settles first. */
  function within(ms, promise) {
    let timer;
    const late = new Promise((_settled, failed) => {
      timer = setTimeout(() => failed(new Error(`No answer in ${ms} ms.`)), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  // The heartbeat indicator.js waits for (its header says why). One interval writes `data-alive` on
  // every attached tab every 4 s; the write at attach and each `data-activity` write count too.
  let heartbeats = null;

  /** On attach: the indicator on every page the tab loads from now on (Chrome runs the script while
   *  the Page domain is on in this session, and forgets it at detach), and on the page that shows. A
   *  failure leaves the tab without an indicator, never the mind without the tab. */
  async function showIndicator(tabId) {
    const state = debuggees.get(tabId);
    const current = () =>
      debuggees.get(tabId) === state && state?.attached && !state.attachCancelled;
    if (!current()) return;
    try {
      await chrome.debugger.sendCommand({ tabId }, "Runtime.addBinding", {
        name: STOP_BINDING,
        executionContextName: INDICATOR_WORLD,
      });
      const source = await indicatorExpression();
      if (!current()) return;
      await chrome.debugger.sendCommand({ tabId }, "Page.addScriptToEvaluateOnNewDocument", {
        source,
        worldName: INDICATOR_WORLD,
      });
    } catch (error) {
      console.warn(error);
      return;
    }
    if (!current()) return;
    showBadge(tabId);
    heartbeat(tabId);
    heartbeats ??= setInterval(() => {
      const attached = [...debuggees].filter(([, state]) => state.attached);
      if (!attached.length) {
        clearInterval(heartbeats);
        heartbeats = null;
      }
      for (const [attachedId] of attached) heartbeat(attachedId);
    }, 4_000);
  }

  /** One heartbeat on a tab's indicator, never two in flight. An indicator that is gone (it saw no
   *  heartbeat in time, or the page removed it) comes back at the next one, in a new world. */
  function heartbeat(tabId) {
    const state = debuggees.get(tabId);
    if (!state?.attached || state.heartbeating || state.attachCancelled) return;
    state.heartbeating = true;
    const expression = `(() => {
    const host = ${HOST};
    host?.setAttribute("data-alive", "${Date.now()}");
    return Boolean(host);
  })()`;
    inIndicator(tabId, expression, { returnByValue: true })
      .then((found) => {
        if (found?.value === false) state.indicatorWorld = null;
      })
      .catch(console.warn)
      .finally(() => {
        state.heartbeating = false;
      });
  }

  function requireIndicatorState(tabId, state) {
    if (debuggees.get(tabId) !== state || !state.attached)
      throw new Error(`Tab ${tabId}'s indicator session ended.`);
  }

  /** The indicator's world on the page that shows: an isolated world of the top frame, with the
   *  indicator in it (indicator.js adds none where the page has one). */
  async function indicatorWorldOf(tabId, state) {
    requireIndicatorState(tabId, state);
    const { frameTree } = await chrome.debugger.sendCommand({ tabId }, "Page.getFrameTree");
    requireIndicatorState(tabId, state);
    const { executionContextId } = await chrome.debugger.sendCommand(
      { tabId },
      "Page.createIsolatedWorld",
      { frameId: frameTree.frame.id, worldName: INDICATOR_WORLD },
    );
    const expression = await indicatorExpression();
    requireIndicatorState(tabId, state);
    await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression,
      contextId: executionContextId,
    });
    return executionContextId;
  }

  /** Evaluate an expression in the indicator's world of an attached tab. The world is made on first
   *  use; a main-frame navigation drops it, and so does any failure here, so the next call makes a
   *  new one. A "Cannot find context" (the page went) is tried once more, in a new world. */
  async function inIndicator(tabId, expression, options = {}) {
    const state = debuggees.get(tabId);
    if (!state?.attached) return undefined;
    for (let retried = false; ; retried = true) {
      const world = (state.indicatorWorld ??= indicatorWorldOf(tabId, state));
      try {
        return await within(
          INDICATOR_TIMEOUT_MS,
          world.then(async (contextId) => {
            requireIndicatorState(tabId, state);
            const { result, exceptionDetails } = await chrome.debugger.sendCommand(
              { tabId },
              "Runtime.evaluate",
              { expression, contextId, ...options },
            );
            if (exceptionDetails)
              throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
            return result;
          }),
        );
      } catch (error) {
        if (state.indicatorWorld === world) state.indicatorWorld = null;
        if (retried || !/Cannot find context/.test(error?.message)) throw error;
      }
    }
  }

  /** The toolbar button's badge on a tab: "on" while attached, in the stronger color while the mind
   *  acts. A closed tab refuses it, and needs none. */
  function showBadge(tabId) {
    const state = debuggees.get(tabId);
    const text = state?.attached ? "on" : "";
    chrome.action.setBadgeText({ tabId, text }).catch(() => {});
    if (text)
      chrome.action
        .setBadgeBackgroundColor({ tabId, color: state.activity ? "#6366f1" : "#71717a" })
        .catch(() => {});
  }

  /** A `cdp` command on an attached tab: the word for it, now, on the badge, in the extension's list (on
   *  a change of word) and on the page (one write per 200 ms at most); it settles after 3 s. */
  function noteActivity(tabId, method) {
    const state = debuggees.get(tabId);
    if (!state?.attached) return;
    const word = activityOf(method);
    const changed = word !== state.activity;
    state.activity = word;
    state.actedAt = Date.now();
    clearTimeout(state.settleTimer);
    state.settleTimer = setTimeout(() => {
      state.activity = null;
      showBadge(tabId);
      showTabs();
    }, 3_000);
    if (changed) {
      showBadge(tabId);
      showTabs();
    }
    // The word and its time: a repeat of the same word restarts the indicator's 3 s too.
    state.indicatorWrite ??= setTimeout(
      () => {
        state.indicatorWrite = null;
        state.indicatorWrittenAt = Date.now();
        if (!state.activity) return;
        const value = JSON.stringify(`${state.activity} ${state.actedAt}`);
        inIndicator(tabId, `${HOST}?.setAttribute("data-activity", ${value})`).catch(console.warn);
      },
      Math.max(0, (state.indicatorWrittenAt ?? 0) + INDICATOR_WRITE_MS - Date.now()),
    );
  }

  /** After a detach: no activity, no world, no badge. */
  function forgetActivity(tabId) {
    const state = debuggees.get(tabId);
    if (state) {
      clearTimeout(state.settleTimer);
      clearTimeout(state.indicatorWrite);
      state.indicatorWrite = null;
      state.activity = null;
      state.indicatorWorld = null;
    }
    showBadge(tabId);
  }

  /** Stop on a tab's indicator: the person means "the mind lets go of this tab". It leaves the
   *  group, so the mind cannot attach again. */
  async function stopFromPage(tabId) {
    try {
      const target = (await chrome.debugger.getTargets()).find((each) => each.tabId === tabId);
      await whileNotDragging(() => chrome.tabs.ungroup(tabId));
      await release(tabId);
      tellTabCard(`You clicked Stop on ${target?.title || `tab ${tabId}`}: it left the group.`);
    } catch (error) {
      console.error(error);
    }
  }

  /** The longest page report the extension appends. */
  const BINDING_PAYLOAD_LIMIT = 8_192;
  /** Page reports in the order the pages made them: the membership check is async. */
  let bindingReports = Promise.resolve();

  chrome.debugger.onEvent.addListener(({ tabId }, method, params) => {
    if (method === "Page.frameNavigated" && !params.frame.parentId) {
      fact("events.iterate.com/chrome/navigated", { tabId, url: params.frame.url });
      // The new page has its indicator from the new-document script, but not the extension's world.
      const state = debuggees.get(tabId);
      if (state) state.indicatorWorld = null;
      showBadge(tabId);
    }
    if (method !== "Runtime.bindingCalled") return;
    const { name, payload } = params;
    // The indicator's Stop is the extension's own, never a page report.
    if (name === STOP_BINDING) {
      void stopFromPage(tabId);
      return;
    }
    if (payload.length > BINDING_PAYLOAD_LIMIT) {
      console.warn(`Dropped a ${payload.length}-character ${name} report from tab ${tabId}.`);
      return;
    }
    // The type is always the extension's own: the extension appends as the signed-in person, and some mind
    // code trusts only a person's own append, so a type the page chose would let it act as them.
    const current = lend;
    bindingReports = bindingReports.then(async () => {
      if (
        current &&
        lend === current &&
        (await isMember(tabId).catch(() => false)) &&
        lend === current
      )
        record("events.iterate.com/chrome/binding-called", { tabId, name, payload });
    });
  });
  chrome.debugger.onDetach.addListener(({ tabId }, reason) => {
    const state = debuggees.get(tabId);
    if (state) {
      state.attached = false;
      state.detached = true;
      state.attachCancelled = true;
    }
    // The page keeps an indicator the extension did not remove (no CDP after a detach) until it loads
    // the next page, which gets none: no session, no new-document script.
    if (owned.delete(tabId)) void saveOwned();
    forgetActivity(tabId);
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
        activity: debuggees.get(tabId)?.activity ?? null,
      };
    });
  }

  class ChromeBrowser extends RpcTarget {
    #current;

    constructor(current) {
      super();
      this.#current = current;
    }

    #requireConnection() {
      if (!this.#current())
        throw new Error(
          "This browser connection ended. Find the current lend before sending another action.",
        );
    }

    #pages = new Map();

    static evictPage(browser, tabId) {
      browser.#pages.delete(tabId);
    }

    /** A retained handle still checks live group membership on every CDP command. */
    async page(tabId) {
      this.#requireConnection();
      if (!Number.isInteger(tabId) || tabId < 0) throw new Error("page() requires a tab id");
      await requireMember(tabId);
      this.#requireConnection();
      if (!this.#pages.has(tabId))
        this.#pages.set(
          tabId,
          new ChromePage((method, params) => this.cdp(tabId, method, params), locatorSource),
        );
      return this.#pages.get(tabId);
    }

    /** The tabs in the mind's group: how an agent finds a tab the person added. */
    async tabs() {
      this.#requireConnection();
      const members = await memberTabs();
      this.#requireConnection();
      return members;
    }

    /** Open an http(s) page in a new active tab in the mind's group; answers once the page has
     *  loaded (or after ten seconds) with the tab's id and URL. A tab Chrome replaces while it loads
     *  answers with its new id; a tab closed while it loads is an error. */
    async openPage(input) {
      this.#requireConnection();
      if (!input || typeof input.url !== "string") throw new Error("openPage() takes { url }.");
      const target = new URL(input.url);
      if (target.protocol !== "http:" && target.protocol !== "https:")
        throw new Error("openPage() only accepts http and https URLs.");
      // A service worker has no panel window. Prefer the current group's window, then any
      // existing group, then a normal browser window. Never require the panel to be open.
      const [currentWindow, groups] = await Promise.all([
        chrome.windows.getCurrent().catch(() => null),
        mindGroups(),
      ]);
      const group =
        groups.find((candidate) => candidate.windowId === currentWindow?.id) ?? groups[0];
      let windowId = group?.windowId ?? currentWindow?.id;
      if (!Number.isInteger(windowId)) {
        const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
        windowId = windows.find((window) => Number.isInteger(window.id))?.id;
      }
      this.#requireConnection();
      if (!Number.isInteger(windowId))
        throw new Error("Open a Chrome window before asking the mind to open a page.");
      const tab = await chrome.tabs.create({ active: true, url: target.href, windowId });
      try {
        this.#requireConnection();
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
     *  e.g. `cdp(tabId, "Runtime.evaluate", { expression: "document.title", returnByValue: true })`.
     *  `Page.disable` and `Runtime.disable` answer `{}` and are not sent: the extension keeps both
     *  domains on, for the indicator, the navigation facts and page reports. A screenshot leaves the
     *  indicator out. */
    async cdp(tabId, method, params) {
      this.#requireConnection();
      await attach(tabId, () => this.#requireConnection());
      this.#requireConnection();
      if (method === "Page.disable" || method === "Runtime.disable") return {};
      noteActivity(tabId, method);
      const send = async () => {
        this.#requireConnection();
        await requireMember(tabId);
        this.#requireConnection();
        return chrome.debugger.sendCommand({ tabId }, method, params).catch((error) => {
          throw /No tab with given id/.test(error?.message) ? tabGone(tabId) : error;
        });
      };
      if (method !== "Page.captureScreenshot") return send();
      // Shown again when the last of overlapping screenshots is taken. One it cannot hide is taken
      // anyway.
      const state = debuggees.get(tabId);
      state.screenshots = (state.screenshots ?? 0) + 1;
      await inIndicator(tabId, HIDE_INDICATOR, { awaitPromise: true }).catch(console.warn);
      try {
        return await send();
      } finally {
        state.screenshots -= 1;
        if (!state.screenshots) inIndicator(tabId, SHOW_INDICATOR).catch(console.warn);
      }
    }

    /** Let go of a tab: the debugger bar goes; the tab stays in the group and stays drivable. */
    async detach(tabId) {
      this.#requireConnection();
      await release(tabId);
    }
  }

  // ── The lend's name. Every lent Chrome has its own: `itx.chrome.<person>.<browser>`, so two people,
  // or one person's two Chrome profiles, never take each other's. `chrome` comes first: a lent name
  // never starts with a name of the platform's (core's `lendRefusal`), and a person's segment could be
  // one (`email`, `run`). A name is letters and digits, each segment starting with a letter
  // (`iterate provide`'s rule).
  const SEGMENT = /^[a-zA-Z][a-zA-Z0-9]*$/;
  const isLendSegment = (value) =>
    SEGMENT.test(value) && !["constructor", "prototype"].includes(value);

  /** The person's segment: the signed-in address before its `@`, letters and digits only. */
  function personSegmentOf(principal) {
    const local = (principal?.email || "")
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return isLendSegment(local) ? local : "member";
  }

  /** This Chrome's segment: a name the person gave it, or one made at its first connect from the
   *  platform and a random suffix (`mac3f9a`), kept in this install's storage. */
  async function browserSegment() {
    const { browserName } = await chrome.storage.local.get("browserName");
    if (browserName && isLendSegment(browserName)) return browserName;
    const platform = (navigator.userAgentData?.platform || navigator.platform || "chrome")
      .toLowerCase()
      .replace(/^macos$|^macintel$/, "mac")
      .replace(/^win.*/, "windows")
      .replace(/[^a-z0-9]/g, "");
    const suffix = crypto.getRandomValues(new Uint16Array(1))[0].toString(16).padStart(4, "0");
    const made = `${isLendSegment(platform) ? platform : "chrome"}${suffix}`;
    await chrome.storage.local.set({ browserName: made });
    return made;
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

  /** The API proxy, or null when a newer connect or a sign-out came first. The mind's API is a
   *  WebSocket alone, and it checks the bearer inside the session: a bearer that it refuses fails
   *  the first call on the proxy with the code UNAUTHENTICATED, which ends the lend for good
   *  (`reconnectKind` retries no coded refusal). */
  async function openApiConnection({ issuer, token, current, onFailure }) {
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
      if (!current()) return;
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [BEARER_RULE],
        addRules,
      });
    });
    return current() ? openOffscreenApi(url.href, current, onFailure) : null;
  }

  // A view or a connection that is no longer current stops acting: every async step compares its
  // generation to this counter before touching the page or the socket.
  let generation = 0;
  let live = null;
  let retryTimer;
  let beatTimer;
  let drawTimer;
  let retries = 0;
  let recoveryUntil = null;
  let cancelPending = () => {};

  function disconnect() {
    generation += 1;
    void disconnectOffscreen().catch(console.error);
    clearTimeout(retryTimer);
    clearTimeout(beatTimer);
    clearTimeout(drawTimer);
    drawTimer = null;
    cancelPending();
    cancelPending = () => {};
    lend = null;

    const previous = live;
    live = null;
    previous?.[Symbol.dispose]();
    return generation;
  }

  async function connectionAnswer(mine, ms, promise) {
    const cancelled = new Promise((_resolve, reject) => {
      cancelPending = () => reject(new Error("This connection ended."));
    });
    const deadline = Date.now() + ms;
    try {
      const answer = await within(ms, Promise.race([promise, cancelled]));
      // After sleep, queued replies can run before an already-expired timer callback.
      if (Date.now() >= deadline) throw new Error(`No answer in ${ms} ms.`);
      return answer;
    } finally {
      if (mine === generation) cancelPending = () => {};
    }
  }

  function reconnectKind(error) {
    if (error?.code === "TOKEN_EXPIRED") return "token-expired";
    if (error?.code === "UNAVAILABLE") {
      if (["overloaded", "disconnected", "deploy-reset"].includes(error.data?.kind))
        return error.data.kind;
      return "unavailable";
    }
    if (error?.code === "RPC_STUB_OFFLINE") return "disconnected";
    if (error?.code === "OVERLOADED" || error?.overloaded === true) return "overloaded";
    if (error?.code) return null;
    if (
      error?.overloaded ||
      /is overloaded|queued for too long|No answer in \d+ ms/i.test(error?.message)
    )
      return "overloaded";
    if (
      error?.retryable ||
      /WebSocket|disconnected|connection.*closed|network|Failed to fetch|reset because its code was updated/i.test(
        error?.message,
      )
    )
      return "disconnected";
    return null;
  }

  const ALARM = "iterate-lending";
  const listeners = new Set();
  let session = null;
  let state = {
    phase: "initializing",
    sharing: false,
    retries: 0,
    retryAt: null,
    error: "",
    members: [],
  };
  let writes = Promise.resolve();
  // A mind's issuer is the origin at its address, which may be any hostname (./address.js).
  const isMindSession = (value) =>
    typeof value?.issuer === "string" && value.issuer.startsWith("https://");

  function snapshot() {
    return {
      ...state,
      recoveryUntil,
      instructions:
        state.phase === "connected"
          ? agentInstructions(state.address, state.name, state.members)
          : "",
      signedIn: !!session,
      issuer: session?.issuer,
      version: chrome.runtime.getManifest().version,
    };
  }
  function publish(patch) {
    state = { ...state, ...patch, retries };
    for (const listener of listeners) listener(snapshot());
  }
  function persist() {
    const saved = {
      issuer: session?.issuer,
      sharing: state.sharing,
      phase: state.phase,
      retries,
      recoveryUntil,
      retryAt: state.retryAt,
    };
    writes = writes.then(async () => {
      await chrome.storage.session.set({ lending: saved });
      await chrome.storage.local.set({ sharingRequested: saved.sharing });
    });
    return writes;
  }
  async function watch() {
    if (state.sharing && !["failed", "displaced", "exhausted"].includes(state.phase))
      await chrome.alarms.create(ALARM, { periodInMinutes: LENDING_TIMING.alarmPeriodMinutes });
    else await chrome.alarms.clear(ALARM);
  }
  showTabs = () => {
    drawTimer ??= setTimeout(async () => {
      drawTimer = null;
      const mine = generation;
      const members = await memberTabs().catch(() => []);
      if (mine === generation) publish({ members });
    }, 100);
  };
  tellTabCard = (notice) => publish({ notice });

  async function connectionFailed(currentSession, mine, error, canReconnect) {
    if (mine !== generation) return;
    const stopped = disconnect();
    void releaseTabs();
    const kind = canReconnect && reconnectKind(error);
    if (kind) recoveryUntil ??= Date.now() + LENDING_TIMING.recoveryWindowMs;
    const expired = kind && Date.now() >= recoveryUntil;
    const suggested = error?.data?.retryAfterMs;
    const floor = Math.max(
      kind === "overloaded" ? LENDING_TIMING.overloadedFloorMs : LENDING_TIMING.retryFloorMs,
      Number.isFinite(suggested) && suggested > 0 ? suggested : 0,
    );
    if (state.sharing && kind && !expired) {
      const initial =
        kind === "overloaded" ? LENDING_TIMING.overloadedInitialMs : LENDING_TIMING.retryInitialMs;
      const backoff = Math.min(LENDING_TIMING.retryCapMs, initial * 2 ** retries);
      const ceiling = Math.max(floor, backoff);
      const jitter =
        backoff === LENDING_TIMING.retryCapMs
          ? LENDING_TIMING.cappedRetryJitter
          : LENDING_TIMING.retryJitter;
      const minimum = Math.max(floor, ceiling * (1 - jitter));
      const delay = Math.min(
        Math.round(minimum + Math.random() * (ceiling - minimum)),
        recoveryUntil - Date.now(),
      );
      retries += 1;
      publish({ phase: "waiting", retryAt: Date.now() + delay, error: error.message, members: [] });
      const renewal = kind === "token-expired";
      const log = renewal ? console.info : console.warn;
      log({
        event: renewal
          ? "browser-extension.session-renewal"
          : "browser-extension.platform-failure-retry",
        kind,
        attempt: retries,
        retryInMs: Date.now() + delay < recoveryUntil ? delay : null,
        nextCheckInMs: delay,
        recoveryUntil,
        message: error.message,
      });
      await persist();
      if (stopped !== generation) return;
      await watch();
      if (stopped !== generation) return;
      retryTimer = setTimeout(() => {
        if (stopped === generation) void connect(currentSession, true);
      }, delay);
    } else {
      publish({
        phase: expired ? "exhausted" : "failed",
        retryAt: null,
        members: [],
        error: expired
          ? `Automatic lending recovery ended after ${LENDING_TIMING.recoveryWindowMs / 60_000} minutes. Choose Lend again to start a new recovery window.`
          : error.message,
      });
      console.warn({
        event: "browser-extension.platform-failure-gave-up",
        kind,
        scheduledRetries: retries,
        recoveryUntil,
        reason: expired ? "recovery-window-ended" : "not-retryable",
        message: error.message,
      });
      await persist();
      await watch();
    }
  }

  async function connect(currentSession, automatic = false) {
    if (!state.sharing || session?.issuer !== currentSession.issuer) return;
    if (automatic && state.phase !== "waiting") return;
    if (automatic && recoveryUntil !== null && Date.now() >= recoveryUntil) {
      await connectionFailed(
        currentSession,
        generation,
        Object.assign(new Error("The connection recovery window ended."), { code: "UNAVAILABLE" }),
        true,
      );
      return;
    }
    if (!automatic) {
      retries = 0;
      recoveryUntil = null;
    }
    const mine = disconnect();
    const setupDeadline = Date.now() + LENDING_TIMING.setupDeadlineMs;
    const setupCurrent = () => mine === generation && Date.now() < setupDeadline;
    publish({ phase: "connecting", retryAt: null, error: "", members: [] });
    let itx;
    let checkLend;
    let canReconnect = false;
    try {
      const setup = await connectionAnswer(
        mine,
        LENDING_TIMING.setupDeadlineMs,
        (async () => {
          await watch();
          if (!setupCurrent()) return null;
          await persist();
          if (!setupCurrent()) return null;
          await releaseTabs();
          if (!setupCurrent()) return null;
          const token = await freshAccessToken();
          if (!setupCurrent()) return null;
          canReconnect = true;
          publish({ phase: "connecting" });
          await persist();
          if (!setupCurrent()) return null;
          itx = await openApiConnection({
            issuer: currentSession.issuer,
            token,
            current: setupCurrent,
            onFailure: (error) => connectionFailed(currentSession, mine, error, true),
          });
          if (!itx) return null;
          live = itx;
          const browser = new ChromeBrowser(() => mine === generation && state.sharing);
          const [whoami, browserName] = await Promise.all([itx.whoami(), browserSegment()]);
          if (!setupCurrent()) return null;
          const person = personSegmentOf(whoami.principal);
          const name = `itx.chrome.${person}.${browserName}`;
          checkLend = () => itx.invoke([...name.split("."), ["tabs"]]);
          const provided = await itx.provide(name, browser, {
            description: `${person}'s Chrome (${browserName}), while sharing is on (the side panel may be closed): tabs(), openPage({ url }), page(tabId) (prototype: Playwright-shaped getByRole/getByText/getByLabel/locator, click/fill/press), cdp(tabId, method, params), detach(tabId).`,
          });
          if (!setupCurrent()) return null;
          lend = {
            browser,
            name,
            title: new URL(currentSession.issuer).hostname.replace(/^iterate\./, ""),
            append: (event) => itx.append(event).catch(console.error),
            announced: new Set(),
          };
          // A pager can exist while registering its stub failed. Verify the usable lend, not
          // only the outer API socket. This call reads membership and never dispatches input.
          await checkLend();
          if (!setupCurrent()) return null;
          return { browser, whoami, browserName, name, provided };
        })(),
      );
      if (!setup || mine !== generation) return;
      const { whoami, browserName, name, provided } = setup;
      let lastHealthyAt = Date.now();
      let healthySince = lastHealthyAt;
      publish({
        phase: "connected",
        name,
        browserName,
        person: whoami.principal?.email || whoami.principal?.actor,
        mindName: whoami.mindSlug || lend.title,
        address: lend.title,
      });
      await persist();
      if (mine !== generation) return;
      await watch();
      void reconcileNow();
      void Promise.resolve(provided.lendEnded()).then(
        async (reason) => {
          if (mine !== generation) return;
          // Core reports a lost pager as a resolved offline reason. A replaced/returned lend
          // stays manual, so two profiles never take the same name back from each other.
          const offline = typeof reason === "string" && /^went offline\b/i.test(reason);
          const failure = Object.assign(new Error(String(reason)), { retryable: offline });
          if (offline || reconnectKind(failure)) {
            await connectionFailed(currentSession, mine, failure, true);
            return;
          }
          disconnect();
          void releaseTabs();
          publish({
            phase: "displaced",
            retryAt: null,
            members: [],
            error: `The mind ended this lend: ${reason}. Choose Lend again to take it back.`,
          });
          await persist();
          await watch();
        },
        (error) => void connectionFailed(currentSession, mine, error, true),
      );
      // A read-only call through the lend detects a broken internal pager and supplies the
      // WebSocket traffic Chrome needs inside its 30-second worker idle window.
      const beat = async () => {
        if (mine !== generation) return;
        try {
          await connectionAnswer(mine, LENDING_TIMING.heartbeatDeadlineMs, checkLend());
          if (mine !== generation) return;
          const answeredAt = Date.now();
          // Continuous health needs successful replies, not a timer that can elapse asleep.
          if (
            answeredAt - lastHealthyAt >
            LENDING_TIMING.heartbeatIntervalMs + LENDING_TIMING.heartbeatDeadlineMs
          )
            healthySince = answeredAt;
          lastHealthyAt = answeredAt;
          if (
            recoveryUntil !== null &&
            answeredAt - healthySince >= LENDING_TIMING.healthyResetMs
          ) {
            retries = 0;
            recoveryUntil = null;
            publish({});
            void persist();
          }
          beatTimer = setTimeout(beat, LENDING_TIMING.heartbeatIntervalMs);
        } catch (error) {
          await connectionFailed(currentSession, mine, error, true);
        }
      };
      beatTimer = setTimeout(beat, LENDING_TIMING.heartbeatIntervalMs);
    } catch (error) {
      await connectionFailed(currentSession, mine, error, canReconnect);
    }
  }

  async function stopSharing() {
    disconnect();
    retries = 0;
    recoveryUntil = null;
    publish({ sharing: false, phase: "off", members: [], retryAt: null, error: "" });
    const released = releaseTabs();
    await persist();
    await watch();
    await writeBearerRule(() =>
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [BEARER_RULE] }),
    );
    await released;
  }

  const ready = (async () => {
    await disconnectOffscreen();
    const stored = await chrome.storage.session.get(["lending", "debuggeeIds"]);
    for (const tabId of stored.debuggeeIds || []) {
      owned.add(tabId);
      debuggees.set(tabId, { attached: true, attaching: null });
    }
    await releaseTabs();
    session = await oauth.session();
    if (session && !isMindSession(session)) {
      await oauth.signOut();
      session = null;
    }
    const previous = stored.lending;
    const local = await chrome.storage.local.get(["sharingRequested", "mind"]);
    publish({ phase: "off", mind: local.mind || "" });
    if (!session) {
      await watch();
      return;
    }
    if (previous?.sharing && previous.issuer === session.issuer) {
      retries =
        Number.isSafeInteger(previous.retries) && previous.retries >= 0 ? previous.retries : 0;
      recoveryUntil = Number.isFinite(previous.recoveryUntil)
        ? Math.min(previous.recoveryUntil, Date.now() + LENDING_TIMING.recoveryWindowMs)
        : null;
      publish({ sharing: true });
      if (["failed", "displaced", "refreshing", "exhausted"].includes(previous.phase)) {
        publish({
          phase: previous.phase === "refreshing" ? "failed" : previous.phase,
          error:
            previous.phase === "exhausted"
              ? `Automatic lending recovery ended after ${LENDING_TIMING.recoveryWindowMs / 60_000} minutes. Choose Lend again.`
              : "Sharing stopped before the worker restarted. Choose Lend again, or sign in again if a token refresh was interrupted.",
        });
        await persist();
        await watch();
      } else if (previous.phase === "waiting" && Number.isFinite(previous.retryAt)) {
        recoveryUntil ??= Date.now() + LENDING_TIMING.recoveryWindowMs;
        publish({
          phase: "waiting",
          retryAt: Math.min(previous.retryAt, recoveryUntil),
          error: "Restoring the bounded connection retry.",
        });
        await persist();
        if (Date.now() >= recoveryUntil) await connect(session, true);
        else {
          await watch();
          retryTimer = setTimeout(
            () => void connect(session, true),
            Math.max(0, state.retryAt - Date.now()),
          );
        }
      } else
        await connectionFailed(
          session,
          generation,
          new Error("The worker connection closed."),
          true,
        );
    } else if (shareOnBrowserStart && local.sharingRequested) {
      publish({ sharing: true });
      await connect(session);
    } else {
      await persist();
      await watch();
    }
  })();

  async function command(message) {
    await ready;
    if (!message || typeof message.action !== "string") throw new Error("Invalid panel command.");
    switch (message.action) {
      case "state": {
        // Re-read only local state. Opening another panel never starts another socket.
        const mine = generation;
        const storedSession = await oauth.session();
        if (!state.sharing && mine === generation)
          session = isMindSession(storedSession) ? storedSession : null;
        return snapshot();
      }
      case "login": {
        if (state.sharing || tokenRequest || signInRequest)
          throw new Error("Turn sharing off and wait for the current sign-in or token request.");
        const mine = generation;
        allowSessionWrites = true;
        const issuer = mindIssuerOf(message.mind);
        signInRequest = (async () => {
          await chrome.storage.local.set({ mind: message.mind.trim() });
          if (mine !== generation) throw new Error("This sign-in ended.");
          return oauth.signIn(await answeringIssuer(issuer));
        })();
        try {
          const signedIn = await signInRequest;
          if (mine !== generation) throw new Error("This sign-in ended.");
          session = signedIn;
          publish({ mind: message.mind.trim() });
          return snapshot();
        } finally {
          signInRequest = null;
        }
      }
      case "logout": {
        allowSessionWrites = false;
        const stopped = stopSharing();
        session = null;
        publish({});
        await oauth.signOut();
        await stopped;
        return snapshot();
      }
      case "share": {
        const mine = generation;
        const storedSession = await oauth.session();
        if (mine !== generation) throw new Error("Sharing changed before this request completed.");
        session = storedSession;
        if (!isMindSession(session)) throw new Error("Sign in to a mind first.");
        if (
          state.phase === "connected" ||
          state.phase === "connecting" ||
          state.phase === "refreshing"
        )
          return snapshot();
        allowSessionWrites = true;
        publish({ sharing: true });
        await connect(session);
        return snapshot();
      }
      case "stop":
        await stopSharing();
        return snapshot();
      case "rename": {
        const mine = generation;
        const chosen = typeof message.name === "string" ? message.name.trim() : "";
        if (!isLendSegment(chosen))
          throw new Error(
            "Use letters and digits, starting with a letter. Constructor and prototype names are reserved.",
          );
        await chrome.storage.local.set({ browserName: chosen });
        if (mine === generation && state.sharing) await connect(session);
        return snapshot();
      }
      case "prove": {
        if (!lend || !live) throw new Error("This Chrome is not lent.");
        const mine = generation;
        const itx = live;
        const path = lend.name.split(".");
        const opened = await within(
          20_000,
          itx.invoke([
            ...path,
            [
              "openPage",
              {
                url: `https://example.com/?iterate-chrome-proof=${encodeURIComponent(state.mindName)}`,
              },
            ],
          ]),
        );
        if (mine !== generation)
          throw new Error("The connection ended. The test was not replayed.");
        const evaluated = await within(
          20_000,
          itx.invoke([
            ...path,
            [
              "cdp",
              opened.tabId,
              "Runtime.evaluate",
              { expression: "document.title", returnByValue: true },
            ],
          ]),
        );
        if (mine !== generation) throw new Error("The connection ended.");
        publish({
          notice: `The mind opened tab ${opened.tabId} and read its title: ${JSON.stringify(evaluated.result.value)}.`,
        });
        return snapshot();
      }
      case "add": {
        if (!lend) throw new Error("This Chrome is not lent.");
        const mine = generation;
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (mine !== generation) throw new Error("Sharing ended.");
        if (tab?.id && !(await isMember(tab.id))) await addToGroup(tab.id, tab.windowId);
        showTabs();
        return snapshot();
      }
      case "remove": {
        if (!lend || !Number.isInteger(message.tabId) || !(await isMember(message.tabId)))
          throw new Error("This tab is not lent.");
        await whileNotDragging(() => chrome.tabs.ungroup(message.tabId));
        await reconcileNow();
        return snapshot();
      }
      default:
        throw new Error("Unsupported panel command.");
    }
  }
  return {
    ready,
    command,
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async wake() {
      await ready;
      if (state.sharing && state.phase === "waiting" && Date.now() >= state.retryAt)
        await connect(session, true);
    },
  };
}
