// Only this document uses runtime; its dedicated worker owns the socket and capnweb session.
const worker = new Worker("socket-worker.js", { type: "module" });
let port;
let ended = false;
function stop() {
  if (ended) return;
  ended = true;
  worker.terminate();
  port?.disconnect();
}
worker.onmessage = ({ data }) => {
  if (ended) return;
  if (data?.type === "ready" && !port) {
    port = chrome.runtime.connect({ name: "offscreen-transport" });
    port.onMessage.addListener((message) => worker.postMessage(message));
    port.onDisconnect.addListener(stop);
  } else {
    try {
      port?.postMessage(data);
    } catch {
      stop();
    }
  }
};
worker.onerror = stop;
window.addEventListener("pagehide", stop);
