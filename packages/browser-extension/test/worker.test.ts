import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

void test("only the extension panel controls one worker-owned controller; closing it only unsubscribes", async () => {
  const onConnect = event();
  const onStartup = event();
  const onInstalled = event();
  const onAlarm = event();
  const commands = [];
  const transportPorts = [];
  const settings = [];
  const subscribers = new Set();
  let wakes = 0;
  const context = vm.createContext({
    console,
    chrome: {
      runtime: {
        id: "fixture",
        getURL: (path) => `chrome-extension://fixture/${path}`,
        onConnect,
        onStartup,
        onInstalled,
      },
      alarms: { onAlarm },
      sidePanel: { setPanelBehavior: async () => {} },
    },
  });
  const controller = {
    ready: Promise.resolve(),
    snapshot: () => ({ phase: "off" }),
    command: async (message) => {
      commands.push(message);
      return { phase: "off" };
    },
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    wake: async () => {
      wakes += 1;
    },
  };
  const module = new vm.SourceTextModule(
    readFileSync(new URL("../public/background.js", import.meta.url), "utf8"),
    { context },
  );
  await module.link(async (specifier) =>
    specifier === "./offscreen-client.js"
      ? new vm.SyntheticModule(
          ["acceptOffscreenPort"],
          function () {
            this.setExport("acceptOffscreenPort", (port) => transportPorts.push(port));
          },
          { context },
        )
      : new vm.SyntheticModule(
          ["createLending"],
          function () {
            this.setExport("createLending", (setting) => {
              settings.push(setting);
              return controller;
            });
          },
          { context },
        ),
  );
  await module.evaluate();
  assert.deepEqual(settings, [false]);
  const transport = port({ id: "fixture", url: "chrome-extension://fixture/offscreen.html" });
  transport.name = "offscreen-transport";
  onConnect.emit(transport);
  assert.deepEqual(transportPorts, [transport]);
  assert.equal(subscribers.size, 0);
  for (const sender of [
    { id: "other", url: "chrome-extension://fixture/index.html" },
    { id: "fixture", url: "https://page.test" },
    { id: "fixture", url: "chrome-extension://fixture/other.html" },
  ]) {
    const rejected = port(sender);
    onConnect.emit(rejected);
    assert.equal(rejected.disconnected, true);
  }
  const panel = port({ id: "fixture", url: "chrome-extension://fixture/index.html" });
  const other = port({ id: "fixture", url: "chrome-extension://fixture/index.html" });
  onConnect.emit(panel);
  onConnect.emit(other);
  assert.equal(subscribers.size, 2);
  panel.onMessage.emit({ id: 1, action: "state" });
  panel.onMessage.emit({ id: "invalid", action: "share" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(commands, [{ id: 1, action: "state" }]);
  assert.equal(panel.messages[0].state.phase, "off");
  panel.disconnect();
  assert.equal(subscribers.size, 1);
  assert.equal(commands.length, 1);
  onStartup.emit();
  onInstalled.emit();
  onAlarm.emit({ name: "unrelated" });
  onAlarm.emit({ name: "iterate-lending" });
  assert.equal(wakes, 1);
  assert.equal(settings.length, 1);
  other.disconnect();
  assert.equal(subscribers.size, 0);
});

function event() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    emit: (...args) => {
      for (const listener of listeners) listener(...args);
    },
  };
}
function port(sender) {
  return {
    name: "panel",
    sender,
    onMessage: event(),
    onDisconnect: event(),
    disconnected: false,
    messages: [],
    postMessage(message) {
      this.messages.push(message);
    },
    disconnect() {
      this.disconnected = true;
      this.onDisconnect.emit();
    },
  };
}
