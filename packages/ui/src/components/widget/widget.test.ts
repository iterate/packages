// A widget (widget.ts): the fold of the newest widget for each key, the frame's document with its
// policy and data, and the host's answers to the MCP Apps messages.
import { expect, test } from "vitest";
import {
  WIDGET_APP_HTML_MAX,
  WIDGET_CLIENT,
  WIDGET_FACT,
  WIDGET_HEIGHT_MAX,
  WIDGET_HTML_MAX,
  WIDGET_POLICY,
  WIDGET_SCROLLED,
  widgetAnswer,
  widgetCspSources,
  widgetDocument,
  widgetFold,
  widgetHtmlMax,
  widgetInput,
  widgetOf,
  widgetPolicy,
  widgetResult,
  widgetServerHost,
  type Widget,
  type WidgetHostState,
} from "./widget.ts";

test("the fold keeps the newest widget for each key, at the offset where the key was first shown", () => {
  const fold = widgetFold([
    shown(3, { key: "clicks", text: "A counter", html: "<b>1</b>", data: { n: 1 } }),
    shown(5, { html: "<i>no key</i>" }),
    {
      offset: 6,
      type: WIDGET_FACT.updated,
      payload: { key: "clicks", data: { n: 2 }, text: "Two clicks" },
    },
    shown(8, { id: "clicks", title: "Counter, again", html: "<b>3</b>" }),
    { offset: 9, type: WIDGET_FACT.updated, payload: { key: "nobody", data: 1 } },
    shown(10, { text: "no html" }),
  ]);
  expect([...fold.keys()]).toEqual(["clicks", "widget-5"]);
  expect(fold.get("clicks")).toMatchObject({
    first: 3,
    widget: { offset: 8, html: "<b>3</b>", title: "Counter, again" },
  });
  expect(fold.get("widget-5")).toMatchObject({ first: 5, widget: { text: "A widget" } });
  // an update gives new data and words; the widget-shown after it starts from its own payload
  expect(
    widgetFold([
      shown(3, { key: "k", html: "x", data: 1 }),
      { offset: 4, type: WIDGET_FACT.updated, payload: { key: "k", data: 2, text: "two" } },
    ]).get("k")?.widget,
  ).toMatchObject({ data: 2, text: "two" });
  expect(widgetOf({ html: "x", height: 99_999 }, 1)?.height).toBe(WIDGET_HEIGHT_MAX);
});

test("the document puts the policy first, then the theme, the data (no `</` can end it), the client, the author's HTML", () => {
  const doc = widgetDocument(
    {
      html: "<button onclick=\"ui.send('hi')\">Hi</button>",
      data: { evil: "</script><script>alert(1)</script>" },
    },
    { theme: "dark", variables: { "--color-text-primary": "white", "--bad;": "x", "--ok": "a}b" } },
  );
  expect(doc.startsWith("<!doctype html>")).toBe(true);
  const at = (part: string) => doc.indexOf(part);
  expect(at(WIDGET_POLICY)).toBeGreaterThan(0);
  expect(at(WIDGET_POLICY)).toBeLessThan(at("color-scheme:dark"));
  // the host's scheme wins over an author's `color-scheme: light dark`, which would follow the computer
  expect(doc).toContain(":root,:root *{color-scheme:dark !important}");
  expect(at("--color-text-primary:white")).toBeGreaterThan(0);
  expect(doc).not.toContain("--bad");
  expect(doc).not.toContain("a}b");
  expect(doc).not.toContain("</script><script>alert(1)");
  expect(doc).toContain("\\u003c/script>");
  expect(at("iterate-widget-boot")).toBeLessThan(at("window.ui"));
  expect(at("window.ui")).toBeLessThan(at("<button onclick"));
  expect(WIDGET_POLICY).toContain("connect-src 'none'");
});

test("the host answers the handshake with its theme, and takes the height within bounds", () => {
  const init = widgetAnswer(rpc("ui/initialize", { protocolVersion: "2026-01-26" }), state());
  expect(init.reply).toMatchObject({
    id: 1,
    result: {
      protocolVersion: "2026-01-26",
      hostCapabilities: { openLinks: {}, message: {} },
      hostContext: {
        theme: "light",
        displayMode: "inline",
        styles: { variables: { "--color-text-primary": "black" } },
      },
    },
  });
  expect(widgetAnswer(rpc("ui/notifications/initialized", {}, undefined), state())).toEqual({
    initialized: true,
  });
  expect(
    widgetAnswer(rpc("ui/notifications/size-changed", { height: 333.2 }, undefined), state()),
  ).toEqual({ height: 334 });
  expect(
    widgetAnswer(rpc("ui/notifications/size-changed", { height: 1e9 }, undefined), state()),
  ).toEqual({ height: WIDGET_HEIGHT_MAX });
  expect(widgetAnswer({ method: "ui/initialize" }, state())).toEqual({});
  expect(widgetAnswer(rpc("tools/call", { name: "x" }), state()).reply?.error?.code).toBe(-32601);
});

test("words and links want a press; links are https; a chat with no sender refuses words", () => {
  const words = rpc("ui/message", {
    role: "user",
    content: [{ type: "text", text: "Adopt Mango" }],
  });
  expect(widgetAnswer(words, state())).toMatchObject({
    send: "Adopt Mango",
    reply: { result: {} },
  });
  expect(widgetAnswer(words, state({ pressed: false }))).toMatchObject({
    reply: { error: { code: -32000 } },
  });
  expect(widgetAnswer(words, state({ pressed: false })).send).toBeUndefined();
  expect(widgetAnswer(words, state({ canSend: false })).send).toBeUndefined();
  expect(
    widgetAnswer(rpc("ui/open-link", { url: "https://iterate.com/x" }), state()),
  ).toMatchObject({
    open: "https://iterate.com/x",
  });
  expect(
    widgetAnswer(rpc("ui/open-link", { url: "javascript:alert(1)" }), state()).open,
  ).toBeUndefined();
  expect(
    widgetAnswer(rpc("ui/open-link", { url: "https://iterate.com" }), state({ pressed: false }))
      .open,
  ).toBeUndefined();
});

test("a widget's console line comes as MCP's log message, and the host maps its level", () => {
  const line = (level: string, data: unknown) =>
    widgetAnswer(
      {
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level, logger: "widget", data },
      },
      state(),
    );
  expect(line("warning", "careful")).toEqual({ log: { level: "warn", text: "careful" } });
  expect(line("critical", { a: 1 })).toEqual({ log: { level: "error", text: '{"a":1}' } });
  expect(line("info", "x".repeat(5000)).log?.text).toHaveLength(2048);
  expect(WIDGET_CLIENT).toContain('notify("notifications/message"');
});

test("a widget's wheel (WIDGET_SCROLLED): the client sends a wheel nothing inside can use, and the host takes a bounded one", () => {
  {
    expect(WIDGET_CLIENT).toContain('addEventListener("wheel"');
    expect(WIDGET_CLIENT).toContain(WIDGET_SCROLLED);
    const state: WidgetHostState = {
      widget: { key: "k", offset: 1, html: "", text: "t" },
      theme: { theme: "light", variables: {} },
      pressed: false,
      canSend: false,
    };
    expect(
      widgetAnswer({ jsonrpc: "2.0", method: WIDGET_SCROLLED, params: { wheel: -120 } }, state),
    ).toEqual({ scrolled: { wheel: -120 } });
    expect(
      widgetAnswer({ jsonrpc: "2.0", method: WIDGET_SCROLLED, params: { wheel: 1e9 } }, state),
    ).toEqual({ scrolled: { wheel: 4000 } });
    expect(
      widgetAnswer(
        { jsonrpc: "2.0", method: WIDGET_SCROLLED, params: { touch: "move", by: 12 } },
        state,
      ),
    ).toEqual({ scrolled: { touch: "move", by: 12 } });
    expect(
      widgetAnswer({ jsonrpc: "2.0", method: WIDGET_SCROLLED, params: { wheel: "x" } }, state),
    ).toEqual({});
  }
});

test("the policy is WIDGET_POLICY widened by exactly the declared origins, by the spec's mapping", () => {
  expect(widgetPolicy(undefined)).toBe(WIDGET_POLICY);
  // with nothing declared, the widened policy means what WIDGET_POLICY means
  expect(widgetPolicy({})).toBe(WIDGET_POLICY);
  const policy = widgetPolicy({
    connectDomains: ["wss://petshop.iterate.com", "https://api.example.com:8443"],
    resourceDomains: ["https://esm.iterate.com", "https://*.cdn.example.com"],
    frameDomains: ["https://www.youtube.com"],
    baseUriDomains: ["https://esm.iterate.com"],
  });
  const directive = (name: string) =>
    policy
      .split("; ")
      .find((part) => part.startsWith(`${name} `))
      ?.slice(name.length + 1);
  expect(directive("connect-src")).toBe("wss://petshop.iterate.com https://api.example.com:8443");
  for (const name of ["script-src", "style-src", "img-src", "font-src", "media-src"])
    expect(directive(name)).toContain("https://esm.iterate.com https://*.cdn.example.com");
  expect(directive("script-src")).toBe(
    "'unsafe-inline' https://esm.iterate.com https://*.cdn.example.com",
  );
  expect(directive("img-src")).toBe(
    "data: blob: https://esm.iterate.com https://*.cdn.example.com",
  );
  expect(directive("frame-src")).toBe("https://www.youtube.com");
  expect(directive("base-uri")).toBe("https://esm.iterate.com");
  expect(directive("default-src")).toBe("'none'");
  expect(directive("object-src")).toBe("'none'");
  expect(directive("form-action")).toBe("'none'");
});

test("a csp entry that is no origin or host pattern is refused, and widens nothing", () => {
  const bad = [
    "*",
    "https://*",
    "'unsafe-eval'",
    "https://a.com; script-src *",
    "https://a.com https://b.com",
    'https://a.com"',
    "https://a.com/path",
    "http://example.com",
    "ws://example.com",
    "data:",
    "https:",
    "javascript:alert(1)",
    "https://a.com\nscript-src *",
  ];
  const good = [
    "https://a.com",
    "wss://a.b.com:443",
    "https://*.a.com",
    "http://localhost:8787",
    "ws://127.0.0.1:9000",
  ];
  expect(widgetCspSources([...bad, ...good])).toEqual({ taken: good, refused: bad });
  expect(widgetPolicy({ connectDomains: bad, resourceDomains: bad, frameDomains: bad })).toBe(
    WIDGET_POLICY,
  );
});

test("the fold keeps an app's call and a widget's csp, and an app that names no https server shows nothing", () => {
  const fold = widgetFold([
    shown(2, {
      key: "pets",
      text: "The pets",
      html: APP_HTML,
      data: { pets: 3 },
      csp: { connectDomains: ["wss://petshop.iterate.com", 7], resourceDomains: "no" },
      app: APP,
    }),
    shown(3, { key: "bad", html: "x", app: { ...APP, server: "http://petshop.test/mcp" } }),
    shown(4, { key: "worse", html: "x", app: "petshop" }),
    { offset: 5, type: WIDGET_FACT.updated, payload: { key: "pets", data: { pets: 2 } } },
  ]);
  expect([...fold.keys()]).toEqual(["pets"]);
  const widget = fold.get("pets")!.widget;
  expect(widget).toMatchObject({
    csp: { connectDomains: ["wss://petshop.iterate.com"] },
    app: {
      server: "https://petshop.iterate.com/mcp",
      headers: { authorization: 'Bearer getSecret("/secrets/petshop")' },
      tool: "show_pets",
      resourceUri: "ui://petshop/pets.html",
      input: { species: "cat" },
      result: { structuredContent: { pets: 3 } },
    },
    data: { pets: 2 },
  });
  expect(widgetServerHost(widget.app!)).toBe("petshop.iterate.com");
  // the update's data is the result's structured content; the call's own words stay
  expect(widgetResult(widget)).toEqual({
    content: [{ type: "text", text: "3 pets" }],
    structuredContent: { pets: 2 },
  });
  expect(widgetInput(widget)).toEqual({ species: "cat" });
  expect(widgetHtmlMax(widget)).toBe(WIDGET_APP_HTML_MAX);
  expect(widgetHtmlMax({})).toBe(WIDGET_HTML_MAX);
  expect(widgetOf({ html: "x", app: { server: "https://a.com", tool: "t" } }, 1)).toBeNull();
});

test("an app's document is the server's own, after the policy: no client script, no style of ours", () => {
  const doc = widgetDocument(
    { html: APP_HTML, csp: { connectDomains: ["wss://petshop.iterate.com"] }, app: APP },
    { theme: "dark", variables: { "--color-text-primary": "white" } },
  );
  expect(doc).toBe(
    '<!doctype html><meta charset="utf-8">' +
      `<meta http-equiv="Content-Security-Policy" content="${widgetPolicy({ connectDomains: ["wss://petshop.iterate.com"] })}">` +
      APP_HTML,
  );
  expect(doc).not.toContain("window.ui");
  expect(doc).not.toContain("iterate-widget-boot");
  // our own widget's document takes its csp too
  expect(
    widgetDocument(
      { html: "<b>x</b>", csp: { resourceDomains: ["https://esm.iterate.com"] } },
      { theme: "light", variables: {} },
    ),
  ).toContain("script-src 'unsafe-inline' https://esm.iterate.com");
});

test("an app's handshake offers its server's tools and resources, and the context, and what the frame grants", () => {
  const app = appState();
  expect(widgetAnswer(rpc("ui/initialize"), app).reply?.result).toMatchObject({
    hostCapabilities: {
      openLinks: {},
      message: { text: {} },
      updateModelContext: { text: {} },
      serverTools: {},
      serverResources: {},
      sandbox: { permissions: {}, csp: { connectDomains: ["wss://petshop.iterate.com"] } },
    },
  });
  // our own widget, and an app whose page makes no calls, offer no server
  for (const other of [state({ canCallServer: true }), appState({ canCallServer: false })])
    expect(widgetAnswer(rpc("ui/initialize"), other).reply?.result).not.toHaveProperty(
      "hostCapabilities.serverTools",
    );
});

test("an app's tools/call and resources/read go to the host to make; our widget's are refused", () => {
  expect(
    widgetAnswer(rpc("tools/call", { name: "adopt_pet", arguments: { id: "p1" } }, 7), appState()),
  ).toEqual({ callTool: { id: 7, name: "adopt_pet", arguments: { id: "p1" } } });
  expect(widgetAnswer(rpc("tools/call", { name: "list_pets" }, "a"), appState())).toEqual({
    callTool: { id: "a", name: "list_pets", arguments: {} },
  });
  expect(widgetAnswer(rpc("tools/call", {}), appState()).reply?.error?.code).toBe(-32602);
  expect(widgetAnswer(rpc("tools/call", { name: "x" }), state()).reply?.error?.code).toBe(-32601);
  expect(
    widgetAnswer(rpc("tools/call", { name: "x" }), appState({ canCallServer: false })).reply?.error
      ?.code,
  ).toBe(-32601);
  // a tool call needs no press: a view may watch its server
  expect(widgetAnswer(rpc("tools/call", { name: "x" }), appState({ pressed: false }))).toEqual({
    callTool: { id: 1, name: "x", arguments: {} },
  });
  expect(
    widgetAnswer(rpc("resources/read", { uri: "ui://petshop/more.html" }, 2), appState()),
  ).toEqual({ readResource: { id: 2, uri: "ui://petshop/more.html" } });
  expect(widgetAnswer(rpc("resources/read", {}), appState()).reply?.error?.code).toBe(-32602);
  expect(widgetAnswer(rpc("resources/read", { uri: "x" }), state()).reply?.error?.code).toBe(
    -32601,
  );
  // a notification of either is no request: nothing to answer, nothing to call
  expect(
    widgetAnswer({ jsonrpc: "2.0", method: "tools/call", params: { name: "x" } }, appState()),
  ).toEqual({});
});

test("a widget's context for the next turn, the display mode and ping, for both kinds", () => {
  for (const kind of [state({ canModelContext: true }), appState()]) {
    expect(
      widgetAnswer(
        rpc("ui/update-model-context", {
          content: [{ type: "text", text: "Goldie is adopted" }],
          structuredContent: { left: 2 },
        }),
        kind,
      ),
    ).toEqual({
      reply: { jsonrpc: "2.0", id: 1, result: {} },
      modelContext: {
        content: [{ type: "text", text: "Goldie is adopted" }],
        structuredContent: { left: 2 },
      },
    });
    expect(
      widgetAnswer(rpc("ui/request-display-mode", { mode: "fullscreen" }), kind).reply?.result,
    ).toEqual({ mode: "inline" });
    expect(widgetAnswer(rpc("ping"), kind).reply?.result).toEqual({});
  }
  expect(
    widgetAnswer(rpc("ui/update-model-context", { content: [] }), state()).reply?.error?.code,
  ).toBe(-32601);
});

test("an app's words are a draft for the composer, never sent; our widget's words are sent", () => {
  const words = rpc("ui/message", { role: "user", content: [{ type: "text", text: "Hi" }] });
  const app = widgetAnswer(words, appState());
  expect(app).toEqual({ reply: { jsonrpc: "2.0", id: 1, result: {} }, draft: "Hi" });
  // a press is still wanted, and a chat with no composer refuses an app's words
  expect(widgetAnswer(words, appState({ pressed: false }))).toMatchObject({
    reply: { error: { code: -32000 } },
  });
  expect(widgetAnswer(words, appState({ canDraft: false }))).toMatchObject({
    reply: { error: { code: -32601, message: "This chat has no composer for a widget's words." } },
  });
  expect(
    widgetAnswer(rpc("ui/initialize"), appState({ canDraft: false })).reply?.result,
  ).not.toHaveProperty("hostCapabilities.message");
  // our own widget sends at once, and a composer gives it no draft
  expect(widgetAnswer(words, state({ canDraft: true }))).toEqual({
    reply: { jsonrpc: "2.0", id: 1, result: {} },
    send: "Hi",
  });
});

const APP_HTML =
  '<!doctype html><html lang="en"><head><title>Pets</title></head><body><script>/* the view */</script></body></html>';
const APP: NonNullable<Widget["app"]> = {
  server: "https://petshop.iterate.com/mcp",
  headers: { authorization: 'Bearer getSecret("/secrets/petshop")' },
  tool: "show_pets",
  resourceUri: "ui://petshop/pets.html",
  input: { species: "cat" },
  result: { content: [{ type: "text", text: "3 pets" }], structuredContent: { pets: 3 } },
};
const appState = (more: Partial<WidgetHostState> = {}) =>
  state({
    widget: {
      key: "pets",
      text: "3 pets",
      html: APP_HTML,
      offset: 2,
      csp: { connectDomains: ["wss://petshop.iterate.com", "*"] },
      app: APP,
    },
    canCallServer: true,
    canModelContext: true,
    canDraft: true,
    ...more,
  });
const shown = (offset: number, payload: object) => ({ offset, type: WIDGET_FACT.shown, payload });
const state = (more: Partial<WidgetHostState> = {}): WidgetHostState => ({
  widget: { key: "k", text: "A widget", html: "", offset: 1 },
  theme: { theme: "light", variables: { "--color-text-primary": "black" } },
  pressed: true,
  canSend: true,
  width: 600,
  ...more,
});
const rpc = (method: string, params: object = {}, id: number | string | undefined = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});
