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

const T = "events.iterate.com/";
/** The facts. A script appends `widget-shown`; `widget-updated` gives a shown widget new data. */
export const WIDGET_FACT = {
  shown: `${T}agent-ui/widget-shown`,
  updated: `${T}agent-ui/widget-updated`,
} as const;
/** The version of the MCP Apps messages that the frame and the host speak. */
const WIDGET_PROTOCOL = "2026-01-26";
/** A widget's HTML is at most this many characters. Past it, the row shows the widget's `text`. */
export const WIDGET_HTML_MAX = 256 * 1024;
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
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const words = (value: unknown, most: number) =>
  typeof value === "string" && value.trim() !== "" ? value.slice(0, most) : undefined;

/** The key a widget fact names: `key`, or `id` (the pet shop's word), else none. */
function keyOf(payload: Record<string, unknown>) {
  return words(payload.key, 200) ?? words(payload.id, 200);
}

/** The widget that one `widget-shown` fact shows, or null for a payload that shows none. */
export function widgetOf(payload: unknown, offset: number): Widget | null {
  if (!isRecord(payload) || typeof payload.html !== "string") return null;
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
export function widgetDocument(widget: Pick<Widget, "html" | "data">, theme: WidgetTheme): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${WIDGET_POLICY}">` +
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
  /** An https link to open in a new tab. */
  open?: string;
  /** The widget finished its handshake: send it its data. */
  initialized?: true;
  /** A wheel or a finger over the widget that nothing in it could use: the host scrolls its list
   *  (WIDGET_SCROLLED). `wheel` in CSS pixels, down positive; a finger's `by` likewise. */
  scrolled?: { wheel: number } | { touch: "start" | "end" } | { touch: "move"; by: number };
  /** One line of the widget's console or an uncaught error (`notifications/message`). */
  log?: { level: "log" | "info" | "warn" | "error" | "debug"; text: string };
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
};

const ok = (id: unknown, result: unknown): WidgetAct["reply"] => ({ jsonrpc: "2.0", id, result });
const refused = (id: unknown, code: number, message: string): WidgetAct["reply"] => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

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

/** The tool result that carries a widget's data: its words and its data. */
export const widgetResult = (widget: Pick<Widget, "text" | "data">) => ({
  content: [{ type: "text", text: widget.text }],
  structuredContent: widget.data ?? null,
});

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
    case "ui/initialize":
      return {
        reply: ok(id, {
          protocolVersion: WIDGET_PROTOCOL,
          hostInfo: { name: "iterate", version: "1" },
          hostCapabilities: { openLinks: {}, ...(state.canSend && { message: {} }) },
          hostContext: widgetHostContext(state),
        }),
      };
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
      if (!state.canSend)
        return { reply: refused(id, -32601, "This chat takes no words from a widget.") };
      if (!state.pressed)
        return {
          reply: refused(
            id,
            -32000,
            "A widget sends words only when a person presses something in it.",
          ),
        };
      if (text === "") return { reply: refused(id, -32602, "The message has no words.") };
      return { reply: ok(id, {}), send: text };
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
export const WIDGET_THEME_TOKENS: Record<string, string> = {
  "--color-background-primary": "--background",
  "--color-background-secondary": "--muted",
  "--color-text-primary": "--foreground",
  "--color-text-secondary": "--muted-foreground",
  "--color-border-primary": "--border",
  "--color-ring-primary": "--ring",
  "--border-radius-md": "--radius",
};
