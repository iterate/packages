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
    event?.code === 1008 && event.reason === "the sign-in for this session ended: sign in again";
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
    // Returning a stub transfers it; keep the socket session's root owned here.
    return api.dup();
  }
}
const transport = messageTransport((message) => postMessage(message), dispose);
const session = new RpcSession(transport, new SocketController());
// Hold the bridge's root stub until its owner ends the runtime port.
owner = session.getRemoteMain();
self.onmessage = ({ data }) => transport.accept(data);
postMessage({ type: "ready" });
