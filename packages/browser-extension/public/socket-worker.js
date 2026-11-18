import { RpcSession, RpcTarget, newWebSocketRpcSession } from "./capnweb.js";
import { messageTransport } from "./rpc-transport.js";

let socket;
let api;
let ended = false;
let disposed = false;
let owner;
function dispose() {
  if (disposed) return;
  disposed = true;
  api?.[Symbol.dispose]();
  api = null;
  socket?.close();
  owner?.[Symbol.dispose]();
  close();
}
function failed(event) {
  if (ended) return;
  ended = true;
  // This API close reason marks the access token's normal lifetime, not a refused refresh.
  const tokenExpired =
    event?.code === 1008 &&
    event.reason === "the sign-in for this session ended: authenticate again";
  postMessage({
    type: "socket-ended",
    tokenExpired,
    policyRefused: event?.code === 1008 && !tokenExpired,
  });
}
class SocketController extends RpcTarget {
  open(address) {
    const url = new URL(address);
    if (socket || url.protocol !== "wss:" || url.pathname !== "/api" || url.search || url.hash)
      throw new Error("Invalid or duplicate lending socket.");
    socket = new WebSocket(url);
    socket.addEventListener("close", failed);
    socket.addEventListener("error", failed);
    api = newWebSocketRpcSession(socket);
    // The root of a session at a mind's /api answers a session to `authenticate()`, and the
    // session's `mind` is the mind (iterate/api `ControlPlaneApi`). With no token in the call,
    // the credential is the bearer on this socket's own request (lend.js sets it). Nothing is
    // awaited: capnweb sends the first calls with it, and a bearer that the mind refuses fails
    // the first call with the code UNAUTHENTICATED. `dup()` makes a stub of the pipelined mind,
    // and the session's promise is let go, so that the stub is the one hold on the mind.
    // Returning a stub transfers it; the socket session's root stays owned here.
    const session = api.authenticate();
    try {
      return session.mind.dup();
    } finally {
      session[Symbol.dispose]();
    }
  }
}
const transport = messageTransport((message) => postMessage(message), dispose);
const session = new RpcSession(transport, new SocketController());
// Hold the bridge's root stub until its owner ends the runtime port.
owner = session.getRemoteMain();
self.onmessage = ({ data }) => transport.accept(data);
postMessage({ type: "ready" });
