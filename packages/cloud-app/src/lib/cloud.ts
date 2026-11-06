// The Cloud's API (@iterate-com/cloud/api), from this page: one WebSocket to `/rpc` under the Cloud's base path on its
// origin, dialled again when it breaks (a laptop sleeps, the network drops, the edge restarts),
// after a wait that doubles from 1 s to 8 s. Components read the current session through
// `useCloudApi`, so their handles, and the live state they follow, move to the new socket by
// themselves (docs/frontend-development.md, "One socket, invisible reconnect"). The platform's
// session cookie rides the handshake and the edge stamps who it names; the config worker refuses a
// handshake with nobody signed in (401) or from another origin (403).
import { useSyncExternalStore } from "react";
import { newHttpBatchRpcSession, newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { CloudApi } from "@iterate-com/cloud/api";
import { documentBasePath } from "@iterate-com/ui/apps/base-path";

let session: RpcStub<CloudApi> | null = null;
let redialMs = 1_000;
const listeners = new Set<() => void>();

/** The tab's current session, dialled on first use. */
export function cloudApi(): RpcStub<CloudApi> {
  if (session) return session;
  const url = new URL(`${documentBasePath()}/rpc`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const opened = newWebSocketRpcSession<CloudApi>(url.href);
  // a session that answers is a good one: the next break waits from the start again
  void opened.whoami().then(
    () => (redialMs = 1_000),
    () => {},
  );
  opened.onRpcBroken(() => {
    if (session !== opened) return;
    setTimeout(() => {
      // HTTP says whether the person is still signed in (as iterate/app's client does): one who is
      // not goes to the sign-in, never a socket refused every 8 s behind "Reconnecting…"
      void signedInPerson().then(
        (person) => {
          if (!person)
            return location.assign(
              `${documentBasePath()}/?${new URLSearchParams({ next: `${location.pathname}${location.search}` })}`,
            );
          session = null;
          for (const listener of listeners) listener();
        },
        () => {
          session = null;
          for (const listener of listeners) listener();
        },
      );
    }, redialMs);
    redialMs = Math.min(redialMs * 2, 8_000);
  });
  session = opened;
  return opened;
}

/** The current session, for a component: a new one after each reconnect. */
export function useCloudApi() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    cloudApi,
    cloudApi,
  );
}

/** Who the platform says is signed in, or null when nobody is: one HTTP batch, which the Cloud
 *  answers 401 for a visitor signed out (capnweb's batch client throws `RPC request failed: 401`). */
export async function signedInPerson() {
  try {
    // oxlint-disable-next-line iterate/no-capnweb-http-batch -- one bounded call whose answer may be a 401, which a WebSocket handshake cannot say
    return await newHttpBatchRpcSession<CloudApi>(`${documentBasePath()}/rpc`).whoami();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("RPC request failed: 401")) return null;
    throw error;
  }
}
