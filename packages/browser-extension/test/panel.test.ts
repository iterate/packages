import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/lend.js", import.meta.url), "utf8");

void test("initial overload waits, disposes its socket, and recovers one lend", async () => {
  const p = await panel();
  p.plans.push({ whoami: () => Promise.reject(overload()) });
  await p.signedIn();
  assert.equal(p.controller.snapshot().phase, "waiting");
  assert.notEqual(p.controller.snapshot().phase, "connected");
  assert.equal(p.sockets[0].disposed, true);
  const wait = p.nextWait();
  assert.ok(wait >= 10_000 && wait <= 20_000, String(wait));
  await p.tick(wait - 1);
  assert.equal(p.sockets.length, 1);
  await p.tick(1);
  assert.equal(p.controller.snapshot().phase, "connected");
  assert.equal(p.sockets.length, 2);
  assert.equal(p.sockets[1].calls.provide, 1);
  assert.equal(p.controller.snapshot().name, "itx.chrome.test.test");
});

void test("a dropped live socket clears its lend and reconnects without replaying actions", async () => {
  const p = await panel();
  await p.signedIn();
  await p.sockets[0].browser.cdp(7, "Input.insertText", { text: "one action" });
  await assert.rejects(p.controller.command({ action: "prove" }), /Action interrupted/);
  assert.equal(p.sockets[0].calls.actions, 1);
  await p.attachForTest();
  p.sockets[0].emit("close");
  await flush();
  assert.notEqual(p.controller.snapshot().phase, "connected");
  p.chrome.debugger.onEvent.emit({ tabId: 7 }, "Runtime.bindingCalled", {
    name: "ignored",
    payload: "ended",
  });
  assert.ok(!p.appends.some((event) => event.type === "ignored"));
  await p.tick(3_000);
  assert.equal(p.sockets.length, 2);
  assert.equal(p.sockets[1].calls.actions, 0);
  assert.ok(p.commands.some(([, method]) => method === "detach"));
  assert.equal(p.groups[0].title, "iterate.com");
});

void test("sign-out cancels an overload retry and removes the bearer rule", async () => {
  const p = await panel();
  p.plans.push({ whoami: () => Promise.reject(overload()) });
  await p.signedIn();
  await p.controller.command({ action: "logout" });
  await p.tick(600_000);
  assert.equal(p.sockets.length, 1);
  assert.equal(p.timers.size, 0);
  assert.notEqual(p.controller.snapshot().phase, "connected");
  assert.equal(p.signOuts(), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(p.rules.at(-1))), { removeRuleIds: [1] });
});

void test("a late token after sign-out cannot open a socket or restore a bearer", async () => {
  const p = await panel();
  const token = deferred();
  p.token(() => token.promise);
  const pending = p.signedIn();
  await flush();
  await p.controller.command({ action: "logout" });
  token.resolve("late-token");
  await pending;
  await flush();
  assert.equal(p.sockets.length, 0);
  assert.ok(p.rules.every((rule) => !rule.addRules));
  assert.equal(p.storage.refreshedSession, undefined);
});

void test("overloads keep retrying for 30 minutes then require Lend again", async () => {
  const p = await panel();
  for (let i = 0; i < 100; i += 1) p.plans.push({ whoami: () => Promise.reject(overload()) });
  await p.signedIn();
  const deadline = p.controller.snapshot().recoveryUntil;
  assert.equal(deadline, 30 * 60_000);
  const waits = [];
  while (p.controller.snapshot().phase === "waiting") {
    const wait = p.nextWait();
    waits.push(wait);
    assert.ok(wait > 0 && wait <= 60_000);
    await p.tick(wait);
  }
  assert.equal(p.now(), deadline);
  assert.ok(p.sockets.length > 5);
  assert.equal(p.controller.snapshot().phase, "exhausted");
  assert.equal(p.timers.size, 0);
  const attempts = p.sockets.length;
  await p.tick(600_000);
  await p.controller.wake();
  assert.equal(p.sockets.length, attempts);
  await p.controller.command({ action: "share" });
  assert.equal(p.controller.snapshot().phase, "waiting");
  assert.equal(p.controller.snapshot().retries, 1);
  assert.equal(p.controller.snapshot().recoveryUntil, p.now() + 30 * 60_000);
});

void test("close, error and heartbeat failure produce one reconnect", async () => {
  const p = await panel();
  await p.signedIn();
  p.sockets[0].emit("error");
  p.sockets[0].emit("close");
  p.sockets[0].emit("close");
  await p.tick(3_000);
  assert.equal(p.sockets.length, 2);
  assert.equal(p.controller.snapshot().phase, "connected");
});

void test("heartbeat rejection is a failure and an unanswered handshake has a deadline", async () => {
  const p = await panel();
  p.plans.push({
    probe: (count) => (count === 1 ? Promise.resolve([]) : Promise.reject(overload())),
  });
  await p.signedIn();
  await p.tick(20_000);
  assert.notEqual(p.controller.snapshot().phase, "connected");
  assert.equal(p.controller.snapshot().phase, "waiting");

  const q = await panel();
  q.plans.push({ whoami: () => new Promise(() => {}) });
  const pending = q.signedIn();
  await flush();
  await q.tick(20_000);
  await pending;
  assert.equal(q.sockets[0].disposed, true);
  assert.equal(q.controller.snapshot().phase, "waiting");
});

void test("a displaced lend stops until the person chooses Lend again", async () => {
  const p = await panel();
  await p.signedIn();
  p.sockets[0].ended.resolve("replaced");
  await flush();
  assert.notEqual(p.controller.snapshot().phase, "connected");
  await p.tick(600_000);
  assert.equal(p.sockets.length, 1);
  assert.equal(p.timers.size, 0);
  assert.equal(p.controller.snapshot().phase, "displaced");
});

// The mind's API checks the bearer inside the session: a refused one fails the first call.
void test("a bearer that the mind refuses at authenticate waits for the person", async () => {
  const p = await panel();
  p.plans.push({
    whoami: () =>
      Promise.reject(
        Object.assign(new Error("no live credential of this mind: sign in again"), {
          code: "UNAUTHENTICATED",
        }),
      ),
  });
  await p.signedIn();
  await p.tick(600_000);
  assert.equal(p.sockets.length, 1);
  assert.equal(p.timers.size, 0);
  assert.equal(p.controller.snapshot().phase, "failed");
});

void test("old browser targets refuse actions after recovery and membership remains the grant", async () => {
  const p = await panel();
  await p.signedIn();
  const old = p.sockets[0].browser;
  p.sockets[0].emit("close");
  await p.tick(3_000);
  await assert.rejects(old.tabs(), /connection ended/);
  await assert.rejects(old.page(7), /connection ended/);
  await assert.rejects(old.openPage({ url: "https://example.com" }), /connection ended/);
  await assert.rejects(old.cdp(7, "Input.insertText", { text: "never sent" }), /connection ended/);
  await assert.rejects(old.detach(7), /connection ended/);
  const current = p.sockets[1].browser;
  p.tabs[0].groupId = -1;
  await assert.rejects(current.cdp(7, "Input.insertText", { text: "never sent" }), /not in the/);
  assert.equal(p.commands.length, 0);
});

void test("flapping connections do not reset or prematurely exhaust the recovery window", async () => {
  const p = await panel();
  await p.signedIn();
  let deadline;
  for (let i = 0; i < 8; i += 1) {
    p.sockets.at(-1).emit("close");
    await flush();
    deadline ??= p.controller.snapshot().recoveryUntil;
    assert.equal(p.controller.snapshot().recoveryUntil, deadline);
    await p.tick(p.nextWait());
    assert.equal(p.controller.snapshot().phase, "connected");
  }
  assert.equal(p.sockets.length, 9);
  await p.controller.command({ action: "stop" });
  assert.equal(p.timers.size, 0);
});

void test("a stable connection resets the retry budget and heartbeat timers do not accumulate", async () => {
  const p = await panel();
  await p.signedIn();
  p.sockets[0].emit("close");
  await p.tick(3_000);
  await p.tick(60_000);
  assert.equal(p.sockets[0].calls.whoami, 1);
  assert.equal(p.timers.size, 1);
  p.sockets[1].emit("close");
  assert.ok(p.nextWait() <= 2_000);
  await p.controller.command({ action: "logout" });
  assert.equal(p.timers.size, 0);
});

void test("jitter varies retry waits and honors the server cooldown", async () => {
  const waits = [];
  for (const random of [0, 0.99]) {
    const p = await panel();
    p.random(random);
    p.plans.push({ whoami: () => Promise.reject(overload()) });
    await p.signedIn();
    waits.push(p.nextWait());
  }
  assert.ok(waits[1] > waits[0]);
  const p = await panel();
  p.plans.push({
    whoami: () =>
      Promise.reject(
        Object.assign(new Error("Busy"), {
          code: "UNAVAILABLE",
          data: { kind: "overloaded", retryAfterMs: 45_000 },
        }),
      ),
  });
  await p.signedIn();
  assert.equal(p.nextWait(), 45_000);
});

void test("a late handshake cannot provide or replace a newer lend", async () => {
  const p = await panel();
  const whoami = deferred();
  p.plans.push({ whoami: () => whoami.promise });
  const pending = p.signedIn();
  await flush();
  await p.controller.command({ action: "stop" });
  await p.controller.command({ action: "share" });
  whoami.resolve({ principal: { email: "old@example.com" } });
  await pending;
  assert.equal(p.sockets[0].calls.provide, 0);
  assert.equal(p.sockets[0].disposed, true);
  assert.equal(p.controller.snapshot().name, "itx.chrome.test.test");
});

void test("a failed rotating refresh is not automatically replayed", async () => {
  const p = await panel();
  let refreshes = 0;
  p.token(() => {
    refreshes += 1;
    return Promise.reject(new Error("Failed to fetch"));
  });
  await p.signedIn();
  await p.tick(600_000);
  assert.equal(refreshes, 1);
  assert.equal(p.sockets.length, 0);
  assert.equal(p.timers.size, 0);
});

void test("a failed lend watcher recovers and stale page reports do not cross connections", async () => {
  const p = await panel();
  await p.signedIn();
  p.chrome.debugger.onEvent.emit({ tabId: 7 }, "Runtime.bindingCalled", {
    name: "report",
    payload: "old connection",
  });
  p.sockets[0].ended.reject(overload());
  await flush();
  assert.notEqual(p.controller.snapshot().phase, "connected");
  await p.tick(p.nextWait());
  assert.equal(p.sockets.length, 2);
  assert.ok(!p.appends.some((event) => event.payload?.payload === "old connection"));
});

void test("sign-out during tab membership lookup cannot leave a late debugger attached", async () => {
  const p = await panel();
  await p.signedIn();
  const member = deferred();
  p.chrome.tabs.get = () => member.promise;
  const action = p.sockets[0].browser.cdp(7, "Input.insertText", { text: "never sent" });
  const refused = assert.rejects(action, /connection ended/);
  await flush();
  await p.controller.command({ action: "logout" });
  member.resolve(p.tabs[0]);
  await refused;
  assert.equal(p.commands.length, 0);
});

void test("sign-out during domain setup sends no later CDP setup or input", async () => {
  const p = await panel();
  await p.signedIn();
  const enabling = deferred();
  p.chrome.debugger.attach = async () => {};
  p.chrome.debugger.sendCommand = async ({ tabId }, method) => {
    p.commands.push([tabId, method]);
    if (method === "Page.enable") return enabling.promise;
    if (method === "Runtime.evaluate") return { result: { value: "https://example.com" } };
    return {};
  };
  const action = p.sockets[0].browser.cdp(7, "Input.insertText", { text: "never sent" });
  const refused = assert.rejects(action, /connection ended/);
  await flush();
  assert.deepEqual(p.commands, [[7, "Page.enable"]]);
  const signingOut = p.controller.command({ action: "logout" });
  await flush();
  enabling.resolve({});
  await refused;
  await signingOut;
  assert.deepEqual(p.commands, [
    [7, "Page.enable"],
    [7, "detach"],
  ]);
});

void test("a rename still saving at sign-out cannot start another connection", async () => {
  const p = await panel();
  await p.signedIn();
  const saving = deferred();
  const set = p.chrome.storage.local.set;
  p.chrome.storage.local.set = async (values) => {
    if (values.browserName) await saving.promise;
    return set(values);
  };
  const renaming = p.controller.command({ action: "rename", name: "renamed" });
  await flush();
  await p.controller.command({ action: "logout" });
  const connections = p.sockets.length;
  saving.resolve();
  await renaming;
  assert.equal(p.sockets.length, connections);
  assert.notEqual(p.controller.snapshot().phase, "connected");
  assert.equal(p.sockets.length, 1);
  assert.equal(p.timers.size, 0);
});

for (const stalled of ["Page.enable", "Runtime.addBinding"]) {
  void test(`recovery replaces cancelled ${stalled} initialization before it answers`, async () => {
    const p = await panel();
    await p.signedIn();
    const enabling = deferred();
    let blocked = false;
    p.chrome.debugger.attach = async () => {};
    p.chrome.debugger.sendCommand = async ({ tabId }, method) => {
      p.commands.push([tabId, method]);
      if (method === stalled && !blocked) {
        blocked = true;
        return enabling.promise;
      }
      if (method === "Runtime.evaluate") return { result: { value: "https://example.com" } };
      return {};
    };
    const action = p.sockets[0].browser.cdp(7, "Input.insertText", { text: "never sent" });
    const refused = assert.rejects(action, /connection ended/);
    await flush();
    p.sockets[0].emit("close");
    await p.tick(3_000);
    assert.equal(p.sockets.length, 2);
    assert.equal(p.controller.snapshot().phase, "connected");
    const current = p.sockets[1].browser.cdp(7, "Input.insertText", { text: "fresh connection" });
    current.catch(() => {});
    assert.equal(await Promise.race([current.then(() => true), flush().then(() => false)]), true);
    const detached = p.commands.filter(([, method]) => method === "detach").length;
    assert.ok(detached > 0);
    enabling.resolve({});
    await refused;
    assert.equal(p.commands.filter(([, method]) => method === "detach").length, detached);
    assert.equal(p.commands.filter(([, method]) => method === "Input.insertText").length, 1);
  });
}

void test("sign-out during takeover detaches a leftover extension session", async () => {
  const p = await panel();
  await p.signedIn();
  const attaching = deferred();
  p.chrome.debugger.attach = () => attaching.promise;
  const action = p.sockets[0].browser.cdp(7, "Input.insertText", { text: "never sent" });
  const refused = assert.rejects(action, /connection ended/);
  await flush();
  const signingOut = p.controller.command({ action: "logout" });
  await flush();
  attaching.reject(new Error("Another debugger is already attached"));
  await refused;
  await signingOut;
  assert.deepEqual(p.commands, [[7, "detach"]]);
});

void test("a teardown deadline cannot let a late detach remove a replacement attachment", async () => {
  const p = await panel();
  await p.signedIn();
  await p.attachForTest();
  const detaching = deferred();
  let attaches = 0;
  p.chrome.debugger.detach = () => detaching.promise;
  p.chrome.debugger.attach = async () => {
    attaches += 1;
  };
  p.chrome.debugger.sendCommand = async () => ({ result: { value: "https://example.com" } });
  p.sockets[0].emit("close");
  await p.tick(4_000);
  assert.equal(p.sockets.length, 2);
  const action = p.sockets[1].browser.cdp(7, "Runtime.evaluate", { expression: "1" });
  await flush();
  assert.equal(attaches, 0);
  detaching.resolve();
  await action;
  assert.equal(attaches, 1);
});

void test("Chrome already detached is completed teardown, so recovery can attach again", async () => {
  const p = await panel();
  await p.signedIn();
  await p.attachForTest();
  let attaches = 0;
  p.chrome.debugger.detach = async () => {
    throw new Error("Debugger is not attached to the tab with id: 7.");
  };
  p.chrome.debugger.attach = async () => {
    attaches += 1;
  };
  p.chrome.debugger.sendCommand = async () => ({ result: { value: "https://example.com" } });
  p.sockets[0].emit("close");
  await p.tick(3_000);
  await p.sockets[1].browser.cdp(7, "Input.insertText", { text: "fresh connection" });
  assert.equal(attaches, 1);
});

void test("retry after a live setup failure waits for its native detach", async () => {
  const p = await panel();
  await p.signedIn();
  const detaching = deferred();
  let attaches = 0;
  let failed = false;
  p.chrome.debugger.attach = async () => {
    attaches += 1;
  };
  p.chrome.debugger.detach = () => detaching.promise;
  p.chrome.debugger.sendCommand = async (_target, method) => {
    if (method === "Page.enable" && !failed) {
      failed = true;
      throw new Error("Setup refused");
    }
    return { result: { value: "https://example.com" } };
  };
  const first = assert.rejects(
    p.sockets[0].browser.cdp(7, "Input.insertText", { text: "failed" }),
    /Setup refused/,
  );
  await flush();
  await p.tick(1_000);
  await first;
  const second = p.sockets[0].browser.cdp(7, "Input.insertText", { text: "explicit retry" });
  await flush();
  assert.equal(attaches, 1);
  detaching.resolve();
  await second;
  assert.equal(attaches, 2);
});

void test("Chrome's detach event completes cancelled teardown", async () => {
  const p = await panel();
  await p.signedIn();
  await p.attachForTest();
  let attaches = 0;
  p.chrome.debugger.attach = async () => {
    attaches += 1;
  };
  p.chrome.debugger.sendCommand = async () => ({ result: { value: "https://example.com" } });
  p.chrome.debugger.onDetach.emit({ tabId: 7 }, "target_closed");
  await p.sockets[0].browser.cdp(7, "Input.insertText", { text: "after Chrome detach" });
  assert.equal(attaches, 1);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function event() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => listeners.forEach((listener) => listener(...args)),
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}
function overload() {
  return new Error("Durable Object is overloaded. Requests queued for too long.");
}

async function panel(
  sharedSession = {},
  localStorage = undefined,
  shareOnStart = false,
  initialNow = 0,
) {
  let now = initialNow;
  let nextTimer = 0;
  const timers = new Map();
  const later = (fn, ms, interval = false) => {
    timers.set(++nextTimer, { fn, at: now + ms, ms, interval });
    return nextTimer;
  };
  const plans = [];
  const sockets = [];
  const warnings = [];
  const commands = [];
  const appends = [];
  const session = { issuer: "https://iterate.iterate.com", expiresAt: 3_600_000 };
  const storage = localStorage || {
    browserName: "test",
    mind: "iterate.com",
    "oauth:session": session,
  };
  let token = () => Promise.resolve("test-token");
  let signing = () => Promise.resolve(session);
  let random = 0.5;
  let signOuts = 0;
  const rules = [];
  const groups = [{ id: 4, windowId: 1, title: "iterate.com" }];
  const tabs = [{ id: 7, groupId: 4, windowId: 1 }];
  class Socket {
    listeners = new Map();
    readyState = 0;
    disposed = false;
    calls = { whoami: 0, provide: 0, actions: 0, probes: 0 };
    plan = plans.shift() ?? {};
    ended = deferred();
    constructor() {
      sockets.push(this);
    }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }
    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }
    emit(type, fields = {}) {
      if (type === "close") this.readyState = 3;
      this.listeners.get(type)?.forEach((listener) => listener(fields));
    }
    close() {
      this.emit("close");
    }
  }
  const chrome = {
    storage: {
      session: {
        get: async () => sharedSession,
        set: async (values) => Object.assign(sharedSession, values),
      },
      local: {
        get: async () => storage,
        set: async (values) => Object.assign(storage, values),
        remove: async () => {},
      },
    },
    alarms: { create: async () => {}, clear: async () => {} },
    identity: { getRedirectURL: () => "https://test.chromiumapp.org/" },
    runtime: { id: "test", getManifest: () => ({ version: "0.7.0" }) },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    declarativeNetRequest: { updateSessionRules: async (rule) => rules.push(rule) },
    tabs: {
      onUpdated: event(),
      onRemoved: event(),
      onReplaced: event(),
      get: async (id) => tabs.find((tab) => tab.id === id),
      query: async () => tabs,
    },
    tabGroups: {
      TAB_GROUP_ID_NONE: -1,
      query: async () => groups,
      get: async (id) => groups.find((group) => group.id === id),
      onCreated: event(),
      onUpdated: event(),
      onRemoved: event(),
    },
    debugger: {
      onEvent: event(),
      onDetach: event(),
      getTargets: async () => [{ tabId: 7, url: "https://example.com/", title: "Example" }],
      attach: async () => {},
      detach: async ({ tabId }) => commands.push([tabId, "detach"]),
      sendCommand: async ({ tabId }, method) => {
        commands.push([tabId, method]);
        return { result: { value: "https://example.com" } };
      },
    },
  };
  const context = vm.createContext({
    chrome,
    fetch: async (url) => {
      if (url.endsWith("/.well-known/oauth-authorization-server")) return { ok: true };
      throw new Error("Unexpected fixture fetch");
    },
    navigator: {},
    console: { error: () => {}, warn: (...args) => warnings.push(args), info: () => {} },
    WebSocket: Socket,
    AbortController,
    URL,
    Error,
    Symbol,
    Math: Object.assign(Object.create(Math), { random: () => random }),
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    setTimeout: (fn, ms) => later(fn, ms),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => later(fn, ms, true),
    clearInterval: (id) => timers.delete(id),
    RpcTarget: class {},
    ChromePage: class {},
    locatorSource: "",
    oauthClient: ({ sessions, beforeRefresh }) => ({
      session: async () => storage["oauth:session"],
      signIn: async () => {
        const next = await signing();
        await sessions.set("oauth:session", next);
        return next;
      },
      freshAccessToken: async () => {
        const stored = await sessions.get("oauth:session");
        if (now >= stored.expiresAt - 30_000) await beforeRefresh?.();
        const accessToken = await token();
        await sessions.set("refreshedSession", accessToken);
        return accessToken;
      },
      signOut: async () => {
        signOuts += 1;
        delete storage["oauth:session"];
      },
    }),
    newWebSocketRpcSession: (socket) => ({
      whoami: () => {
        socket.calls.whoami += 1;
        if (socket.plan.whoami) return socket.plan.whoami(socket.calls.whoami);
        return Promise.resolve({ mindSlug: "iterate", principal: { email: "test@example.com" } });
      },
      provide: async (_name, browser) => {
        socket.calls.provide += 1;
        socket.browser = browser;
        if (socket.plan.provide) await socket.plan.provide();
        return { lendEnded: () => socket.ended.promise };
      },
      append: async (value) => {
        appends.push(value);
      },
      invoke: async (steps) => {
        if (steps.at(-1)?.[0] === "tabs") {
          socket.calls.probes += 1;
          if (socket.plan.probe) return socket.plan.probe(socket.calls.probes);
          return socket.browser.tabs();
        }
        socket.calls.actions += 1;
        throw new Error("Action interrupted");
      },
      [Symbol.dispose]: () => {
        socket.disposed = true;
        socket.close();
      },
    }),
  });
  context.disconnectOffscreen = async () => {};
  context.openOffscreenApi = async (_url, current, onFailure) => {
    if (!current()) return null;
    const socket = new Socket();
    socket.fail = onFailure;
    socket.addEventListener("close", () =>
      onFailure(new Error("The WebSocket connection closed.")),
    );
    socket.addEventListener("error", () =>
      onFailure(new Error("The WebSocket connection failed.")),
    );
    return context.newWebSocketRpcSession(socket);
  };
  const module = new vm.SourceTextModule(source, { context });
  await module.link(async (specifier) => {
    if (specifier === "./instructions.js")
      return new vm.SourceTextModule(
        readFileSync(new URL("../public/instructions.js", import.meta.url), "utf8"),
        { context },
      );
    if (specifier === "./address.js")
      return new vm.SourceTextModule(
        readFileSync(new URL("../public/address.js", import.meta.url), "utf8"),
        { context },
      );
    const exports =
      specifier === "./capnweb.js"
        ? ["RpcTarget"]
        : specifier === "./offscreen-client.js"
          ? ["openOffscreenApi", "disconnectOffscreen"]
          : specifier === "./page.js"
            ? ["ChromePage"]
            : specifier === "./locator-source.js"
              ? ["locatorSource"]
              : ["oauthClient"];
    return new vm.SyntheticModule(
      exports,
      function () {
        for (const name of exports) this.setExport(name, context[name]);
      },
      { context },
    );
  });
  await module.evaluate();
  const controller = module.namespace.createLending(shareOnStart);
  await controller.ready;
  return {
    controller,
    sharedSession,
    attachForTest: async () => {
      await sockets.at(-1).browser.cdp(7, "Runtime.evaluate", { expression: "0" });
      commands.length = 0;
    },
    chrome,
    storage,
    session,
    plans,
    sockets,
    timers,
    rules,
    groups,
    tabs,
    commands,
    appends,
    warnings,
    signedIn: () => controller.command({ action: "share" }),
    signOuts: () => signOuts,
    signing: (get) => {
      signing = get;
    },
    token: (get) => {
      token = get;
    },
    random: (value) => {
      random = value;
    },
    now: () => now,
    jump: (ms) => {
      now += ms;
    },
    nextWait: () =>
      controller.snapshot().retryAt !== null
        ? Math.max(0, controller.snapshot().retryAt - now)
        : Math.min(...[...timers.values()].map((timer) => timer.at - now)),
    tick: async (ms) => {
      await flush();
      const until = now + ms;
      for (;;) {
        const entry = [...timers]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, timer] = entry;
        now = Math.max(now, timer.at);
        if (timer.interval) timer.at += timer.ms;
        else timers.delete(id);
        timer.fn();
        await flush();
      }
      now = until;
      await flush();
    },
  };
}
void test("worker restart preserves an overload deadline and its retry budget", async () => {
  const p = await panel();
  p.plans.push({ whoami: () => Promise.reject(overload()) });
  await p.signedIn();
  const saved = structuredClone(p.sharedSession);
  const q = await panel(saved, p.storage);
  assert.equal(q.sockets.length, 0);
  assert.equal(q.controller.snapshot().phase, "waiting");
  assert.equal(q.controller.snapshot().retries, 1);
  await q.tick(q.nextWait() - 1);
  assert.equal(q.sockets.length, 0);
  await q.tick(1);
  assert.equal(q.sockets.length, 1);
  assert.equal(q.controller.snapshot().retries, 1);
  assert.equal(q.sockets[0].calls.actions, 0);
});

void test("successive worker losses preserve the original 30-minute recovery deadline", async () => {
  let p = await panel();
  await p.signedIn();
  let deadline;
  for (let i = 1; i <= 8; i += 1) {
    p = await panel(structuredClone(p.sharedSession), p.storage, false, p.now());
    assert.equal(p.controller.snapshot().phase, "waiting");
    assert.equal(p.controller.snapshot().retries, i);
    deadline ??= p.controller.snapshot().recoveryUntil;
    assert.equal(p.controller.snapshot().recoveryUntil, deadline);
    await p.tick(p.nextWait());
    assert.equal(p.sockets.length, 1);
    assert.equal(p.controller.snapshot().phase, "connected");
  }
  const stopped = await panel(structuredClone(p.sharedSession), p.storage, false, deadline);
  assert.equal(stopped.controller.snapshot().phase, "exhausted");
  await stopped.tick(600_000);
  await stopped.controller.wake();
  assert.equal(stopped.sockets.length, 0);
});

void test("an alarm and timer due together create only one replacement socket", async () => {
  const p = await panel();
  await p.signedIn();
  p.sockets[0].emit("close");
  await p.tick(p.nextWait());
  await Promise.all([
    p.controller.wake(),
    p.controller.wake(),
    p.controller.command({ action: "state" }),
  ]);
  assert.equal(p.sockets.length, 2);
  assert.equal(p.sockets[1].calls.provide, 1);
});

void test("browser restart keeps authentication but sharing is off until an explicit request", async () => {
  const p = await panel();
  await p.signedIn();
  assert.equal(p.storage.sharingRequested, true);
  const restarted = await panel({}, p.storage);
  assert.equal(restarted.controller.snapshot().signedIn, true);
  assert.equal(restarted.controller.snapshot().sharing, false);
  await restarted.tick(600_000);
  await restarted.controller.wake();
  await restarted.controller.command({ action: "state" });
  assert.equal(restarted.sockets.length, 0);
  await restarted.signedIn();
  assert.equal(restarted.sockets.length, 1);
  const optedIn = await panel({}, p.storage, true);
  assert.equal(optedIn.sockets.length, 1);
});

void test("sleep during rotating refresh cannot automatically replay a token request", async () => {
  const p = await panel({
    lending: {
      sharing: true,
      issuer: "https://iterate.iterate.com",
      phase: "refreshing",
      retries: 2,
    },
  });
  await p.tick(600_000);
  await p.controller.wake();
  assert.equal(p.sockets.length, 0);
  assert.equal(p.controller.snapshot().phase, "failed");
});

void test("opening multiple panel views does not connect or call the mind", async () => {
  const p = await panel();
  await p.signedIn();
  let observations = 0;
  const stop = p.controller.subscribe(() => {
    observations += 1;
  });
  await Promise.all(Array.from({ length: 20 }, () => p.controller.command({ action: "state" })));
  await p.tick(60_000);
  stop();
  assert.ok(observations > 0);
  assert.equal(p.sockets.length, 1);
  assert.equal(p.sockets[0].calls.whoami, 1);
  assert.equal(p.sockets[0].calls.probes, 4); // setup, then every20seconds
  assert.equal(p.sockets[0].calls.provide, 1);
  assert.equal(p.sockets[0].calls.actions, 0);
});

void test("worker restart cleans up only recorded debugger targets before restoring a lend", async () => {
  const p = await panel({
    debuggeeIds: [7],
    lending: {
      sharing: true,
      issuer: "https://iterate.iterate.com",
      phase: "connected",
      retries: 0,
    },
  });
  assert.deepEqual(
    p.commands.filter(([, method]) => method === "detach"),
    [[7, "detach"]],
  );
  assert.equal(p.sharedSession.debuggeeIds.length, 0);
  await p.tick(p.nextWait());
  assert.equal(p.sockets.length, 1);
});

void test("turning sharing off cancels recovery across worker wake and keeps tab groups", async () => {
  const p = await panel();
  p.plans.push({ whoami: () => Promise.reject(overload()) });
  await p.signedIn();
  await p.controller.command({ action: "stop" });
  const q = await panel(structuredClone(p.sharedSession), p.storage);
  await q.tick(600_000);
  await q.controller.wake();
  assert.equal(q.controller.snapshot().phase, "off");
  assert.equal(q.sockets.length, 0);
  assert.equal(q.groups[0].title, "iterate.com");
});

void test("crossing the refresh cutoff during token acquisition cannot replay after worker loss", async () => {
  const p = await panel({}, undefined, false, 3_569_999);
  const token = deferred();
  let requests = 0;
  p.token(() => {
    requests += 1;
    return token.promise;
  });
  const reading = deferred();
  const get = p.chrome.storage.local.get;
  p.chrome.storage.local.get = async (key) => {
    if (key === "oauth:session") await reading.promise;
    return get(key);
  };
  const pending = p.signedIn();
  await flush();
  await p.tick(2);
  reading.resolve();
  await flush();
  assert.equal(p.sharedSession.lending.phase, "refreshing");
  const saved = structuredClone(p.sharedSession);
  await p.controller.command({ action: "stop" });
  token.resolve("late-token");
  await pending;
  const q = await panel(saved, p.storage, false, 3_570_001);
  await q.tick(600_000);
  await q.controller.wake();
  assert.equal(requests, 1);
  assert.equal(q.sockets.length, 0);
  assert.equal(q.controller.snapshot().phase, "failed");
});

void test("sign-out fences an unfinished sign-in and blocks a competing login until it settles", async () => {
  const p = await panel();
  const signing = deferred();
  p.signing(() => signing.promise);
  const pending = p.controller.command({ action: "login", mind: "iterate.com" });
  const refused = assert.rejects(pending, /Sharing ended|sign-in ended/);
  await flush();
  await p.controller.command({ action: "logout" });
  await assert.rejects(
    p.controller.command({ action: "login", mind: "iterate.com" }),
    /current sign-in/,
  );
  signing.resolve(p.session);
  await refused;
  assert.equal(p.storage["oauth:session"], undefined);
  assert.equal(p.controller.snapshot().signedIn, false);
  p.signing(() => Promise.resolve(p.session));
  await p.controller.command({ action: "login", mind: "iterate.com" });
  assert.equal(p.controller.snapshot().signedIn, true);
  assert.equal(p.controller.snapshot().sharing, false);
});

void test("a stale in-memory expiry does not turn cached-token recovery into an interrupted refresh", async () => {
  const p = await panel();
  await p.signedIn();
  const cached = deferred();
  p.token(() => cached.promise);
  p.session.expiresAt = -1;
  p.storage["oauth:session"] = { ...p.session, expiresAt: 3_600_000 };
  p.sockets[0].emit("close");
  await p.tick(3_000);
  assert.equal(p.sharedSession.lending.phase, "connecting");
  const saved = structuredClone(p.sharedSession);
  await p.controller.command({ action: "stop" });
  cached.resolve("cached-token");
  await flush();
  const q = await panel(saved, p.storage);
  assert.equal(q.controller.snapshot().phase, "waiting");
  await q.tick(q.nextWait());
  assert.equal(q.controller.snapshot().phase, "connected");
});

for (const grouped of [true, false])
  void test(`openPage uses an existing normal window without a current window (group=${grouped})`, async () => {
    const p = await panel();
    await p.signedIn();
    if (!grouped) p.groups.length = 0;
    p.chrome.windows = {
      getCurrent: async () => {
        throw new Error("No current window");
      },
      getAll: async () => [{ id: 1 }],
    };
    let created;
    p.chrome.tabs.create = async (options) => {
      created = options;
      const tab = { id: 8, windowId: options.windowId, groupId: -1, status: "complete" };
      p.tabs.push(tab);
      return tab;
    };
    p.chrome.tabs.group = async (options) => {
      const id = options.groupId ?? 5;
      if (!p.groups.some((group) => group.id === id))
        p.groups.push({ id, windowId: options.createProperties.windowId, title: "" });
      p.tabs.find((tab) => tab.id === 8).groupId = id;
      return id;
    };
    p.chrome.tabGroups.update = async (id, change) =>
      Object.assign(
        p.groups.find((group) => group.id === id),
        change,
      );
    const opened = await p.sockets[0].browser.openPage({ url: "https://fixture.test/form" });
    assert.equal(opened.tabId, 8);
    assert.equal(created.windowId, 1);
    assert.equal(
      p.groups.find((group) => group.id === p.tabs.find((tab) => tab.id === 8).groupId).title,
      "iterate.com",
    );
  });
void test("openPage asks for a browser window when none exists without creating a tab", async () => {
  const p = await panel();
  await p.signedIn();
  p.groups.length = 0;
  p.chrome.windows = {
    getCurrent: async () => {
      throw new Error("No current window");
    },
    getAll: async () => [],
  };
  let created = 0;
  p.chrome.tabs.create = async () => {
    created += 1;
  };
  await assert.rejects(
    p.sockets[0].browser.openPage({ url: "https://fixture.test/form" }),
    /Open a Chrome window/,
  );
  assert.equal(created, 0);
});

for (const failureAt of ["provide", "lendEnded"])
  void test(`deploy incident:1006,redial,pager cut,${failureAt} overload recovers after17minutes`, async () => {
    const p = await panel();
    await p.signedIn();
    await p.sockets[0].browser.cdp(7, "Input.insertText", { text: "one authorized action" });
    p.sockets[0].emit("close", { code: 1006 });
    await p.tick(p.nextWait());
    assert.equal(p.sockets.length, 2);
    assert.equal(p.sockets[1].calls.provide, 1);
    const busy = () =>
      Object.assign(overload(), { code: "UNAVAILABLE", data: { kind: "overloaded" } });
    if (failureAt === "provide") p.plans.push({ provide: () => Promise.reject(busy()) });
    p.sockets[1].emit("close", { code: 1006, reason: "responseStreamDisconnected" });
    await p.tick(p.nextWait());
    if (failureAt === "lendEnded") {
      p.sockets[2].ended.reject(busy());
      await flush();
    }
    const deadline = p.controller.snapshot().recoveryUntil;
    assert.equal(p.controller.snapshot().phase, "waiting");
    while (p.now() < 17 * 60_000) {
      p.plans.push({ provide: () => Promise.reject(busy()) });
      await p.tick(p.nextWait());
      assert.equal(p.controller.snapshot().phase, "waiting");
      assert.equal(p.controller.snapshot().recoveryUntil, deadline);
    }
    assert.ok(p.sockets.length > 5);
    await p.tick(p.nextWait());
    assert.equal(p.controller.snapshot().phase, "connected");
    assert.equal(p.sockets.at(-1).calls.provide, 1);
    assert.equal(p.commands.filter(([, method]) => method === "Input.insertText").length, 1);
    assert.ok(p.sockets.every((socket) => socket.calls.actions === 0));
  });

for (const data of [undefined, { kind: "not-yet-known" }])
  void test(`generic UNAVAILABLE keeps retrying (data=${JSON.stringify(data)})`, async () => {
    const p = await panel();
    p.plans.push({
      provide: () =>
        Promise.reject(
          Object.assign(new Error("Temporarily unavailable"), { code: "UNAVAILABLE", data }),
        ),
    });
    await p.signedIn();
    assert.equal(p.controller.snapshot().phase, "waiting");
    await p.tick(p.nextWait());
    assert.equal(p.controller.snapshot().phase, "connected");
  });
void test("server cooldown longer than app backoff is respected within the recovery window", async () => {
  const p = await panel();
  p.plans.push({
    provide: () =>
      Promise.reject(
        Object.assign(overload(), {
          code: "UNAVAILABLE",
          data: { kind: "overloaded", retryAfterMs: 90_000 },
        }),
      ),
  });
  await p.signedIn();
  assert.equal(p.nextWait(), 90_000);
  await p.tick(89_999);
  assert.equal(p.sockets.length, 1);
  await p.tick(1);
  assert.equal(p.sockets.length, 2);
  assert.equal(p.controller.snapshot().phase, "connected");
});
void test("an outage deadline restored during worker sleep ends recovery without another socket", async () => {
  const p = await panel(
    {
      lending: {
        sharing: true,
        issuer: "https://iterate.iterate.com",
        phase: "waiting",
        retries: 40,
        retryAt: 1_800_000,
        recoveryUntil: 1_800_000,
      },
    },
    undefined,
    false,
    1_800_001,
  );
  assert.equal(p.controller.snapshot().phase, "exhausted");
  assert.equal(p.sockets.length, 0);
  assert.equal(p.timers.size, 0);
});
void test("a minute of stable connection starts a fresh window for the next outage", async () => {
  const p = await panel();
  await p.signedIn();
  p.sockets[0].emit("close");
  await p.tick(p.nextWait());
  const first = p.controller.snapshot().recoveryUntil;
  await p.tick(60_000);
  assert.equal(p.controller.snapshot().recoveryUntil, null);
  p.sockets[1].emit("close");
  await flush();
  assert.equal(p.controller.snapshot().retries, 1);
  assert.ok(p.controller.snapshot().recoveryUntil > first);
});

void test("a successful provide with an unavailable stub is not shown as connected", async () => {
  const p = await panel();
  const phases = [];
  p.controller.subscribe((state) => phases.push(state.phase));
  p.plans.push({
    probe: () =>
      Promise.reject(Object.assign(new Error("Stub offline"), { code: "RPC_STUB_OFFLINE" })),
  });
  await p.signedIn();
  assert.equal(p.sockets[0].calls.provide, 1);
  assert.equal(p.sockets[0].calls.probes, 1);
  assert.equal(p.controller.snapshot().phase, "waiting");
  assert.ok(!phases.includes("connected"));
  await p.tick(p.nextWait());
  assert.equal(p.controller.snapshot().phase, "connected");
});
void test("the lend heartbeat detects a failed pager while the outer API remains healthy", async () => {
  const p = await panel();
  p.plans.push({
    probe: (count) =>
      count === 1
        ? Promise.resolve([])
        : Promise.reject(
            Object.assign(overload(), { code: "UNAVAILABLE", data: { kind: "overloaded" } }),
          ),
  });
  await p.signedIn();
  await p.sockets[0].browser.cdp(7, "Input.insertText", { text: "once" });
  await p.tick(20_000);
  assert.equal(p.sockets[0].calls.whoami, 1);
  assert.equal(p.sockets[0].calls.probes, 2);
  assert.equal(p.controller.snapshot().phase, "waiting");
  await p.tick(p.nextWait());
  assert.equal(p.controller.snapshot().phase, "connected");
  assert.equal(p.commands.filter(([, method]) => method === "Input.insertText").length, 1);
});
void test("resolved offline pager notices recover without requiring a new API close", async () => {
  const p = await panel();
  await p.signedIn();
  p.sockets[0].ended.resolve("went offline (its pager dropped and could not be re-dialed)");
  await flush();
  assert.equal(p.controller.snapshot().phase, "waiting");
  await p.tick(p.nextWait());
  assert.equal(p.sockets.length, 2);
  assert.equal(p.controller.snapshot().phase, "connected");
});
for (const reason of ["was returned (its pager closed)", "was recalled by its lender"])
  void test(`explicit terminal lend stays manual: ${reason}`, async () => {
    const p = await panel();
    await p.signedIn();
    p.sockets[0].ended.resolve(reason);
    await flush();
    assert.equal(p.controller.snapshot().phase, "displaced");
    await p.tick(31 * 60_000);
    assert.equal(p.sockets.length, 1);
    assert.equal(p.timers.size, 0);
  });

void test("a late restored retry callback cannot replace a healthy recovered lend", async () => {
  const p = await panel({
    lending: {
      sharing: true,
      issuer: "https://iterate.iterate.com",
      phase: "waiting",
      retries: 12,
      retryAt: 10_000,
      recoveryUntil: 1_800_000,
    },
  });
  const callback = [...p.timers.values()].find((timer) => timer.at === 10_000).fn;
  await p.tick(10_000);
  assert.equal(p.controller.snapshot().phase, "connected");
  callback();
  await flush();
  assert.equal(p.sockets.length, 1);
  assert.equal(p.sockets[0].disposed, false);
});
void test("a server cooldown past the recovery deadline ends with no premature retry", async () => {
  const p = await panel();
  p.plans.push({
    provide: () =>
      Promise.reject(
        Object.assign(overload(), {
          code: "UNAVAILABLE",
          data: { kind: "overloaded", retryAfterMs: 3_600_000 },
        }),
      ),
  });
  await p.signedIn();
  assert.equal(p.nextWait(), 30 * 60_000);
  await p.tick(30 * 60_000);
  assert.equal(p.controller.snapshot().phase, "exhausted");
  assert.equal(p.sockets.length, 1);
  assert.equal(p.timers.size, 0);
});

void test("a sleeping worker cannot reset recovery with an overdue health timer", async () => {
  const p = await panel();
  await p.signedIn();
  p.sockets[0].emit("close");
  await p.tick(p.nextWait());
  const deadline = p.controller.snapshot().recoveryUntil;
  p.jump(120_000);
  await p.tick(0);
  assert.equal(p.sockets[1].calls.probes, 2); // one setup and one late check, no catch-up
  assert.equal(p.controller.snapshot().retries, 1);
  assert.equal(p.controller.snapshot().recoveryUntil, deadline);
  await p.tick(40_000);
  assert.equal(p.controller.snapshot().retries, 1);
  await p.tick(20_000);
  assert.equal(p.controller.snapshot().retries, 0);
});
void test("one heartbeat stays in flight and schedules the next after its reply", async () => {
  const p = await panel();
  const reply = deferred();
  p.plans.push({ probe: (count) => (count === 2 ? reply.promise : Promise.resolve([])) });
  await p.signedIn();
  await p.tick(20_000);
  assert.equal(p.sockets[0].calls.probes, 2);
  await p.tick(14_999);
  assert.equal(p.sockets[0].calls.probes, 2);
  reply.resolve([]);
  await flush();
  await p.tick(19_999);
  assert.equal(p.sockets[0].calls.probes, 2);
  await p.tick(1);
  assert.equal(p.sockets[0].calls.probes, 3);
});
void test("a reply queued after sleep cannot beat an expired heartbeat deadline", async () => {
  const p = await panel();
  const reply = deferred();
  p.plans.push({ probe: (count) => (count === 2 ? reply.promise : Promise.resolve([])) });
  await p.signedIn();
  await p.tick(20_000);
  p.jump(15_001);
  reply.resolve([]);
  await flush();
  assert.equal(p.controller.snapshot().phase, "waiting");
  assert.equal(p.sockets[0].disposed, true);
  const probes = p.sockets[0].calls.probes;
  await p.tick(p.nextWait() - 1);
  assert.equal(p.sockets[0].calls.probes, probes);
});
void test("a late setup reply cannot provide after the whole setup deadline", async () => {
  const p = await panel();
  const identity = deferred();
  p.plans.push({ whoami: () => identity.promise });
  const pending = p.signedIn();
  await flush();
  p.jump(20_001);
  identity.resolve({ principal: { email: "late@example.test" } });
  await pending;
  assert.equal(p.sockets[0].calls.provide, 0);
  assert.equal(p.controller.snapshot().phase, "waiting");
});
void test("the setup bound includes the alarm prerequisite and fences its late completion", async () => {
  const p = await panel();
  const alarm = deferred();
  p.chrome.alarms.create = () => alarm.promise;
  const pending = p.signedIn();
  await flush();
  await p.tick(20_000);
  await pending;
  assert.equal(p.controller.snapshot().phase, "failed");
  assert.equal(p.sockets.length, 0);
  alarm.resolve();
  await flush();
  assert.equal(p.sockets.length, 0);
});

for (const code of ["UNAUTHORIZED", "FORBIDDEN"])
  void test(`worker restart preserves terminal authentication refusal: ${code}`, async () => {
    const p = await panel();
    p.plans.push({
      provide: () => Promise.reject(Object.assign(new Error("Grant refused"), { code })),
    });
    await p.signedIn();
    const q = await panel(structuredClone(p.sharedSession), p.storage, false, p.now());
    await q.tick(31 * 60_000);
    await q.controller.wake();
    assert.equal(q.controller.snapshot().phase, "failed");
    assert.equal(q.sockets.length, 0);
  });
void test("worker restart preserves an explicitly returned lend", async () => {
  const p = await panel();
  await p.signedIn();
  p.sockets[0].ended.resolve("was returned (its pager closed)");
  await flush();
  const q = await panel(structuredClone(p.sharedSession), p.storage, false, p.now());
  await q.tick(31 * 60_000);
  await q.controller.wake();
  assert.equal(q.controller.snapshot().phase, "displaced");
  assert.equal(q.sockets.length, 0);
});
void test("late alarms, panel requests and restored timer callbacks share one in-flight setup", async () => {
  const p = await panel({
    lending: {
      sharing: true,
      issuer: "https://iterate.iterate.com",
      phase: "waiting",
      retries: 12,
      retryAt: 10_000,
      recoveryUntil: 1_800_000,
    },
  });
  const retry = [...p.timers.values()].find((timer) => timer.at === 10_000).fn;
  const identity = deferred();
  p.plans.push({ whoami: () => identity.promise });
  p.jump(60_000);
  const waking = p.controller.wake();
  await flush();
  retry();
  await Promise.all([
    p.controller.wake(),
    p.controller.command({ action: "share" }),
    p.controller.command({ action: "state" }),
  ]);
  assert.equal(p.sockets.length, 1);
  assert.equal(p.sockets[0].calls.whoami, 1);
  assert.equal(p.controller.snapshot().retries, 12);
  identity.resolve({ principal: { email: "fixture@example.test" } });
  await waking;
  await p.tick(0);
  assert.equal(p.sockets.length, 1);
  assert.equal(p.controller.snapshot().phase, "connected");
});

void test("a bearer-rule write resolved after the setup deadline cannot open a socket", async () => {
  const p = await panel();
  const write = deferred();
  p.chrome.declarativeNetRequest.updateSessionRules = async (rule) => {
    p.rules.push(rule);
    if (rule.addRules) await write.promise;
  };
  const pending = p.signedIn();
  await flush();
  p.jump(20_001);
  write.resolve();
  await pending;
  assert.equal(p.sockets.length, 0);
  assert.equal(p.controller.snapshot().phase, "waiting");
});

for (const failure of ["overloaded", "disconnected"])
  for (const random of [0, 0.5, 0.999])
    void test(`capped ${failure} recovery stays near one attempt per minute across restart (jitter=${random})`, async () => {
      const busy = () =>
        failure === "overloaded" ? overload() : new Error("The WebSocket disconnected.");
      const p = await panel();
      p.random(random);
      for (let i = 0; i < 8; i += 1) p.plans.push({ provide: () => Promise.reject(busy()) });
      await p.signedIn();
      while (p.controller.snapshot().retries < 7) await p.tick(p.nextWait());
      const deadline = p.controller.snapshot().recoveryUntil;
      assert.ok(p.nextWait() >= 54_000 && p.nextWait() <= 60_000, String(p.nextWait()));
      const saved = structuredClone(p.sharedSession);
      const q = await panel(saved, p.storage, false, p.now());
      q.random(random);
      q.plans.push({ provide: () => Promise.reject(busy()) });
      await q.controller.wake();
      await q.tick(q.nextWait() - 1);
      assert.equal(q.sockets.length, 0);
      await q.tick(1);
      assert.equal(q.sockets.length, 1);
      assert.equal(q.controller.snapshot().retries, 8);
      assert.equal(q.controller.snapshot().recoveryUntil, deadline);
      assert.ok(q.nextWait() >= 54_000 && q.nextWait() <= 60_000, String(q.nextWait()));
      await q.controller.wake();
      assert.equal(q.sockets.length, 1);
    });

for (const name of ["prototype", "constructor"])
  void test(`reserved principal ${name} uses a valid lend segment and cannot be chosen as browser name`, async () => {
    const p = await panel();
    p.plans.push({ whoami: async () => ({ principal: { email: `${name}@example.test` } }) });
    await p.signedIn();
    assert.equal(p.controller.snapshot().name, "itx.chrome.member.test");
    await assert.rejects(p.controller.command({ action: "rename", name }), /reserved/);
    assert.equal(p.sockets.length, 1);
  });

void test("normal token expiry obtains a fresh token without replay or a platform-failure warning", async () => {
  const p = await panel();
  await p.signedIn();
  await p.sockets[0].browser.cdp(7, "Input.insertText", { text: "once" });
  await p.tick(3_600_000);
  let refreshed = 0;
  p.token(async () => {
    refreshed += 1;
    return "fresh-fixture-token";
  });
  p.sockets[0].fail(Object.assign(new Error("The API token expired."), { code: "TOKEN_EXPIRED" }));
  await p.tick(p.nextWait());
  assert.equal(refreshed, 1);
  assert.equal(p.controller.snapshot().phase, "connected");
  assert.equal(p.sockets.length, 2);
  assert.equal(
    p.warnings.filter(([record]) => record?.event === "browser-extension.platform-failure-retry")
      .length,
    0,
  );
  assert.equal(p.commands.filter(([, method]) => method === "Input.insertText").length, 1);
});
