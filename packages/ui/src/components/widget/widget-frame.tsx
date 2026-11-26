// THE FRAME OF ONE WIDGET (widget.ts says what a widget is). An iframe with `sandbox="allow-scripts"`
// and no `allow-same-origin`: an opaque origin, so no cookie, no storage, and no way into the page
// or another widget. Its document is a `srcdoc` with the policy first (no network). The frame
// answers its widget's messages (widget.ts `widgetAnswer`), keeps its height as the widget reports
// it, and shows the widget's words instead when the widget navigates itself away.
//
// Another server's MCP App (`widget.app`) is drawn by the same frame: its row names the server, and
// its view's `tools/call` and `resources/read` go to `onCallTool` and `onReadResource`, which the
// page makes through the agent's own context.
"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "cn";
import {
  WIDGET_HEIGHT_FIRST,
  widgetAnswer,
  widgetDocument,
  widgetHtmlMax,
  widgetInput,
  widgetPolicy,
  widgetResult,
  widgetServerHost,
  widgetThemeAt,
  type Widget,
  type WidgetAct,
  type WidgetTheme,
} from "./widget.ts";

/** What a page does for an app's view: its tool calls and resource reads, each for the widget
 *  that asked. Each answers the server's own result. */
export type WidgetServerCalls = {
  onCallTool?: (call: {
    widget: Widget;
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<unknown>;
  onReadResource?: (read: { widget: Widget; uri: string }) => Promise<unknown>;
  /** A view's words for the agent's next turn (`ui/update-model-context`), from that widget. */
  onModelContext?: (update: {
    widget: Widget;
    content: unknown[];
    structuredContent?: unknown;
  }) => void;
};

/** A short hash of a frame's document, for its identity (FNV-1a). */
function hashOf(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36) + text.length.toString(36);
}

/** At most this many of one view's tool calls and reads are open at once: one more is refused. */
const SERVER_CALLS_OPEN_MAX = 4;

/** The last height each widget reported, by key, for the page's life: a row that the virtual list
 *  takes out and puts back starts at it, so the feed does not jump. */
const heldHeights = new Map<string, number>();

/** The nearest ancestor that scrolls up and down: the list a widget stands in. */
function scrollerOf(element: Element): Element | null {
  for (let el = element.parentElement; el; el = el.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
  }
  return element.ownerDocument.scrollingElement;
}

/** A wheel or a finger over a widget (widget.ts WIDGET_SCROLLED), as the events the list would have
 *  had from a row of its own: the list learns that the reader scrolls (the kit's use-reader.ts hears
 *  onWheel and touches), and a wheel scrolls it (the frame took the wheel's own scroll). */
function scrollFromWidget(
  iframe: HTMLIFrameElement,
  scrolled: NonNullable<WidgetAct["scrolled"]>,
  finger: { y: number },
) {
  const view = iframe.ownerDocument.defaultView;
  if (!view) return;
  const touchEvent = (type: string, touches: { clientY: number }[]) =>
    iframe.dispatchEvent(Object.assign(new view.Event(type, { bubbles: true }), { touches }));
  if ("wheel" in scrolled) {
    iframe.dispatchEvent(new view.WheelEvent("wheel", { deltaY: scrolled.wheel, bubbles: true }));
    scrollerOf(iframe)?.scrollBy(0, scrolled.wheel);
  } else if (scrolled.touch === "start") {
    finger.y = 0;
    touchEvent("touchstart", [{ clientY: 0 }]);
  } else if (scrolled.touch === "move") {
    // a finger that goes up by 10 px reports by: 10; the list reads positions on the glass
    finger.y -= scrolled.by;
    // the browser scrolls the list for a finger already: the list needs only to hear of it
    touchEvent("touchmove", [{ clientY: finger.y }]);
  } else touchEvent("touchend", []);
}

export function WidgetFrame({
  widget,
  onSend,
  onLog,
  onCallTool,
  onReadResource,
  onModelContext,
  onDraft,
  className,
}: WidgetServerCalls & {
  widget: Widget;
  /** Words a widget sends as the person, after a press. Absent: the widget cannot send words. */
  onSend?: (text: string, widget: { key: string; offset: number }) => void;
  /** Another server's words, after a press, for the chat's composer: the person sends them, or
   *  not. Absent: the chat has no composer, and an app's words are refused. */
  onDraft?: (text: string) => void;
  /** One line of the widget's console, or an uncaught error in it. */
  onLog?: (line: { level: string; text: string; key: string }) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // the theme is read where the frame stands, before the first document: no light flash in dark
  const [theme, setTheme] = useState<WidgetTheme | null>(null);
  const [height, setHeight] = useState(
    () => heldHeights.get(widget.key) ?? widget.height ?? WIDGET_HEIGHT_FIRST,
  );
  const [gone, setGone] = useState(false);
  const loads = useRef(0);
  // the frame's first document is gone (it navigated itself): nothing more is answered or sent
  const away = useRef(false);
  const initialized = useRef(false);
  const finger = useRef({ y: 0 });
  // the document is built once for each HTML and theme: new data goes as a message, so the frame
  // and what the person did in it stay
  const too = widget.html.length > widgetHtmlMax(widget);
  const open = useRef(0);

  useLayoutEffect(() => {
    setTheme(widgetThemeAt(box.current));
  }, []);
  // the policy and whether it is an app, as text and a flag: the fold makes new objects each time
  const policy = widgetPolicy(widget.csp);
  const isApp = Boolean(widget.app);
  const doc = useMemo(
    () =>
      too || !theme
        ? ""
        : widgetDocument(
            { html: widget.html, data: widget.data, csp: widget.csp, app: widget.app },
            theme,
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the data of the first draw only; later data goes as a tool result
    [widget.html, theme, too, policy, isApp],
  );

  // THE FRAME'S IDENTITY: its document, and for an app the server and headers its calls go to. A
  // new identity (a widget-shown that replaced this one) is a new iframe element, so a new window:
  // the old frame's messages and its calls' answers match no window that is drawn.
  const whose = widget.app ? JSON.stringify([widget.app.server, widget.app.headers || {}]) : "";
  const docHash = useMemo(() => hashOf(doc), [doc]);
  const identity = `${docHash}:${whose}`;
  // a new identity is a new handshake and a new first load
  useLayoutEffect(() => {
    initialized.current = false;
    loads.current = 0;
    away.current = false;
  }, [identity]);
  const post = useCallback((message: unknown) => {
    if (!away.current) frame.current?.contentWindow?.postMessage(message, "*");
  }, []);

  /** One call or read for the view, its answer posted to `id`: the server's result, or the
   *  failure as a JSON-RPC error. Only the window that asked hears it, while it is still drawn. */
  const answerFromServer = (id: string | number, run: () => Promise<unknown>) => {
    if (open.current >= SERVER_CALLS_OPEN_MAX) {
      post({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: "Too many calls are open; try again when one ends." },
      });
      return;
    }
    open.current += 1;
    const asked = frame.current?.contentWindow;
    const answer = (message: object) => {
      if (asked && !away.current && frame.current?.contentWindow === asked)
        asked.postMessage({ jsonrpc: "2.0", id, ...message }, "*");
    };
    run()
      .then(
        (result) => answer({ result }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          answer({ error: { code: -32000, message: message.slice(0, 2000) } });
        },
      )
      .finally(() => {
        open.current -= 1;
      });
  };

  // one message of the widget, answered with what the frame holds now
  const heard = useEffectEvent((event: MessageEvent) => {
    if (!frame.current || away.current || event.source !== frame.current.contentWindow) return;
    if (!theme) return;
    const act = widgetAnswer(event.data, {
      widget,
      theme,
      width: box.current?.clientWidth,
      // a press in THIS widget: the page is active and the widget's frame holds the focus (a
      // press in a frame focuses it). A click or a key elsewhere on the page does not count.
      pressed:
        (navigator.userActivation?.isActive ?? false) && document.activeElement === frame.current,
      canSend: Boolean(onSend),
      canDraft: Boolean(onDraft),
      canCallServer: Boolean(onCallTool && onReadResource),
      canModelContext: Boolean(onModelContext),
    });
    if (act.reply) post(act.reply);
    const { callTool, readResource } = act;
    if (callTool && onCallTool)
      answerFromServer(callTool.id, () =>
        onCallTool({ widget, name: callTool.name, arguments: callTool.arguments }),
      );
    if (readResource && onReadResource)
      answerFromServer(readResource.id, () => onReadResource({ widget, uri: readResource.uri }));
    if (act.height !== undefined) {
      heldHeights.set(widget.key, act.height);
      setHeight(act.height);
    }
    if (act.modelContext) onModelContext?.({ widget, ...act.modelContext });
    if (act.initialized) {
      initialized.current = true;
      post({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-input",
        params: { arguments: widgetInput(widget) },
      });
      post({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: widgetResult(widget),
      });
    }
    // one act for each press: the widget's own box takes the focus from its frame, so the next act
    // needs a new press
    if (act.send || act.draft || act.open) box.current?.focus({ preventScroll: true });
    if (act.draft) onDraft?.(act.draft);
    if (act.send) onSend?.(act.send, { key: widget.key, offset: widget.offset });
    if (act.log) onLog?.({ ...act.log, key: widget.key });
    if (act.scrolled && frame.current)
      scrollFromWidget(frame.current, act.scrolled, finger.current);
    if (act.open) window.open(act.open, "_blank", "noopener,noreferrer");
  });
  useEffect(() => {
    const listener = (event: MessageEvent) => heard(event);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  // new data for a widget that is up: one more tool result, and the frame stays
  const sendResult = useEffectEvent(() => {
    if (initialized.current)
      post({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: widgetResult(widget),
      });
  });
  const { data, text } = widget;
  useEffect(() => sendResult(), [data, text]);

  return (
    // NO CHROME AROUND A WIDGET: it sits in the feed as its document draws itself. The figure is
    // the focus target of the press rule (widget.ts `widgetAnswer`), with no look of its own.
    <figure
      ref={box}
      className={cn("my-2 outline-none", className)}
      tabIndex={-1}
      data-kind="widget"
      data-widget={widget.key}
    >
      {widget.app ? (
        // whose UI it is: the server's host, always, one small line above its view
        <figcaption className="flex gap-1.5 pb-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground" data-widget-server>
            {widgetServerHost(widget.app)}
          </span>
          {widget.title ? <span className="truncate">· {widget.title}</span> : null}
        </figcaption>
      ) : null}
      <div
        // a border only for an app whose resource asks for one (`_meta.ui.prefersBorder`)
        className={cn(widget.app?.prefersBorder && "overflow-hidden rounded-xl border")}
        data-widget-border={widget.app?.prefersBorder ? "" : undefined}
      >
        {!theme ? (
          <div style={{ height }} />
        ) : too || gone ? (
          <p className="whitespace-pre-wrap py-1 text-sm">{widget.text}</p>
        ) : (
          <iframe
            key={identity}
            ref={frame}
            title={widget.title || widget.text}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={doc}
            className="block w-full border-0 bg-transparent"
            style={{ height }}
            // the srcdoc's own load is the first; a second is the widget gone elsewhere
            onLoad={() => {
              loads.current += 1;
              if (loads.current > 1) {
                away.current = true;
                setGone(true);
              }
            }}
          />
        )}
      </div>
    </figure>
  );
}
