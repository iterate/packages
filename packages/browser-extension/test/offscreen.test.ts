import assert from "node:assert/strict";
import { test } from "node:test";
import { RpcSession, RpcTarget } from "../dist/capnweb.js";
import { messageTransport } from "../public/rpc-transport.js";

void test("message transport rejects queued and future calls when its port ends", async () => {
  const sent = [];
  const transport = messageTransport(
    (message) => sent.push(message),
    () => {},
  );
  transport.send("one");
  assert.deepEqual(sent, [{ type: "rpc", message: "one" }]);
  transport.accept({ type: "rpc", message: "old reply" });
  transport.close(new Error("Worker ended"));
  await assert.rejects(transport.receive(), /Worker ended/);
  assert.throws(() => transport.send("late action"), /Worker ended/);
});
void test("invalid local wire data ends the bridge instead of becoming an RPC call", async () => {
  let aborts = 0;
  const transport = messageTransport(
    () => {},
    () => {
      aborts += 1;
    },
  );
  const waiting = transport.receive();
  transport.accept({ type: "rpc", message: { action: "click" } });
  await assert.rejects(waiting, /Invalid extension transport frame/);
  assert.equal(aborts, 1);
});
void test("only the current offscreen document can export the one API session", async () => {
  const h = await harness();
  const gate = deferred();
  h.createGate = gate.promise;
  const opening = h.api.openOffscreenApi(
    "wss://iterate.fixture.test/api",
    () => true,
    () => {},
  );
  await flush();
  const url = h.documents[0].documentUrl;
  for (const sender of [
    { id: "other", url },
    { id: "fixture", url: "https://web.test" },
    { id: "fixture", url: "chrome-extension://fixture/index.html" },
    { id: "fixture", url: url.replace(/transport=.*/, "transport=old-generation") },
  ]) {
    const [port] = ports(sender);
    h.api.acceptOffscreenPort(port);
    assert.equal(port.closed, true);
  }
  gate.resolve();
  const api = await opening;
  assert.equal(await api.echo("browser data"), "browser data");
  assert.deepEqual(h.opens, ["wss://iterate.fixture.test/api"]);
  await assert.rejects(
    h.api.openOffscreenApi(
      "wss://iterate.fixture.test/api",
      () => true,
      () => {},
    ),
    /already active/,
  );
  const [duplicate] = ports({ id: "fixture", url });
  h.api.acceptOffscreenPort(duplicate);
  assert.equal(duplicate.closed, true);
  await h.api.disconnectOffscreen();
  await assert.rejects(Promise.resolve(api.echo("late action")));
  assert.deepEqual(h.calls, ["browser data"]);
  assert.equal(h.documents.length, 0);
});
void test("a late document creation after sharing off cannot open a socket", async () => {
  const h = await harness();
  const gate = deferred();
  h.createGate = gate.promise;
  let current = true;
  const opening = h.api.openOffscreenApi(
    "wss://iterate.fixture.test/api",
    () => current,
    () => {},
  );
  await flush();
  current = false;
  const stopped = h.api.disconnectOffscreen();
  gate.resolve();
  assert.equal(await opening, null);
  await stopped;
  assert.deepEqual(h.opens, []);
  assert.equal(h.documents.length, 0);
});
void test("a socket failure and port loss report one failure and a new attempt uses a fresh document", async () => {
  const h = await harness();
  let failures = 0;
  const api = await h.api.openOffscreenApi(
    "wss://iterate.fixture.test/api",
    () => true,
    () => {
      failures += 1;
    },
  );
  const url = h.documents[0].documentUrl;
  h.peer.postMessage({ type: "socket-ended" });
  await flush();
  h.peer.disconnect();
  await flush();
  assert.equal(failures, 1);
  await assert.rejects(Promise.resolve(api.echo("no replay")));
  await h.api.disconnectOffscreen();
  const replacement = await h.api.openOffscreenApi(
    "wss://iterate.fixture.test/api",
    () => true,
    () => {},
  );
  assert.notEqual(h.documents[0].documentUrl, url);
  assert.equal(await replacement.echo("fresh action"), "fresh action");
  assert.deepEqual(h.calls, ["fresh action"]);
  await h.api.disconnectOffscreen();
});
void test("startup cleanup closes the orphaned offscreen document before any new API is opened", async () => {
  const h = await harness();
  h.documents.push({ documentUrl: "chrome-extension://fixture/offscreen.html?transport=old" });
  await h.api.disconnectOffscreen();
  assert.equal(h.documents.length, 0);
  assert.deepEqual(h.opens, []);
});

async function harness() {
  const h = {
    documents: [],
    opens: [],
    calls: [],
    createGate: undefined,
    peer: undefined,
    api: undefined,
  };
  class Api extends RpcTarget {
    echo(value) {
      h.calls.push(value);
      return value;
    }
  }
  class Controller extends RpcTarget {
    open(url) {
      h.opens.push(url);
      return new Api();
    }
  }
  globalThis.chrome = {
    runtime: {
      id: "fixture",
      getURL: (path) => `chrome-extension://fixture/${path}`,
      getContexts: async () => [...h.documents],
    },
    offscreen: {
      createDocument: async ({ url }) => {
        h.documents.push({ documentUrl: url });
        await h.createGate;
        const [port, peer] = ports({ id: "fixture", url });
        h.peer = peer;
        const wire = messageTransport(
          (message) => peer.postMessage(message),
          () => peer.disconnect(),
        );
        peer.onMessage.addListener((message) => wire.accept(message));
        peer.onDisconnect.addListener(() => wire.close(new Error("Worker ended")));
        new RpcSession(wire, new Controller()).getRemoteMain();
        h.api.acceptOffscreenPort(port);
      },
      closeDocument: async () => {
        h.documents.length = 0;
      },
    },
  };
  h.api = await import(
    new URL(`../dist/offscreen-client.js?fixture=${crypto.randomUUID()}`, import.meta.url).href
  );
  return h;
}
function ports(sender) {
  const make = () => ({
    sender,
    closed: false,
    onMessage: event(),
    onDisconnect: event(),
    postMessage: undefined,
    disconnect: undefined,
  });
  const a = make();
  const b = make();
  for (const [local, peer] of [
    [a, b],
    [b, a],
  ]) {
    local.postMessage = (message) => {
      if (local.closed) throw new Error("Port ended");
      queueMicrotask(() => {
        if (!peer.closed) peer.onMessage.emit(structuredClone(message));
      });
    };
    local.disconnect = () => {
      if (local.closed) return;
      local.closed = true;
      peer.closed = true;
      local.onDisconnect.emit();
      peer.onDisconnect.emit();
    };
  }
  return [a, b];
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
function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

void test("an explicit WebSocket policy close is a terminal authorization refusal", async () => {
  const h = await harness();
  let refusal;
  const api = await h.api.openOffscreenApi(
    "wss://iterate.fixture.test/api",
    () => true,
    (error) => {
      refusal = error;
    },
  );
  h.peer.postMessage({ type: "socket-ended", policyRefused: true });
  await flush();
  assert.equal(refusal.code, "UNAUTHORIZED");
  await assert.rejects(Promise.resolve(api.echo("not replayed")));
  await h.api.disconnectOffscreen();
});

void test("the normal token lifetime marker requests renewal and preserves real refusal precedence", async () => {
  for (const policyRefused of [false, true]) {
    const h = await harness();
    let failure;
    await h.api.openOffscreenApi(
      "wss://iterate.fixture.test/api",
      () => true,
      (error) => {
        failure = error;
      },
    );
    h.peer.postMessage({ type: "socket-ended", tokenExpired: true, policyRefused });
    await flush();
    assert.equal(failure.code, policyRefused ? "UNAUTHORIZED" : "TOKEN_EXPIRED");
    await h.api.disconnectOffscreen();
  }
});
