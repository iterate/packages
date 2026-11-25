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
  expect(onSend).toHaveBeenCalledWith("Yes");
  expect(focused(frame)).toBe(false);
  await act(async () => root.unmount());
  host.remove();
  elsewhere.remove();
  Reflect.deleteProperty(navigator, "userActivation");
});

const focused = (element: Element) => document.activeElement === element;
