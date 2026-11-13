// member-itx.ts — THE MEMBER'S `itx` ON A MIND'S OWN HOST, for a no-build app's page: one WebSocket
// to this host's `/itx` (the app answers it with `host.auth.itx(request)`), a capnweb session whose
// root is the mind's itx, as the member the platform signed in on this host. The platform ends
// the session when the sign-in ends, and a reload signs in again. Three closes in a minute stop
// the reloads, so a page that cannot connect says so and does not reload for ever.
import { newWebSocketRpcSession } from "capnweb";
import type { AuthenticatedApp } from "iterate/app";

const CLOSES = "itx-closes";

/** Opens the socket, and reloads the page when it closes. `root` is where the page says
 *  "Disconnected" after the third close in a minute. */
export function memberItx(root = document.getElementById("root")): AuthenticatedApp["itx"] {
  const socket = new WebSocket(new URL("/itx", location.href.replace(/^http/, "ws")));
  const itx: AuthenticatedApp["itx"] = newWebSocketRpcSession(socket);
  socket.addEventListener("close", () => {
    if (reloadAfterClose(sessionStorage, Date.now())) setTimeout(() => location.reload(), 1000);
    else if (root) root.textContent = "Disconnected. Reload the page to connect.";
  });
  return itx;
}

/** Whether the page reloads after a close at `now`: yes unless three closes came in the last
 *  minute. The closes are kept in `storage`, which lasts across the reloads of one tab. */
export function reloadAfterClose(storage: Pick<Storage, "getItem" | "setItem">, now: number) {
  let closes: number[] = [];
  try {
    const kept: unknown = JSON.parse(storage.getItem(CLOSES) || "[]");
    closes = (Array.isArray(kept) ? kept : []).filter(
      (at): at is number => typeof at === "number" && now - at < 60_000,
    );
    storage.setItem(CLOSES, JSON.stringify([...closes, now]));
  } catch {
    // no storage: one reload is still right
  }
  return closes.length < 3;
}

/** The mind of a host of it: the mind is its domain, and each app's host is one label under it
 *  (`dash.example.com` is of `example.com`). */
export function mindOfHost(hostname = location.hostname) {
  return hostname.split(".").slice(1).join(".") || hostname;
}
