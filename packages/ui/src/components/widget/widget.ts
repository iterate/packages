// A WIDGET: a small HTML page that an agent's script shows a person, as one fact on the agent's log
// (`agent-ui/widget-shown`). The chat draws it in a sandboxed frame in the feed, where the agent's
// words would be (widget-frame.tsx). The page and the frame talk the MCP Apps messages: JSON-RPC 2.0
// over `postMessage` (the extension `io.modelcontextprotocol/ui`, version 2026-01-26). So the same
// HTML runs as a `ui://` resource in Claude or ChatGPT. The plan: tasks/dynamic-mcp-ui.md (iterate/private#1360).
//
// This module has no import and no React, so a page that cannot load the kit yet (the pet shop's
// view 5) can take a copy of it with its types stripped. It holds:
//   - the facts, and the fold of the newest widget for each key (`widgetFold`);
//   - the frame's document: the policy, the theme, the data, the client script (`widgetDocument`);
//   - the host's half of the bridge, as a pure answer to one message (`widgetAnswer`).
//
// TWO KINDS OF WIDGET, ONE FRAME. Our agent's own widget is a fragment or a document, and the kit
// adds its client script. ANOTHER SERVER'S MCP APP (`app` in the fact) is that server's `ui://`
// resource as it served it: the kit adds no script, only the policy, first. Its view calls its
// own server's tools (`tools/call`), which the page makes through the agent's own context.

const T = "events.iterate.com/";
/** The facts. A script appends `widget-shown`; `widget-updated` gives a shown widget new data. */
export const WIDGET_FACT = {
  shown: `${T}agent-ui/widget-shown`,
  updated: `${T}agent-ui/widget-updated`,
  /** An app's view called a tool of its server: `{ key, server, tool, ok, ms, error? }`. */
  toolCalled: `${T}agent-ui/widget-tool-called`,
  /** A view's words for the agent's next turn: `{ key, server?, content }`. */
  context: `${T}agent-ui/widget-context`,
} as const;
/** The version of the MCP Apps messages that the frame and the host speak. */
const WIDGET_PROTOCOL = "2026-01-26";
/** A widget's HTML is at most this many characters. Past it, the row shows the widget's `text`. */
export const WIDGET_HTML_MAX = 256 * 1024;
/** Another server's MCP App document is at most this many characters: such documents are 0.1 to
 *  5 MB as a rule, and one event holds up to 8 million characters. */
export const WIDGET_APP_HTML_MAX = 4 * 1024 * 1024;
/** A frame is at most this tall; a taller widget scrolls inside it. */
export const WIDGET_HEIGHT_MAX = 2000;
/** A frame's height before its widget reports one, when the fact names none. */
export const WIDGET_HEIGHT_FIRST = 120;

/** One widget as the frame draws it. */
export type Widget = {
  /** Its name for updates: the fact's `key` (or `id`), else `widget-<offset>`. */
  key: string;
  /** The widget in words: a channel with no frame and a screen reader read this. */
  text: string;
  html: string;
  data?: unknown;
  title?: string;
  /** The height to keep free before the widget reports its own. */
  height?: number;
  /** The offset of the newest `widget-shown` for this key. */
  offset: number;
  /** The origins the widget may reach, in the MCP Apps spec's names (`_meta.ui.csp`). */
  csp?: WidgetCsp;
  /** Another server's MCP App: the call that made it. None: our agent's own widget. */
  app?: WidgetApp;
};

/** The MCP Apps spec's `_meta.ui.csp`: origins, or host patterns like `https://*.example.com`. */
export type WidgetCsp = {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
};

/** The tool call that made another server's MCP App, and the resource it read. */
export type WidgetApp = {
  /** The MCP endpoint, an https URL. */
  server: string;
  /** Headers for the endpoint: `getSecret("/secrets/…")` placeholders, never a secret. */
  headers?: Record<string, string>;
  tool: string;
  resourceUri: string;
  input: Record<string, unknown>;
  result: {
    content?: unknown[];
    structuredContent?: unknown;
    isError?: boolean;
    _meta?: Record<string, unknown>;
  };
  permissions?: Record<string, unknown>;
  prefersBorder?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const words = (value: unknown, most: number) =>
  typeof value === "string" && value.trim() !== "" ? value.slice(0, most) : undefined;

const strings = (value: unknown, most: number) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, most)
    : undefined;
const textRecord = (value: unknown) =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : undefined;

/** A fact's `csp`, each list kept to its strings (each one is checked when the policy is built). */
function cspOf(value: unknown): WidgetCsp | undefined {
  if (!isRecord(value)) return undefined;
  const csp: WidgetCsp = {};
  for (const name of [
    "connectDomains",
    "resourceDomains",
    "frameDomains",
    "baseUriDomains",
  ] as const) {
    const list = strings(value[name], 50);
    if (list?.length) csp[name] = list;
  }
  return Object.keys(csp).length ? csp : undefined;
}

/** A fact's `app`, or none when it names no https server, tool and resource: a row must say whose
 *  UI it is, and a call must know where it goes. */
function appOf(value: unknown): WidgetApp | undefined {
  if (!isRecord(value)) return undefined;
  const server = words(value.server, 2000);
  const tool = words(value.tool, 200);
  const resourceUri = words(value.resourceUri, 2000);
  if (!server || !tool || !resourceUri || !isHttpsUrl(server)) return undefined;
  const result = isRecord(value.result) ? value.result : {};
  return {
    server,
    headers: textRecord(value.headers),
    tool,
    resourceUri,
    input: isRecord(value.input) ? value.input : {},
    result: {
      content: Array.isArray(result.content) ? result.content : undefined,
      structuredContent: result.structuredContent,
      isError: result.isError === true || undefined,
      _meta: isRecord(result._meta) ? result._meta : undefined,
    },
    permissions: isRecord(value.permissions) ? value.permissions : undefined,
    prefersBorder: typeof value.prefersBorder === "boolean" ? value.prefersBorder : undefined,
  };
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** The host name of an app's server, for its row's header: whose UI it is. */
export const widgetServerHost = (app: WidgetApp) => new URL(app.server).host;

/** The most characters of HTML the frame draws for this widget. */
export const widgetHtmlMax = (widget: Pick<Widget, "app">) =>
  widget.app ? WIDGET_APP_HTML_MAX : WIDGET_HTML_MAX;

/** The key a widget fact names: `key`, or `id` (the pet shop's word), else none. */
function keyOf(payload: Record<string, unknown>) {
  return words(payload.key, 200) ?? words(payload.id, 200);
}

/** The widget that one `widget-shown` fact shows, or null for a payload that shows none. */
export function widgetOf(payload: unknown, offset: number): Widget | null {
  if (!isRecord(payload) || typeof payload.html !== "string") return null;
  const app = appOf(payload.app);
  // a fact that says it is another server's app, and names no server, shows nothing
  if (payload.app !== undefined && !app) return null;
  const title = words(payload.title, 200);
  const height =
    typeof payload.height === "number" && payload.height > 0 ? payload.height : undefined;
  return {
    key: keyOf(payload) ?? `widget-${String(offset)}`,
    text: words(payload.text, 4000) ?? title ?? "A widget",
    html: payload.html,
    data: payload.data,
    title,
    height: height && Math.min(height, WIDGET_HEIGHT_MAX),
    offset,
    csp: cspOf(payload.csp),
    app,
  };
}

/** Each key's newest widget, and the offset of the first fact that showed it: the row stays there. */
export type WidgetFold = Map<string, { first: number; widget: Widget }>;

/** THE NEWEST WIDGET FOR EACH KEY, over the facts the page holds. A later `widget-shown` with the
 *  same key replaces the widget; `widget-updated { key, data, text? }` gives it new data. The row
 *  stays where the key was first shown. A pure fold: the same facts give the same map. */
export function widgetFold(facts: readonly unknown[], held: WidgetFold = new Map()): WidgetFold {
  const fold: WidgetFold = new Map(held);
  for (const fact of facts as { type?: unknown; offset?: unknown; payload?: unknown }[]) {
    if (!isRecord(fact) || typeof fact.offset !== "number") continue;
    if (fact.type === WIDGET_FACT.shown) {
      const widget = widgetOf(fact.payload, fact.offset);
      if (!widget) continue;
      fold.set(widget.key, { first: fold.get(widget.key)?.first ?? fact.offset, widget });
    } else if (fact.type === WIDGET_FACT.updated && isRecord(fact.payload)) {
      const key = keyOf(fact.payload);
      const kept = key ? fold.get(key) : undefined;
      if (!kept || !key) continue;
      const text = words(fact.payload.text, 4000);
      fold.set(key, {
        ...kept,
        widget: { ...kept.widget, data: fact.payload.data, text: text || kept.widget.text },
      });
    }
  }
  return fold;
}

// ── THE FRAME'S DOCUMENT ────────────────────────────────────────────────────────────────────────

/** The frame's policy: inline script and style, images and fonts from data, and no network. */
export const WIDGET_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** One entry of a `csp` list that the policy takes: an https or wss origin, or one with a
 *  `*.` subdomain pattern (`https://*.example.com`), with an optional port; http and ws only for
 *  the computer's own host. No quote, semicolon, space, path or bare `*` can pass: each would
 *  change the policy's meaning, not widen it by one origin. */
const CSP_SOURCE =
  /^(?:(?:https|wss):\/\/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*|(?:http|ws):\/\/(?:localhost|127\.0\.0\.1))(?::\d{1,5})?$/i;

/** The entries of a `csp` list that the policy takes, and the ones it refused. */
export function widgetCspSources(list: readonly string[] | undefined) {
  const taken: string[] = [];
  const refused: string[] = [];
  for (const entry of list || []) (CSP_SOURCE.test(entry) ? taken : refused).push(entry);
  return { taken, refused };
}

/** THE FRAME'S POLICY FOR A WIDGET: `WIDGET_POLICY` widened by exactly the declared origins, by
 *  the spec's mapping. `connectDomains` → `connect-src`; `resourceDomains` → `script-src`,
 *  `style-src`, `img-src`, `font-src` and `media-src`; `frameDomains` → `frame-src`;
 *  `baseUriDomains` → `base-uri`. An entry that is no origin or host pattern is left out. */
export function widgetPolicy(csp: WidgetCsp | undefined): string {
  if (!csp) return WIDGET_POLICY;
  const connect = widgetCspSources(csp.connectDomains).taken;
  const resource = widgetCspSources(csp.resourceDomains).taken;
  const frame = widgetCspSources(csp.frameDomains).taken;
  const baseUri = widgetCspSources(csp.baseUriDomains).taken;
  const widened = (name: string, base: string, more: string[]) => [name, base, ...more].join(" ");
  return [
    "default-src 'none'",
    widened("script-src", "'unsafe-inline'", resource),
    widened("style-src", "'unsafe-inline'", resource),
    widened("img-src", "data: blob:", resource),
    widened("media-src", "data: blob:", resource),
    widened("font-src", "data:", resource),
    connect.length ? `connect-src ${connect.join(" ")}` : "connect-src 'none'",
    ...(frame.length ? [`frame-src ${frame.join(" ")}`] : []),
    "object-src 'none'",
    baseUri.length ? `base-uri ${baseUri.join(" ")}` : "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** The theme the host gives a widget: `light` or `dark`, and the spec's CSS variables. */
export type WidgetTheme = { theme: "light" | "dark"; variables: Record<string, string> };

const LINE_SEPARATORS = new RegExp("[\\u2028\\u2029]", "g");
/** JSON that no `</` in it can end the element that holds it. */
const inlineJson = (value: unknown) =>
  JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATORS, (char) => (char === "\u2028" ? "\\u2028" : "\\u2029"));
/** CSS custom properties, each name and value checked so no `}` or `<` ends the rule. */
const cssVariables = (variables: Record<string, string>) =>
  Object.entries(variables)
    .filter(([name, value]) => /^--[a-z0-9-]+$/i.test(name) && !/[;{}<>]/.test(value))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");

/** The style every widget starts with: plain HTML looks like the page around it. */
const BASE_STYLE =
  "html{height:auto}body{margin:0;padding:12px;font:14px/1.5 var(--font-sans,system-ui,sans-serif);color:var(--color-text-primary,CanvasText);background:transparent;overflow-wrap:anywhere}" +
  "button{font:inherit;color:inherit;background:var(--color-background-secondary,ButtonFace);border:1px solid var(--color-border-primary,ButtonBorder);border-radius:var(--border-radius-md,8px);padding:6px 12px;cursor:pointer}" +
  "table{border-collapse:collapse}td,th{border:1px solid var(--color-border-primary,GrayText);padding:4px 8px;text-align:left}";

/** THE CLIENT: the script in each widget. It gives the HTML one global, `ui`:
 *    ui.data            the widget's data, now
 *    ui.onData(fn)      fn(data) now and at each update; answers a function that stops it
 *    ui.send(text)      words to the agent, as the person (the host wants a press)
 *    ui.open(url)       an https link in a new tab (the host wants a press)
 *    ui.theme           "light" | "dark"
 *  It does the handshake (`ui/initialize`, then `ui/notifications/initialized`), reports its height
 *  (`ui/notifications/size-changed`) and takes the host's theme. It sends its console and its
 *  uncaught errors as MCP's log message (`notifications/message`), at most 50 a minute, so the host
 *  can keep them. No dependency. */
/** The widget's wheel or finger, for the host's list (not MCP Apps': iterate's own). */
export const WIDGET_SCROLLED = "iterate/notifications/scrolled";

export const WIDGET_CLIENT = `(function () {
  var boot = JSON.parse(document.getElementById("iterate-widget-boot").textContent);
  var listeners = [], pending = {}, nextId = 1, lastHeight = -1, logged = 0, loggedSince = Date.now();
  function post(message) { parent.postMessage(Object.assign({ jsonrpc: "2.0" }, message), "*"); }
  function request(method, params) {
    var id = nextId++;
    post({ id: id, method: method, params: params });
    return new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject }; });
  }
  function notify(method, params) { post({ method: method, params: params || {} }); }
  function textOf(values) {
    return values.map(function (value) {
      if (typeof value === "string") return value;
      if (value instanceof Error) return value.stack || String(value);
      try { return JSON.stringify(value); } catch (error) { return String(value); }
    }).join(" ").slice(0, 2048);
  }
  function log(level, text) {
    if (Date.now() - loggedSince > 60000) { loggedSince = Date.now(); logged = 0; }
    if (logged >= 50) return;
    logged += 1;
    notify("notifications/message", { level: level, logger: "widget", data: text });
  }
  ["log", "info", "warn", "error", "debug"].forEach(function (name) {
    var original = console[name];
    console[name] = function () {
      original.apply(console, arguments);
      log(name === "warn" ? "warning" : name === "log" ? "info" : name, textOf([].slice.call(arguments)));
    };
  });
  addEventListener("error", function (event) {
    log("error", event.error && event.error.stack ? String(event.error.stack) : String(event.message || "error") + (event.lineno ? " (line " + event.lineno + ")" : ""));
  });
  addEventListener("unhandledrejection", function (event) { log("error", "Unhandled rejection: " + textOf([event.reason])); });
  // A WHEEL OR A FINGER THAT NOTHING HERE CAN USE goes to the host: the page hears no event from a
  // frame, so its list scrolls with no reader it knows of, and a list that follows its end writes
  // the view back down (the snap back, measured 25 Nov 2026). The host scrolls its list instead.
  function usedInside(target, deltaY) {
    for (var el = target; el && el.nodeType === 1; el = el.parentElement) {
      var isPage = el === document.scrollingElement;
      var flow = isPage ? "auto" : getComputedStyle(el).overflowY;
      if ((flow === "auto" || flow === "scroll") && el.scrollHeight > el.clientHeight + 1) {
        if (deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
      }
    }
    return false;
  }
  function scrolled(what) { notify("${WIDGET_SCROLLED}", what); }
  addEventListener("wheel", function (event) {
    if (event.ctrlKey || !event.deltaY || usedInside(event.target, event.deltaY)) return;
    event.preventDefault();
    scrolled({ wheel: event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1) });
  }, { passive: false });
  var fingerY = 0;
  addEventListener("touchstart", function (event) { fingerY = event.touches[0].clientY; scrolled({ touch: "start" }); }, { passive: true });
  addEventListener("touchmove", function (event) { var y = event.touches[0].clientY; scrolled({ touch: "move", by: fingerY - y }); fingerY = y; }, { passive: true });
  addEventListener("touchend", function () { scrolled({ touch: "end" }); }, { passive: true });
  addEventListener("touchcancel", function () { scrolled({ touch: "end" }); }, { passive: true });
  function setData(data) {
    ui.data = data;
    listeners.slice().forEach(function (listener) { try { listener(data); } catch (error) { console.error(error); } });
  }
  function takeContext(context) {
    if (!context) return;
    var variables = context.styles && context.styles.variables;
    if (variables) for (var name in variables) document.documentElement.style.setProperty(name, variables[name]);
    if (context.theme === "light" || context.theme === "dark") {
      ui.theme = context.theme;
      // every element takes the host's scheme, so light-dark() follows the host, not the computer
      var scheme = document.getElementById("iterate-widget-scheme");
      if (scheme) scheme.textContent = schemeRule(context.theme);
      document.documentElement.setAttribute("data-theme", context.theme);
    }
  }
  function schemeRule(theme) {
    return ":root,:root *{color-scheme:" + theme + " !important}";
  }
  function size() {
    var height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height === lastHeight) return;
    lastHeight = height;
    notify("ui/notifications/size-changed", { height: height });
  }
  var ui = (window.ui = {
    data: boot.data,
    theme: boot.theme,
    onData: function (listener) {
      listeners.push(listener);
      try { listener(ui.data); } catch (error) { console.error(error); }
      return function () { listeners = listeners.filter(function (other) { return other !== listener; }); };
    },
    send: function (text) { return request("ui/message", { role: "user", content: [{ type: "text", text: String(text) }] }); },
    open: function (url) { return request("ui/open-link", { url: String(url) }); },
  });
  addEventListener("message", function (event) {
    if (event.source !== parent) return;
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method === undefined && pending[message.id]) {
      var call = pending[message.id];
      delete pending[message.id];
      if (message.error) call.reject(new Error(message.error.message));
      else call.resolve(message.result);
    } else if (message.method === "ui/notifications/tool-result") {
      var result = message.params || {};
      if (result.structuredContent !== undefined) setData(result.structuredContent);
      // the height right after each draw, and once more: a frame the browser does not paint (out of
      // view, a background tab) runs no ResizeObserver and no requestAnimationFrame
      size();
      setTimeout(size, 250);
    } else if (message.method === "ui/notifications/host-context-changed") takeContext(message.params);
  });
  request("ui/initialize", {
    protocolVersion: "${WIDGET_PROTOCOL}",
    appInfo: { name: "iterate-widget", version: "1" },
    appCapabilities: { availableDisplayModes: ["inline"] },
  }).then(function (answer) {
    takeContext(answer && answer.hostContext);
    notify("ui/notifications/initialized");
    size();
    if (typeof ResizeObserver === "function") new ResizeObserver(size).observe(document.documentElement);
    addEventListener("load", size);
  });
})();`;

/** THE FRAME'S WHOLE DOCUMENT, in this order: the doctype, the policy, the theme, the base style,
 *  the host's color scheme on every element, the data, the client, then the author's HTML as
 *  written. The data and the theme are in it, so the widget draws while it parses. */
export function widgetDocument(
  widget: Pick<Widget, "html" | "data" | "csp" | "app">,
  theme: WidgetTheme,
): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${widgetPolicy(widget.csp)}">`;
  // ANOTHER SERVER'S DOCUMENT, as it served it, after the policy: the policy is the first element
  // whatever the document says. Its own doctype, `<html>` and `<head>` after it are parsed into
  // the same document (a second doctype is ignored; the `<html>` attributes are kept), so no
  // comment or script in it can stand before the policy. Its theme comes in `ui/initialize`.
  if (widget.app) return `<!doctype html><meta charset="utf-8">${policy}${widget.html}`;
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    policy +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<style>:root{${cssVariables(theme.variables)}}${BASE_STYLE}</style>` +
    // the host's scheme on every element, over the author's own `color-scheme: light dark`: a
    // frame takes the computer's preference, which need not be the page's theme (the client
    // rewrites this rule when the host's theme changes)
    `<style id="iterate-widget-scheme">:root,:root *{color-scheme:${theme.theme} !important}</style>` +
    `<script type="application/json" id="iterate-widget-boot">${inlineJson({ data: widget.data ?? null, theme: theme.theme })}</script>` +
    `<script>${WIDGET_CLIENT}</script>` +
    `</head><body>${widget.html}</body></html>`
  );
}

// ── THE HOST'S HALF ─────────────────────────────────────────────────────────────────────────────

/** What the frame does with one message of its widget: the answer to post back, and what to do. */
export type WidgetAct = {
  /** The JSON-RPC answer to post to the widget, when the message was a request. */
  reply?: {
    jsonrpc: "2.0";
    id: unknown;
    result?: unknown;
    error?: { code: number; message: string };
  };
  /** The widget's height in CSS pixels. */
  height?: number;
  /** The widget sent the person's words to the agent. */
  send?: string;
  /** Another server's view offered words: they go into the composer, for the person to send. */
  draft?: string;
  /** An https link to open in a new tab. */
  open?: string;
  /** The widget finished its handshake: send it its data. */
  initialized?: true;
  /** A wheel or a finger over the widget that nothing in it could use: the host scrolls its list
   *  (WIDGET_SCROLLED). `wheel` in CSS pixels, down positive; a finger's `by` likewise. */
  scrolled?: { wheel: number } | { touch: "start" | "end" } | { touch: "move"; by: number };
  /** One line of the widget's console or an uncaught error (`notifications/message`). */
  log?: { level: "log" | "info" | "warn" | "error" | "debug"; text: string };
  /** An app's view calls a tool of its own server (`tools/call`): the host makes the call and
   *  posts the reply to `id` itself. */
  callTool?: { id: string | number; name: string; arguments: Record<string, unknown> };
  /** An app's view reads a resource of its own server (`resources/read`), likewise. */
  readResource?: { id: string | number; uri: string };
  /** Words from the view for the agent's next turn (`ui/update-model-context`): that server's or
   *  that widget's words, never the person's. */
  modelContext?: { content: unknown[]; structuredContent?: unknown };
};

/** Where the host stands when a message comes. `pressed`: the browser says a person pressed
 *  something lately (`navigator.userActivation.isActive`). */
export type WidgetHostState = {
  widget: Widget;
  theme: WidgetTheme;
  width?: number;
  pressed: boolean;
  /** The host takes words from the widget (the page gave the chat a way to send them). */
  canSend: boolean;
  /** The host puts an app's words into the chat's composer (the chat has one). */
  canDraft?: boolean;
  /** The host makes an app's tool calls and resource reads (the page gave a way). */
  canCallServer?: boolean;
  /** The host takes a widget's words for the agent's next turn. */
  canModelContext?: boolean;
};

const ok = (id: unknown, result: unknown): WidgetAct["reply"] => ({ jsonrpc: "2.0", id, result });
const refused = (id: unknown, code: number, message: string): WidgetAct["reply"] => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** The origins of a widget's `csp` that its frame's policy took (widgetPolicy). */
function appliedCsp(csp: WidgetCsp | undefined): WidgetCsp {
  const applied: WidgetCsp = {};
  for (const name of [
    "connectDomains",
    "resourceDomains",
    "frameDomains",
    "baseUriDomains",
  ] as const) {
    const { taken } = widgetCspSources(csp?.[name]);
    if (taken.length) applied[name] = taken;
  }
  return applied;
}

/** The host's context for `ui/initialize`: the theme, inline display, and the width. */
function widgetHostContext(state: Pick<WidgetHostState, "theme" | "width">) {
  return {
    theme: state.theme.theme,
    styles: { variables: state.theme.variables },
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    ...(Boolean(state.width) && { containerDimensions: { maxWidth: state.width } }),
  };
}

/** The tool result that carries a widget's data: its words and its data. An app's is the call's
 *  own result, with the newest data (a `widget-updated`) as its structured content. */
export const widgetResult = (widget: Pick<Widget, "text" | "data" | "app">) =>
  widget.app
    ? {
        ...widget.app.result,
        structuredContent:
          widget.data === undefined ? widget.app.result.structuredContent : widget.data,
      }
    : { content: [{ type: "text", text: widget.text }], structuredContent: widget.data ?? null };

/** The arguments the view was shown with: an app's call's input, our widget's data. */
export const widgetInput = (widget: Pick<Widget, "data" | "app">) =>
  widget.app ? widget.app.input : (widget.data ?? {});

/** THE HOST'S ANSWER TO ONE MESSAGE of a widget. A send or a link wants a press: a widget that
 *  sends words at load, with no press, is refused. A link is https only. */
export function widgetAnswer(message: unknown, state: WidgetHostState): WidgetAct {
  if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string")
    return {};
  const { id, method } = message;
  const params = isRecord(message.params) ? message.params : {};
  // a JSON-RPC id is a string or a number, and 0 is one
  const request = typeof id === "string" || typeof id === "number";
  switch (method) {
    case "ui/initialize": {
      const server = Boolean(state.widget.app && state.canCallServer);
      return {
        reply: ok(id, {
          protocolVersion: WIDGET_PROTOCOL,
          hostInfo: { name: "iterate", version: "1" },
          hostCapabilities: {
            openLinks: {},
            logging: {},
            ...((state.widget.app ? state.canDraft : state.canSend) && { message: { text: {} } }),
            ...(state.canModelContext && {
              updateModelContext: { text: {}, structuredContent: {} },
            }),
            ...(server && { serverTools: {}, serverResources: {} }),
            // what the frame grants: the origins its policy took, and no device permission
            sandbox: { permissions: {}, csp: appliedCsp(state.widget.csp) },
          },
          hostContext: widgetHostContext(state),
        }),
      };
    }
    case "ui/notifications/initialized":
      return { initialized: true };
    case "ui/notifications/size-changed": {
      const height =
        typeof params.height === "number" && Number.isFinite(params.height)
          ? params.height
          : undefined;
      return height === undefined
        ? {}
        : { height: Math.min(Math.max(Math.ceil(height), 24), WIDGET_HEIGHT_MAX) };
    }
    case "ui/message": {
      const content = Array.isArray(params.content) ? params.content : [];
      const text = content
        .map((part) =>
          isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "",
        )
        .join("")
        .trim()
        .slice(0, 4000);
      if (!request) return {};
      // ANOTHER SERVER'S WORDS ARE A DRAFT: a press shows that the person touched the frame, not
      // that they approved the words. The composer shows the exact text, and the person sends it
      // or not. Our own widget's words are ones our agent wrote: a press sends them.
      const app = Boolean(state.widget.app);
      if (app ? !state.canDraft : !state.canSend)
        return {
          reply: refused(
            id,
            -32601,
            app
              ? "This chat has no composer for a widget's words."
              : "This chat takes no words from a widget.",
          ),
        };
      if (!state.pressed)
        return {
          reply: refused(
            id,
            -32000,
            "A widget sends words only when a person presses something in it.",
          ),
        };
      if (text === "") return { reply: refused(id, -32602, "The message has no words.") };
      return app ? { reply: ok(id, {}), draft: text } : { reply: ok(id, {}), send: text };
    }
    case "ui/open-link": {
      const url = typeof params.url === "string" ? params.url : "";
      if (!request) return {};
      if (!/^https:\/\/[^\s]+$/i.test(url))
        return { reply: refused(id, -32602, "A widget opens https links only.") };
      if (!state.pressed)
        return {
          reply: refused(
            id,
            -32000,
            "A widget opens a link only when a person presses something in it.",
          ),
        };
      return { reply: ok(id, {}), open: url };
    }
    case WIDGET_SCROLLED: {
      const wheel = Number(params.wheel);
      const by = Number(params.by);
      if (Number.isFinite(wheel) && wheel)
        return { scrolled: { wheel: Math.max(-4000, Math.min(4000, wheel)) } };
      if (params.touch === "start" || params.touch === "end")
        return { scrolled: { touch: params.touch } };
      if (params.touch === "move" && Number.isFinite(by))
        return { scrolled: { touch: "move", by: Math.max(-4000, Math.min(4000, by)) } };
      return {};
    }
    case "notifications/message": {
      // MCP's log message: the level in its words (RFC 5424's), the text in `data`
      const level = String(params.level);
      const mapped =
        level === "debug"
          ? "debug"
          : level === "info" || level === "notice"
            ? "info"
            : level === "warning"
              ? "warn"
              : "error";
      const data =
        typeof params.data === "string" ? params.data : JSON.stringify(params.data ?? null);
      return { log: { level: mapped, text: String(data).slice(0, 2048) } };
    }
    case "tools/call": {
      if (!request) return {};
      if (!state.widget.app || !state.canCallServer)
        return { reply: refused(id, -32601, "This widget has no server to call.") };
      const name = words(params.name, 200);
      if (!name) return { reply: refused(id, -32602, "A tool call names its tool.") };
      const args = isRecord(params.arguments) ? params.arguments : {};
      return { callTool: { id, name, arguments: args } };
    }
    case "resources/read": {
      if (!request) return {};
      if (!state.widget.app || !state.canCallServer)
        return { reply: refused(id, -32601, "This widget has no server to read.") };
      const uri = words(params.uri, 2000);
      if (!uri) return { reply: refused(id, -32602, "A read names its resource.") };
      return { readResource: { id, uri } };
    }
    case "ui/update-model-context": {
      if (!request) return {};
      if (!state.canModelContext)
        return { reply: refused(id, -32601, "This chat takes no context from a widget.") };
      const content = Array.isArray(params.content) ? params.content.slice(0, 20) : [];
      return {
        reply: ok(id, {}),
        modelContext: { content, structuredContent: params.structuredContent },
      };
    }
    case "ui/request-display-mode":
      return request ? { reply: ok(id, { mode: "inline" }) } : {};
    case "ping":
      return request ? { reply: ok(id, {}) } : {};
    default:
      return request ? { reply: refused(id, -32601, `This host does not offer ${method}.`) } : {};
  }
}

/** The spec's theme variables from the page's own tokens (the kit's CSS variables), read where the
 *  frame stands. A token the page lacks is left out. */
const WIDGET_THEME_TOKENS: Record<string, string> = {
  "--color-background-primary": "--background",
  "--color-background-secondary": "--muted",
  "--color-text-primary": "--foreground",
  "--color-text-secondary": "--muted-foreground",
  "--color-border-primary": "--border",
  "--color-ring-primary": "--ring",
  "--border-radius-md": "--radius",
};

/** The page's theme where `element` stands: `dark` when an ancestor has the class, and the spec's
 *  variables from the kit's tokens. */
export function widgetThemeAt(element: Element | null): WidgetTheme {
  if (!element || typeof getComputedStyle !== "function") return { theme: "light", variables: {} };
  const style = getComputedStyle(element);
  const variables: Record<string, string> = {};
  for (const [name, token] of Object.entries(WIDGET_THEME_TOKENS)) {
    const value = style.getPropertyValue(token).trim();
    if (value) variables[name] = value;
  }
  variables["--font-sans"] = style.fontFamily;
  return { theme: element.closest(".dark") ? "dark" : "light", variables };
}
