import { mindIssuerOf } from "./address.js";
const app = document.getElementById("app");
const escape = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
let port;
let serial = 0;
let reconnectTimer;
let reconnects = 0;
const pending = new Map();
let latest;
function connect() {
  port = chrome.runtime.connect({ name: "panel" });
  port.onMessage.addListener((message) => {
    if (message.state && typeof message.state.phase === "string") {
      reconnects = 0;
      latest = message.state;
      render(latest);
    }
    if (message.id) {
      const call = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) call?.reject(new Error(message.error));
      else call?.resolve(message.state);
    }
  });
  port.onDisconnect.addListener(() => {
    for (const call of pending.values())
      call.reject(new Error("The worker connection ended. The command was not replayed."));
    pending.clear();
    app.innerHTML =
      '<section class="card"><h2>Checking sharing status…</h2><p>The worker connection ended. Waiting for its current state.</p></section>';
    if (reconnects < 5) {
      reconnects += 1;
      reconnectTimer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** (reconnects - 1)));
    } else {
      app.innerHTML =
        '<section class="card"><h2>Sharing status unavailable</h2><p>Close and reopen this panel to check the worker again.</p></section>';
    }
  });
  void request({ action: "state" }).catch(showError);
}
function request(command) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    try {
      port.postMessage({ id, ...command });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}
function showError(error) {
  const alert = document.createElement("p");
  alert.setAttribute("role", "alert");
  alert.className = "error";
  alert.textContent = error.message;
  app.append(alert);
}
function action(id, command) {
  document
    .getElementById(id)
    ?.addEventListener("click", () => void request(command).catch(showError));
}
function render(state) {
  const focus = document.activeElement;
  // Tab events may update the state while the person types a browser name.
  if (focus?.id === "browser-name" && latest?.phase === "connected") return;
  app.innerHTML = `<header class="header"><div class="brand"><img src="icon-32.png" alt="" />Iterate</div><div class="row"><span class="badge">v${escape(state.version)}</span>${state.signedIn ? '<button id="logout" class="btn btn-ghost btn-sm">Sign out</button>' : ""}</div></header>`;
  if (!state.signedIn) {
    app.innerHTML += `<section class="card"><h2>Sign in to a mind</h2><p class="muted">Then turn sharing on. The mind can drive only tabs in its tab group.</p><label class="field">Mind<input id="mind" class="input" value="${escape(state.mind)}" placeholder="example.com" /></label><button id="login" class="btn btn-primary">Sign in with Iterate</button></section>`;
    document.getElementById("login").onclick = async () => {
      try {
        const mind = document.getElementById("mind").value;
        const issuer = mindIssuerOf(mind);
        const granted = await chrome.permissions.request({
          origins: [`${issuer}/*`, `${issuer.replace(/^https/, "wss")}/*`],
        });
        if (!granted) throw new Error("Allow access to the mind's host to sign in.");
        await request({ action: "login", mind });
      } catch (error) {
        showError(error);
      }
    };
    return;
  }
  const connected = state.phase === "connected";
  const title = connected
    ? "Connected · sharing on"
    : state.phase === "off"
      ? "Sharing off"
      : state.phase === "waiting"
        ? `Reconnecting, try ${state.retries}`
        : state.phase === "displaced"
          ? "No longer lent"
          : state.phase === "exhausted"
            ? "Not lent · Lend again"
            : state.phase === "failed"
              ? "Not connected"
              : state.retries
                ? `Reconnecting, try ${state.retries}`
                : "Connecting…";
  app.innerHTML += `<section id="connection" class="card"><div class="row"><span class="dot ${connected ? "ok" : ["failed", "displaced", "exhausted"].includes(state.phase) ? "bad" : state.sharing ? "wait" : ""}"></span><h2 class="grow">${title}</h2></div><p class="muted">${connected ? "Sharing stays on when you close this panel." : "This Chrome is not lent while disconnected."} After a Chrome restart, open this panel and turn sharing on again.</p>${state.error ? `<p class="error">${escape(state.error)}</p>` : ""}${state.retryAt ? `<p class="muted">Try ${state.retries}, next check ${escape(new Date(state.retryAt).toLocaleTimeString())}.</p>` : ""}<div class="actions">${state.sharing ? '<button id="stop" class="btn btn-outline">Turn sharing off</button>' : '<button id="share" class="btn btn-primary">Share this browser</button>'}${["failed", "displaced", "exhausted"].includes(state.phase) ? `<button id="share" class="btn btn-primary">${["displaced", "exhausted"].includes(state.phase) ? "Lend again" : "Retry"}</button>` : ""}</div></section>`;
  const controls = () => {
    action("logout", { action: "logout" });
    action("share", { action: "share" });
    action("stop", { action: "stop" });
  };
  if (!connected) {
    controls();
    return;
  }
  const members = state.members || [];
  app.innerHTML += `<section class="card"><dl class="facts"><dt>Mind</dt><dd>${escape(state.address)}</dd><dt>Signed in as</dt><dd>${escape(state.person)}</dd><dt>Lent as</dt><dd><code>${escape(state.name)}</code></dd></dl><details><summary>Rename this browser</summary><form id="rename-form" class="row rename"><input id="browser-name" class="input grow" value="${escape(state.browserName)}" aria-label="Browser name" /><button class="btn btn-outline">Save</button></form></details></section><section class="card"><h2>Tab group <code>${escape(state.address)}</code></h2><p class="muted">Drag a tab into this group to lend it. Drag it out or click Remove to take it back.</p><ul id="tabs" class="tabs">${members.length ? members.map((tab) => `<li><div class="grow"><div class="title truncate">${escape(tab.title || tab.url)}</div><div class="muted mono truncate">${escape(tab.url)}</div></div>${tab.attached ? `<span class="badge">${escape(tab.activity || "in use")}</span>` : ""}<button class="btn btn-ghost btn-sm" data-remove="${tab.tabId}">Remove</button></li>`).join("") : '<li class="empty">No tabs in the group yet.</li>'}</ul><div class="actions"><button id="add" class="btn btn-primary">Add this tab</button><button id="prove" class="btn btn-outline">Test: open a page</button></div><p id="proof-result" class="muted">${escape(state.notice)}</p></section><section class="card"><h2>Tell an agent</h2><button id="copy" class="btn btn-outline">Copy instructions for an agent</button><details><summary>Show the instructions</summary><pre id="instructions"></pre></details></section>`;
  controls();
  document.getElementById("instructions").textContent = state.instructions;
  document.getElementById("copy").onclick = () =>
    void copyText(state.instructions).catch(showError);
  document.getElementById("rename-form").onsubmit = (event) => {
    event.preventDefault();
    void request({ action: "rename", name: document.getElementById("browser-name").value }).catch(
      showError,
    );
  };
  action("add", { action: "add" });
  action("prove", { action: "prove" });
  document.getElementById("tabs").onclick = (event) => {
    const button = event.target.closest("[data-remove]");
    if (button)
      void request({ action: "remove", tabId: Number(button.dataset.remove) }).catch(showError);
  };
}
window.addEventListener("pagehide", () => clearTimeout(reconnectTimer));
connect();

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}
