import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

void test("successful panel reconnections reset the consecutive failure budget", async () => {
  const ui = await panel();
  for (let i = 0; i < 8; i += 1) {
    ui.ports.at(-1).onMessage.emit({ state: { phase: "off", signedIn: false, version: "0.8.2" } });
    assert.match(ui.app.innerHTML, /Sign in to a mind/);
    ui.ports.at(-1).onDisconnect.emit();
    ui.tick();
  }
  assert.equal(ui.ports.length, 9);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.ports.at(-1).messages[0].action, "state");
});
void test("failed panel reconnections stop after five attempts without replaying commands", async () => {
  const ui = await panel();
  for (let i = 0; i < 6; i += 1) {
    ui.ports.at(-1).onDisconnect.emit();
    ui.tick();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(ui.ports.length, 6);
  assert.equal(ui.timers.size, 0);
  assert.match(ui.app.innerHTML, /Sharing status unavailable/);
  assert.ok(
    ui.ports.every((port) => port.messages.length === 1 && port.messages[0].action === "state"),
  );
});
async function panel() {
  const ports = [];
  const timers = new Map();
  let serial = 0;
  const app = { innerHTML: "", append() {} };
  const elements = new Map([
    ["app", app],
    ["login", {}],
  ]);
  const context = vm.createContext({
    chrome: {
      runtime: {
        connect() {
          const port = {
            onMessage: event(),
            onDisconnect: event(),
            messages: [],
            postMessage(message) {
              this.messages.push(message);
            },
          };
          ports.push(port);
          return port;
        },
      },
    },
    document: {
      getElementById: (id) => elements.get(id),
      activeElement: null,
      createElement: () => ({ setAttribute() {} }),
    },
    window: { addEventListener() {} },
    setTimeout: (callback) => {
      timers.set(++serial, callback);
      return serial;
    },
    clearTimeout: (id) => timers.delete(id),
    Date,
    Error,
    Map,
    String,
    Promise,
    console,
  });
  const module = new vm.SourceTextModule(
    readFileSync(new URL("../public/panel.js", import.meta.url), "utf8"),
    { context },
  );
  await module.link(
    async () =>
      new vm.SourceTextModule(
        readFileSync(new URL("../public/address.js", import.meta.url), "utf8"),
        { context },
      ),
  );
  await module.evaluate();
  return {
    ports,
    timers,
    app,
    tick() {
      const entry = timers.entries().next().value;
      if (entry) {
        timers.delete(entry[0]);
        entry[1]();
      }
    },
  };
}
function event() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    emit: (...args) => {
      for (const listener of listeners) listener(...args);
    },
  };
}

void test("panel shows continued recovery try count then an explicit Lend again state", async () => {
  const ui = await panel();
  ui.ports[0].onMessage.emit({
    state: {
      phase: "waiting",
      signedIn: true,
      sharing: true,
      version: "0.8.2",
      retries: 23,
      retryAt: 1_800_000,
    },
  });
  assert.match(ui.app.innerHTML, /Reconnecting, try 23/);
  assert.doesNotMatch(ui.app.innerHTML, /of 5/);
  ui.ports[0].onMessage.emit({
    state: {
      phase: "exhausted",
      signedIn: true,
      sharing: true,
      version: "0.8.2",
      retries: 40,
      retryAt: null,
      error: "Automatic lending recovery ended after 30 minutes.",
    },
  });
  assert.match(ui.app.innerHTML, /Not lent · Lend again/);
  assert.match(ui.app.innerHTML, />Lend again<\/button>/);
});
