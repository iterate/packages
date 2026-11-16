import { RpcSession } from "./capnweb.js";
import { messageTransport } from "./rpc-transport.js";

let active;
let jobs = Promise.resolve();
const serialize = (job) => (jobs = jobs.then(job, job));
const documentBase = () => chrome.runtime.getURL("offscreen.html");
async function closeDocument(url) {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (
    contexts.some((context) =>
      url ? context.documentUrl === url : context.documentUrl?.split("?")[0] === documentBase(),
    )
  )
    await chrome.offscreen.closeDocument();
}
export function disconnectOffscreen() {
  const previous = active;
  active = null;
  previous?.reject(new Error("The extension transport ended."));
  previous?.wire?.close(new Error("The extension transport ended."));
  previous?.remote?.[Symbol.dispose]();
  previous?.port?.disconnect();
  return serialize(() => closeDocument(previous?.url));
}
export async function openOffscreenApi(url, current, onFailure) {
  if (active) throw new Error("An extension transport is already active.");
  let resolve;
  let reject;
  const ready = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // A cancelled creation can settle before createDocument() returns.
  void ready.catch(() => {});
  const entry = {
    url: `${documentBase()}?transport=${crypto.randomUUID()}`,
    current,
    onFailure,
    resolve,
    reject,
    failed: false,
  };
  active = entry;
  return serialize(async () => {
    if (active !== entry || !current()) return null;
    await closeDocument();
    if (active !== entry || !current()) return null;
    await chrome.offscreen.createDocument({
      url: entry.url,
      reasons: ["WORKERS"],
      justification:
        "A dedicated worker in an extension document holds the authenticated lending socket while the service worker owns its state.",
    });
    if (active !== entry || !current()) {
      await closeDocument(entry.url);
      return null;
    }
    const remote = await ready;
    if (active !== entry || !current()) return null;
    return remote.open(url);
  });
}
export function acceptOffscreenPort(port) {
  const entry = active;
  if (
    !entry ||
    !entry.current() ||
    entry.port ||
    port.sender?.id !== chrome.runtime.id ||
    port.sender?.url !== entry.url
  ) {
    port.disconnect();
    return;
  }
  entry.port = port;
  const fail = (policyRefused = false, tokenExpired = false) => {
    if (active !== entry || entry.failed) return;
    entry.failed = true;
    const error =
      policyRefused === true
        ? Object.assign(new Error("The mind ended this browser's authorization. Sign in again."), {
            code: "UNAUTHORIZED",
          })
        : tokenExpired === true
          ? Object.assign(new Error("The API token expired. Refreshing the connection."), {
              code: "TOKEN_EXPIRED",
            })
          : new Error("The extension WebSocket transport disconnected.");
    entry.reject(error);
    entry.wire.close(error);
    entry.onFailure(error);
  };
  entry.wire = messageTransport(
    (message) => port.postMessage(message),
    () => {
      port.disconnect();
      fail();
    },
  );
  port.onMessage.addListener((message) => {
    if (message?.type === "socket-ended")
      fail(message.policyRefused === true, message.tokenExpired === true);
    else entry.wire.accept(message);
  });
  port.onDisconnect.addListener(() => fail());
  const session = new RpcSession(entry.wire);
  entry.remote = session.getRemoteMain();
  entry.resolve(entry.remote);
}
