// @vitest-environment jsdom
// A widget's frame and its row in the chat (widget-frame.tsx, widget-row.tsx): a sandboxed frame
// with no same origin, a srcdoc with the widget's HTML, one row for each key, and words only after a
// press in the widget's own frame.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { WidgetFrame } from "./widget-frame.tsx";
import { WidgetHostProvider, WidgetRow } from "./widget-row.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const T = "events.iterate.com/agent-ui/";

test("the row of a key's first fact draws the newest widget in a sandboxed frame; a later fact's row draws nothing", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const events = [
    {
      offset: 3,
      type: `${T}widget-shown`,
      payload: { key: "clicks", title: "A counter", html: "<button>old</button>" },
    },
    {
      offset: 7,
      type: `${T}widget-shown`,
      payload: { key: "clicks", title: "A counter", html: "<button>new</button>" },
    },
  ];
  await act(async () => {
    root.render(
      <WidgetHostProvider events={events}>
        <WidgetRow widgetKey="clicks" offset={3} />
        <WidgetRow widgetKey="clicks" offset={7} />
      </WidgetHostProvider>,
    );
  });
  const frames = host.querySelectorAll("iframe");
  expect(frames).toHaveLength(1);
  const frame = frames[0]!;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("title")).toBe("A counter");
  expect(frame.getAttribute("srcdoc")).toContain("<button>new</button>");
  expect(frame.getAttribute("srcdoc")).not.toContain("<button>old</button>");
  expect(host.querySelector("figcaption")?.textContent).toBe("A counter");
  await act(async () => root.unmount());
  host.remove();
});

test("a widget sends words only while its own frame holds the focus of an active page, once a press", async () => {
  const host = document.createElement("div");
  const elsewhere = document.createElement("textarea");
  document.body.append(host, elsewhere);
  Object.defineProperty(navigator, "userActivation", {
    value: { isActive: true },
    configurable: true,
  });
  const onSend = vi.fn();
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <WidgetFrame
        widget={{ key: "ask", text: "Yes or no", html: "<button>Yes</button>", offset: 1 }}
        onSend={onSend}
      />,
    );
  });
  const frame = host.querySelector("iframe")!;
  const say = (id: number) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          jsonrpc: "2.0",
          id,
          method: "ui/message",
          params: { role: "user", content: [{ type: "text", text: "Yes" }] },
        },
      }),
    );
  // the page is active from a key in the composer, but the widget was not pressed
  elsewhere.focus();
  say(1);
  expect(onSend).not.toHaveBeenCalled();
  // a press in the widget focuses its frame: one message, and the page takes the focus back
  frame.focus();
  expect(focused(frame)).toBe(true);
  say(2);
  say(3);
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith("Yes", { key: "ask", offset: 1 });
  expect(focused(frame)).toBe(false);
  await act(async () => root.unmount());
  host.remove();
  elsewhere.remove();
  Reflect.deleteProperty(navigator, "userActivation");
});

test("an app's frame names its server, gets the call's input and result, and its tools/call reaches onCallTool", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const onCallTool = vi.fn(async () => ({
    content: [{ type: "text", text: "Goldie is yours" }],
    structuredContent: { adopted: "p1" },
  }));
  const onReadResource = vi.fn(async () => ({ contents: [] }));
  const root = createRoot(host);
  const app = {
    server: "https://petshop.iterate.com/mcp",
    tool: "show_pets",
    resourceUri: "ui://petshop/pets.html",
    input: { species: "cat" },
    result: { content: [{ type: "text", text: "3 pets" }], structuredContent: { pets: 3 } },
  };
  await act(async () => {
    root.render(
      <WidgetFrame
        widget={{
          key: "pets",
          text: "3 pets",
          title: "Pet gallery",
          html: "<!doctype html><html><body>the gallery</body></html>",
          offset: 4,
          csp: { connectDomains: ["wss://petshop.iterate.com"] },
          app,
        }}
        onCallTool={onCallTool}
        onReadResource={onReadResource}
      />,
    );
  });
  const frame = host.querySelector("iframe")!;
  expect(host.querySelector("[data-widget-server]")?.textContent).toBe("petshop.iterate.com");
  expect(host.querySelector("figcaption")?.textContent).toContain("Pet gallery");
  const srcdoc = frame.getAttribute("srcdoc")!;
  expect(srcdoc.indexOf("Content-Security-Policy")).toBeLessThan(srcdoc.indexOf("the gallery"));
  expect(srcdoc).toContain("connect-src wss://petshop.iterate.com");
  expect(srcdoc).not.toContain("window.ui");
  const posted: unknown[] = [];
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message);
  });
  const hear = (data: object) =>
    act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: { jsonrpc: "2.0", ...data },
        }),
      );
    });
  await hear({ id: 1, method: "ui/initialize", params: { protocolVersion: "2026-01-26" } });
  expect(posted[0]).toMatchObject({
    id: 1,
    result: { hostCapabilities: { serverTools: {}, serverResources: {} } },
  });
  await hear({ method: "ui/notifications/initialized", params: {} });
  expect(posted.slice(1)).toEqual([
    {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-input",
      params: { arguments: { species: "cat" } },
    },
    { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: app.result },
  ]);
  // no press: a view calls its server whenever it likes
  await hear({
    id: 2,
    method: "tools/call",
    params: { name: "adopt_pet", arguments: { id: "p1" } },
  });
  expect(onCallTool).toHaveBeenCalledWith(
    expect.objectContaining({ name: "adopt_pet", arguments: { id: "p1" } }),
  );
  expect(posted.at(-1)).toEqual({
    jsonrpc: "2.0",
    id: 2,
    result: {
      content: [{ type: "text", text: "Goldie is yours" }],
      structuredContent: { adopted: "p1" },
    },
  });
  // a call that fails is the view's error
  onCallTool.mockRejectedValueOnce(new Error("adopt_pet is not a tool for the app"));
  await hear({ id: 3, method: "tools/call", params: { name: "adopt_pet" } });
  expect(posted.at(-1)).toEqual({
    jsonrpc: "2.0",
    id: 3,
    error: { code: -32000, message: "adopt_pet is not a tool for the app" },
  });
  await hear({ id: 4, method: "resources/read", params: { uri: "ui://petshop/x" } });
  expect(onReadResource).toHaveBeenCalledWith(expect.objectContaining({ uri: "ui://petshop/x" }));
  expect(posted.at(-1)).toEqual({ jsonrpc: "2.0", id: 4, result: { contents: [] } });
  await act(async () => root.unmount());
  host.remove();
});

test("an app's words go to the composer as a draft, never as the person's message", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  Object.defineProperty(navigator, "userActivation", {
    value: { isActive: true },
    configurable: true,
  });
  const onSend = vi.fn();
  const onDraft = vi.fn();
  const root = createRoot(host);
  await act(async () => {
    root.render(<WidgetFrame widget={appWidget(APP)} onSend={onSend} onDraft={onDraft} />);
  });
  const frame = host.querySelector("iframe")!;
  frame.focus();
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "ui/message",
        params: { role: "user", content: [{ type: "text", text: "Adopt Goldie" }] },
      },
    }),
  );
  expect(onDraft).toHaveBeenCalledWith("Adopt Goldie");
  expect(onSend).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator, "userActivation");
});

test("a widget-shown with the same document and another server is a new frame: the old frame's messages and answers are dropped", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  let answerOld: (value: unknown) => void = () => {};
  const onCallTool = vi.fn(
    ({ widget }: { widget: { app?: { server: string } } }) =>
      new Promise((resolve) => {
        if (widget.app?.server === APP.server) answerOld = resolve;
        else resolve({ content: [] });
      }),
  );
  const root = createRoot(host);
  const draw = (app: typeof APP) =>
    act(async () => {
      root.render(
        <WidgetFrame
          widget={appWidget(app)}
          onCallTool={onCallTool}
          onReadResource={async () => ({ contents: [] })}
        />,
      );
    });
  await draw(APP);
  const old = host.querySelector("iframe")!;
  const oldWindow = old.contentWindow!;
  const oldPosts = vi.spyOn(oldWindow, "postMessage").mockImplementation(() => {});
  const call = (source: Window | null, id: number) =>
    act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source,
          data: { jsonrpc: "2.0", id, method: "tools/call", params: { name: "adopt_pet" } },
        }),
      );
    });
  // the old frame asks; then the same key comes with another server
  await call(oldWindow, 1);
  expect(onCallTool).toHaveBeenCalledTimes(1);
  await draw({ ...APP, server: "https://other.example.com/mcp" });
  const now = host.querySelector("iframe")!;
  expect(now).not.toBe(old);
  expect(host.querySelector("[data-widget-server]")?.textContent).toBe("other.example.com");
  // the old call's answer reaches nobody, and the old window is heard no more
  await act(async () => answerOld({ content: [] }));
  expect(oldPosts).not.toHaveBeenCalled();
  await call(oldWindow, 2);
  expect(onCallTool).toHaveBeenCalledTimes(1);
  // the new frame's calls go with the new fact's server
  await call(now.contentWindow, 3);
  expect(onCallTool).toHaveBeenLastCalledWith(
    expect.objectContaining({
      widget: expect.objectContaining({
        app: expect.objectContaining({ server: "https://other.example.com/mcp" }),
      }),
    }),
  );
  await act(async () => root.unmount());
  host.remove();
});

const APP = {
  server: "https://petshop.iterate.com/mcp",
  tool: "show_pets",
  resourceUri: "ui://petshop/pets.html",
  input: {},
  result: { content: [{ type: "text", text: "3 pets" }] },
};
const appWidget = (app: typeof APP) => ({
  key: "pets",
  text: "3 pets",
  html: "<!doctype html><p>the gallery</p>",
  offset: 4,
  app,
});
const focused = (element: Element) => document.activeElement === element;
