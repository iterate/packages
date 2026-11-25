// A widget (widget.ts): the fold of the newest widget for each key, the frame's document with its
// policy and data, and the host's answers to the MCP Apps messages.
import { expect, test } from "vitest";
import {
  WIDGET_CLIENT,
  WIDGET_FACT,
  WIDGET_HEIGHT_MAX,
  WIDGET_POLICY,
  WIDGET_SCROLLED,
  widgetAnswer,
  widgetDocument,
  widgetFold,
  widgetOf,
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

const shown = (offset: number, payload: object) => ({ offset, type: WIDGET_FACT.shown, payload });
const state = (more: Partial<WidgetHostState> = {}): WidgetHostState => ({
  widget: { key: "k", text: "A widget", html: "", offset: 1 },
  theme: { theme: "light", variables: { "--color-text-primary": "black" } },
  pressed: true,
  canSend: true,
  width: 600,
  ...more,
});
const rpc = (method: string, params: object = {}, id: number | undefined = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});
