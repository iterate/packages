// THE FRAME OF ONE WIDGET (widget.ts says what a widget is). An iframe with `sandbox="allow-scripts"`
// and no `allow-same-origin`: an opaque origin, so no cookie, no storage, and no way into the page
// or another widget. Its document is a `srcdoc` with the policy first (no network). The frame
// answers its widget's messages (widget.ts `widgetAnswer`), keeps its height as the widget reports
// it, and shows the widget's words instead when the widget navigates itself away.
"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import {
  WIDGET_HEIGHT_FIRST,
  WIDGET_HTML_MAX,
  WIDGET_THEME_TOKENS,
  widgetAnswer,
  widgetDocument,
  widgetResult,
  type Widget,
  type WidgetAct,
  type WidgetTheme,
} from "./widget.ts";

/** The last height each widget reported, by key, for the page's life: a row that the virtual list
 *  takes out and puts back starts at it, so the feed does not jump. */
const heldHeights = new Map<string, number>();

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
  className,
}: {
  widget: Widget;
  /** Words a widget sends as the person, after a press. Absent: the widget cannot send words. */
  onSend?: (text: string) => void;
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
  const too = widget.html.length > WIDGET_HTML_MAX;
  const latest = useRef({ widget, theme, onSend, onLog });
  latest.current = { widget, theme, onSend, onLog };

  useLayoutEffect(() => {
    setTheme(widgetThemeAt(box.current));
  }, []);
  const doc = useMemo(
    () => (too || !theme ? "" : widgetDocument({ html: widget.html, data: widget.data }, theme)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the data of the first draw only; later data goes as a tool result
    [widget.html, theme, too],
  );

  const post = useCallback((message: unknown) => {
    if (!away.current) frame.current?.contentWindow?.postMessage(message, "*");
  }, []);

  useEffect(() => {
    const heard = (event: MessageEvent) => {
      if (!frame.current || away.current || event.source !== frame.current.contentWindow) return;
      const now = latest.current;
      if (!now.theme) return;
      const act = widgetAnswer(event.data, {
        widget: now.widget,
        theme: now.theme,
        width: box.current?.clientWidth,
        // a press in THIS widget: the page is active and the widget's frame holds the focus (a
        // press in a frame focuses it). A click or a key elsewhere on the page does not count.
        pressed:
          (navigator.userActivation?.isActive ?? false) && document.activeElement === frame.current,
        canSend: Boolean(now.onSend),
      });
      if (act.reply) post(act.reply);
      if (act.height !== undefined) {
        heldHeights.set(now.widget.key, act.height);
        setHeight(act.height);
      }
      if (act.initialized) {
        initialized.current = true;
        post({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-input",
          params: { arguments: now.widget.data ?? {} },
        });
        post({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: widgetResult(now.widget),
        });
      }
      // one act for each press: the widget's own box takes the focus from its frame, so the next act
      // needs a new press
      if (act.send || act.open) box.current?.focus({ preventScroll: true });
      if (act.send) now.onSend?.(act.send);
      if (act.log) now.onLog?.({ ...act.log, key: now.widget.key });
      if (act.scrolled && frame.current)
        scrollFromWidget(frame.current, act.scrolled, finger.current);
      if (act.open) window.open(act.open, "_blank", "noopener,noreferrer");
    };
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, [post]);

  // new data for a widget that is up: one more tool result, and the frame stays
  const { data, text } = widget;
  useEffect(() => {
    if (initialized.current)
      post({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: widgetResult({ data, text }),
      });
  }, [data, text, post]);
  // a new document (a widget-shown that replaced this one) is a new handshake and a new first load
  const drawn = useRef(doc);
  if (drawn.current !== doc) {
    drawn.current = doc;
    initialized.current = false;
    loads.current = 0;
    away.current = false;
  }

  return (
    <figure
      ref={box}
      className={cn("my-2 overflow-hidden rounded-xl border bg-card outline-none", className)}
      tabIndex={-1}
      data-kind="widget"
      data-widget={widget.key}
    >
      {widget.title ? (
        <figcaption className="border-b px-3 py-1.5 text-xs text-muted-foreground">
          {widget.title}
        </figcaption>
      ) : null}
      {!theme ? (
        <div style={{ height }} />
      ) : too || gone ? (
        <p className="whitespace-pre-wrap px-3 py-2 text-sm">{widget.text}</p>
      ) : (
        <iframe
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
    </figure>
  );
}
