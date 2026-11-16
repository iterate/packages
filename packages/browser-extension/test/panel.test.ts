import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/panel.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace(/^export /gm, "")
  .replace(/try \{\n {2}const \[session, \{ mind \}\][\s\S]*$/, "");

void test("initial overload waits, disposes its socket, and recovers one lend", async () => {
  const p = panel();
  p.plans.push({ whoami: () => Promise.reject(overload()) });
  await p.signedIn();
  assert.match(p.view().innerHTML, /Reconnecting/);
  assert.equal(p.api.state().lend, null);
  assert.equal(p.sockets[0].disposed, true);
  const wait = p.nextWait();
  assert.ok(wait >= 10_000 && wait <= 20_000, String(wait));
  await p.tick(wait - 1);
  assert.equal(p.sockets.length, 1);
  await p.tick(1);
  assert.match(p.view().innerHTML, /Connected/);
  assert.equal(p.sockets.length, 2);
  assert.equal(p.sockets[1].calls.provide, 1);
  assert.equal(p.api.state().lend.name, "itx.chrome.test.test");
});

void test("a dropped live socket clears its lend and reconnects without replaying actions", async () => {
  const p = panel();
  await p.signedIn();
  await p.elements.get("prove").onclick();
  assert.equal(p.sockets[0].calls.invoke, 1);
  p.api.attachForTest();
  p.sockets[0].emit("close");
  await flush();
  assert.equal(p.api.state().lend, null);
  p.api.fact("ignored", {});
  assert.ok(!p.appends.some((event) => event.type === "ignored"));
  await p.tick(3_000);
  assert.equal(p.sockets.length, 2);
  assert.equal(p.sockets[1].calls.invoke, 0);
  assert.ok(p.commands.some(([, method]) => method === "detach"));
  assert.equal(p.groups[0].title, "iterate.com");
});

void test("sign-out cancels an overload retry and removes the bearer rule", async () => {
  const p = panel();
  p.plans.push({ whoami: () => Promise.reject(overload()) });
  await p.signedIn();
  await p.elements.get("logout").onclick();
  await p.tick(600_000);
  assert.equal(p.sockets.length, 1);
  assert.equal(p.timers.size, 0);
  assert.equal(p.api.state().lend, null);
  assert.equal(p.signOuts(), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(p.rules.at(-1))), { removeRuleIds: [1] });
});

void test("a late token after sign-out cannot open a socket or restore a bearer", async () => {
  const p = panel();
  const token = deferred();
  p.token(() => token.promise);
  const pending = p.signedIn();
  await flush();
  await p.elements.get("logout").onclick();
  token.resolve("late-token");
  await pending;
  await flush();
  assert.equal(p.sockets.length, 0);
  assert.ok(p.rules.every((rule) => !rule.addRules));
  assert.equal(p.storage.refreshedSession, undefined);
});

void test("repeated overloads back off and stop after five automatic retries", async () => {
  const p = panel();
  for (let i = 0; i < 10; i += 1) p.plans.push({ whoami: () => Promise.reject(overload()) });
  await p.signedIn();
  const waits = [];
  for (let i = 0; i < 5; i += 1) {
    const wait = p.nextWait();
    waits.push(wait);
    assert.ok(wait >= 10_000 && wait <= 60_000);
    await p.tick(wait);
  }
  assert.equal(p.sockets.length, 6);
  assert.ok(waits[1] > waits[0]);
  assert.ok(waits[2] > waits[1]);
  assert.match(p.view().innerHTML, /Automatic retries stopped/);
  assert.ok(p.elements.get("retry"));
  assert.equal(p.timers.size, 0);
  await p.tick(600_000);
  assert.equal(p.sockets.length, 6);
});

void test("close, error and heartbeat failure produce one reconnect", async () => {
  const p = panel();
  await p.signedIn();
  p.sockets[0].emit("error");
  p.sockets[0].emit("close");
  p.sockets[0].emit("close");
  await p.tick(3_000);
  assert.equal(p.sockets.length, 2);
  assert.match(p.view().innerHTML, /Connected/);
});

void test("heartbeat rejection is a failure and an unanswered handshake has a deadline", async () => {
  const p = panel();
  p.plans.push({
    whoami: (count) =>
      count === 1
        ? Promise.resolve({ principal: { email: "test@example.com" } })
        : Promise.reject(overload()),
  });
  await p.signedIn();
  await p.tick(30_000);
  assert.equal(p.api.state().lend, null);
  assert.match(p.view().innerHTML, /Reconnecting/);

  const q = panel();
  q.plans.push({ whoami: () => new Promise(() => {}) });
  const pending = q.signedIn();
  await flush();
  await q.tick(20_000);
  await pending;
  assert.equal(q.sockets[0].disposed, true);
  assert.match(q.view().innerHTML, /Reconnecting/);
});

void test("a displaced lend stops until the person chooses Lend again", async () => {
  const p = panel();
  await p.signedIn();
  p.sockets[0].ended.resolve("replaced");
  await flush();
  assert.equal(p.api.state().lend, null);
  await p.tick(600_000);
  assert.equal(p.sockets.length, 1);
  assert.equal(p.timers.size, 0);
  assert.match(p.view().innerHTML, /No longer lent/);
});

void test("permanent authentication errors wait for the person", async () => {
  const p = panel();
  p.plans.push({
    whoami: () => Promise.reject(Object.assign(new Error("Grant ended"), { code: "UNAUTHORIZED" })),
  });
  await p.signedIn();
  await p.tick(600_000);
  assert.equal(p.sockets.length, 1);
  assert.equal(p.timers.size, 0);
  assert.match(p.view().innerHTML, /Not connected/);
});

void test("old browser targets refuse actions after recovery and membership remains the grant", async () => {
  const p = panel();
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

void test("rapidly flapping sockets exhaust their shared retry budget", async () => {
  const p = panel();
  await p.signedIn();
  for (let i = 0; i < 5; i += 1) {
    p.sockets.at(-1).emit("close");
    await p.tick(p.nextWait());
    assert.match(p.view().innerHTML, /Connected/);
  }
  p.sockets.at(-1).emit("close");
  await p.tick(600_000);
  assert.equal(p.sockets.length, 6);
  assert.equal(p.timers.size, 0);
  assert.match(p.view().innerHTML, /Automatic retries stopped/);
});

void test("a stable connection resets the retry budget and heartbeat timers do not accumulate", async () => {
  const p = panel();
  await p.signedIn();
  p.sockets[0].emit("close");
  await p.tick(3_000);
  await p.tick(60_000);
  assert.equal(p.sockets[0].calls.whoami, 1);
  assert.equal(p.timers.size, 1);
  p.sockets[1].emit("close");
  assert.ok(p.nextWait() <= 2_000);
  await p.elements.get("logout").onclick();
  assert.equal(p.timers.size, 0);
});

void test("jitter varies retry waits and honors the server cooldown", async () => {
  const waits = [];
  for (const random of [0, 0.99]) {
    const p = panel();
    p.random(random);
    p.plans.push({ whoami: () => Promise.reject(overload()) });
    await p.signedIn();
    waits.push(p.nextWait());
  }
  assert.ok(waits[1] > waits[0]);
  const p = panel();
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
  const p = panel();
  const whoami = deferred();
  p.plans.push({ whoami: () => whoami.promise });
  const pending = p.signedIn();
  await flush();
  await p.api.connect(p.session);
  whoami.resolve({ principal: { email: "old@example.com" } });
  await pending;
  assert.equal(p.sockets[0].calls.provide, 0);
  assert.equal(p.sockets[0].disposed, true);
  assert.equal(p.api.state().lend.name, "itx.chrome.test.test");
});

void test("a failed rotating refresh is not automatically replayed", async () => {
  const p = panel();
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
  const p = panel();
  await p.signedIn();
  p.chrome.debugger.onEvent.emit({ tabId: 7 }, "Runtime.bindingCalled", {
    name: "report",
    payload: "old connection",
  });
  p.sockets[0].ended.reject(overload());
  await flush();
  assert.equal(p.api.state().lend, null);
  await p.tick(p.nextWait());
  assert.equal(p.sockets.length, 2);
  assert.ok(!p.appends.some((event) => event.payload?.payload === "old connection"));
});

void test("sign-out during tab membership lookup cannot leave a late debugger attached", async () => {
  const p = panel();
  await p.signedIn();
  const member = deferred();
  p.chrome.tabs.get = () => member.promise;
  const action = p.sockets[0].browser.cdp(7, "Input.insertText", { text: "never sent" });
  const refused = assert.rejects(action, /connection ended/);
  await flush();
  await p.elements.get("logout").onclick();
  member.resolve(p.tabs[0]);
  await refused;
  assert.equal(p.commands.length, 0);
});

void test("sign-out during domain setup sends no later CDP setup or input", async () => {
  const p = panel();
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
  const signingOut = p.elements.get("logout").onclick();
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
  const p = panel();
  await p.signedIn();
  const saving = deferred();
  const set = p.chrome.storage.local.set;
  p.chrome.storage.local.set = async (values) => {
    if (values.browserName) await saving.promise;
    return set(values);
  };
  p.elements.get("browser-name").value = "renamed";
  const renaming = p.elements.get("rename-form").onsubmit({ preventDefault() {} });
  await flush();
  await p.elements.get("logout").onclick();
  const generation = p.api.state().generation;
  saving.resolve();
  await renaming;
  assert.equal(p.api.state().generation, generation);
  assert.equal(p.api.state().lend, null);
  assert.equal(p.sockets.length, 1);
  assert.equal(p.timers.size, 0);
});

for (const stalled of ["Page.enable", "Runtime.addBinding"]) {
  void test(`recovery replaces cancelled ${stalled} initialization before it answers`, async () => {
    const p = panel();
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
    assert.match(p.view().innerHTML, /Connected/);
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
  const p = panel();
  await p.signedIn();
  const attaching = deferred();
  p.chrome.debugger.attach = () => attaching.promise;
  const action = p.sockets[0].browser.cdp(7, "Input.insertText", { text: "never sent" });
  const refused = assert.rejects(action, /connection ended/);
  await flush();
  const signingOut = p.elements.get("logout").onclick();
  await flush();
  attaching.reject(new Error("Another debugger is already attached"));
  await refused;
  await signingOut;
  assert.deepEqual(p.commands, [[7, "detach"]]);
});

void test("a teardown deadline cannot let a late detach remove a replacement attachment", async () => {
  const p = panel();
  await p.signedIn();
  p.api.attachForTest();
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
  const p = panel();
  await p.signedIn();
  p.api.attachForTest();
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
  const p = panel();
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
  const p = panel();
  await p.signedIn();
  p.api.attachForTest({ attachCancelled: true });
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

function panel() {
  const elements = new Map();
  class Element {
    html = "";
    children = [];
    textContent = "";
    value = "";
    set innerHTML(html) {
      this.html = html;
      for (const [, tag, id] of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)) {
        const Kind = tag === "button" ? Button : Element;
        elements.set(id, new Kind());
      }
    }
    get innerHTML() {
      return this.html;
    }
    get firstElementChild() {
      return this;
    }
    append(child) {
      this.children.push(child);
    }
    replaceChildren() {
      this.children = [];
    }
    setAttribute() {}
  }
  class Button extends Element {}
  elements.set("app", new Element());

  let now = 0;
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
  const storage = { browserName: "test", mind: "iterate.com" };
  let token = () => Promise.resolve("test-token");
  let random = 0.5;
  let signOuts = 0;
  const rules = [];
  const groups = [{ id: 4, windowId: 1, title: "iterate.com" }];
  const tabs = [{ id: 7, groupId: 4, windowId: 1 }];
  class Socket {
    listeners = new Map();
    readyState = 0;
    disposed = false;
    calls = { whoami: 0, provide: 0, invoke: 0 };
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
      local: {
        get: async () => storage,
        set: async (values) => Object.assign(storage, values),
        remove: async () => {},
      },
    },
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
      detach: async ({ tabId }) => commands.push([tabId, "detach"]),
      sendCommand: async ({ tabId }, method) => commands.push([tabId, method]),
    },
  };
  const context = vm.createContext({
    chrome,
    document: {
      getElementById: (id) => elements.get(id),
      createElement: () => new Element(),
    },
    Element,
    HTMLElement: Element,
    HTMLInputElement: Element,
    HTMLButtonElement: Button,
    HTMLUListElement: Element,
    HTMLPreElement: Element,
    HTMLFormElement: Element,
    navigator: {},
    console: { error: () => {}, warn: (...args) => warnings.push(args), info: () => {} },
    WebSocket: Socket,
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
    oauthClient: ({ sessions }) => ({
      freshAccessToken: async () => {
        const accessToken = await token();
        await sessions.set("refreshedSession", accessToken);
        return accessToken;
      },
      signOut: async () => {
        signOuts += 1;
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
      invoke: async () => {
        socket.calls.invoke += 1;
        throw new Error("Action interrupted");
      },
      [Symbol.dispose]: () => {
        socket.disposed = true;
        socket.close();
      },
    }),
  });
  vm.runInContext(
    `${source}\nglobalThis.panel = {
    signedIn, connect, fact, record,
    state: () => ({ generation, lend, live }),
    attachForTest: (extra = {}) => debuggees.set(7, { attached: true, attaching: null, ...extra }),
  };`,
    context,
  );
  const api = context.panel;
  const session = { issuer: "https://iterate.iterate.com" };
  return {
    api,
    chrome,
    storage,
    session,
    plans,
    sockets,
    timers,
    elements,
    rules,
    groups,
    tabs,
    commands,
    appends,
    warnings,
    signedIn: () => api.signedIn(session),
    view: () => elements.get("connection"),
    signOuts: () => signOuts,
    token: (get) => {
      token = get;
    },
    random: (value) => {
      random = value;
    },
    nextWait: () => Math.min(...[...timers.values()].map((timer) => timer.at - now)),
    tick: async (ms) => {
      const until = now + ms;
      for (;;) {
        const entry = [...timers]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, timer] = entry;
        now = timer.at;
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
