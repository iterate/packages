import { createLending } from "./lend.js";
import { acceptOffscreenPort } from "./offscreen-client.js";

// Startup sharing needs a separate user decision. Session storage survives worker suspension,
// but Chrome clears it on a browser restart or extension reload.
const SHARE_ON_BROWSER_START = false;
const lending = createLending(SHARE_ON_BROWSER_START);

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "iterate-lending") void lending.wake().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => void lending.ready.catch(console.error));
chrome.runtime.onInstalled.addListener(() => void lending.ready.catch(console.error));
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "offscreen-transport") {
    acceptOffscreenPort(port);
    return;
  }
  // No web page or other extension can use the panel's control channel.
  if (
    port.name !== "panel" ||
    port.sender?.id !== chrome.runtime.id ||
    port.sender?.url !== chrome.runtime.getURL("index.html")
  ) {
    port.disconnect();
    return;
  }
  const send = (message) => {
    try {
      port.postMessage(message);
    } catch {
      /* The panel closed. */
    }
  };
  const unsubscribe = lending.subscribe((state) => send({ state }));
  port.onDisconnect.addListener(unsubscribe);
  void lending.ready.then(
    () => send({ state: lending.snapshot() }),
    (error) => send({ error: error.message }),
  );
  port.onMessage.addListener((message) => {
    if (!Number.isSafeInteger(message?.id) || message.id < 1) return;
    void lending.command(message).then(
      (state) => send({ id: message.id, state }),
      (error) => send({ id: message.id, error: error.message }),
    );
  });
});
void lending.ready.catch(console.error);
