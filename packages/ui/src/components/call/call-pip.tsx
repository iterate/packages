// call-pip.tsx — THE CALL IN A FLOATING WINDOW (Document Picture-in-Picture, Chrome and Edge): what
// the page puts in `CallPipPlace` (the tiles, `CallTiles`) moves to a window over the person's
// other apps, and back when it closes. `useCallPip` holds the window; `CallPipButton` opens and
// closes it, for the call's header. A browser without the API gets no button.
// - After the person's first "Pop out", the browser may open the window by itself when the tab is
//   hidden (the media session's `enterpictureinpicture`, which Chrome asks the person about once).
//   A window the browser opened closes when the person comes back to the tab.
// - "Back to the tab", or the window's own close, ends that too: one press either way.
// - The window closes by itself when nobody has a camera or a screen on.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PictureInPicture2Icon } from "lucide-react";
import type { CallUi } from "#/lib/call-engine.ts";
import { Button } from "#/components/ui/button.tsx";

type Floating = { window: Window; automatic: boolean };
/** Chrome's Document Picture-in-Picture, which TypeScript's DOM types do not have yet. */
declare global {
  var documentPictureInPicture:
    | { requestWindow(options: { width: number; height: number }): Promise<Window> }
    | undefined;
}
const documentPip = () => globalThis.documentPictureInPicture;

/** The page's stylesheets and theme, in the floating window, so the tiles look the same there. */
function dress(floating: Window) {
  const head = floating.document.head;
  for (const sheet of document.head.querySelectorAll('link[rel="stylesheet"], style'))
    head.append(sheet.cloneNode(true));
  const body = floating.document.createElement("style");
  body.textContent = "body{margin:0;padding:0.5rem;background:var(--background)}";
  head.append(body);
  floating.document.documentElement.className = document.documentElement.className;
  floating.document.title = document.title;
}

/** The call's floating window for `ui` (what `useCall` answers). */
export function useCallPip(ui: CallUi) {
  const supported = typeof documentPip()?.requestWindow === "function";
  const [floating, setFloating] = useState<Floating | null>(null);
  // the browser may open it by itself: on after the person's first "Pop out"
  const [automatic, setAutomatic] = useState(false);
  const [error, setError] = useState("");
  const held = useRef<Floating | null>(null);
  const showing = ui.videos.length > 0;

  const close = useCallback(() => {
    const was = held.current;
    held.current = null; // forgotten first: its `pagehide` is then not the person's close
    was?.window.close();
    setFloating(null);
  }, []);
  const open = useCallback(async (byBrowser: boolean) => {
    if (held.current) return true;
    try {
      const window = await documentPip()!.requestWindow({ width: 480, height: 300 });
      dress(window);
      const made = { window, automatic: byBrowser };
      held.current = made;
      // the person closed the window: the browser opens it no more by itself either
      window.addEventListener("pagehide", () => {
        if (held.current !== made) return;
        held.current = null;
        setFloating(null);
        setAutomatic(false);
      });
      setFloating(made);
      setError("");
      return true;
    } catch (failure) {
      if (!byBrowser)
        setError(
          `Picture-in-picture did not open: ${failure instanceof Error ? failure.message : String(failure)}`,
        );
      return false;
    }
  }, []);
  const toggle = useCallback(async () => {
    if (held.current || automatic) {
      close();
      setAutomatic(false);
    } else if (await open(false)) setAutomatic(true);
  }, [automatic, close, open]);

  // nothing to show: the window goes
  useEffect(() => {
    if (!showing) close();
  }, [showing, close]);
  // the browser's own open, when the tab is hidden and something shows
  useEffect(() => {
    if (!automatic || !showing) return;
    // Chrome's action, which TypeScript's list of actions does not have yet: the session seen
    // through a method that takes any action's name
    const session: { setActionHandler(action: string, handler: (() => void) | null): void } =
      navigator.mediaSession;
    try {
      session.setActionHandler("enterpictureinpicture", () => void open(true));
    } catch {
      return; // this browser has no such action
    }
    return () => session.setActionHandler("enterpictureinpicture", null);
  }, [automatic, showing, open]);
  // back in the tab: a window the browser opened closes; one the person opened stays
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === "visible" && held.current?.automatic) close();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [close]);
  useEffect(() => close, [close]);

  return { supported, floating, automatic, showing, error, toggle };
}
export type CallPip = ReturnType<typeof useCallPip>;

/** Opens and closes the floating window; nothing in a browser without one. */
export function CallPipButton({ pip }: { pip: CallPip }) {
  if (!pip.supported) return null;
  const on = Boolean(pip.floating) || pip.automatic;
  const label = pip.floating ? "Back to the tab" : pip.automatic ? "Stop pop-out" : "Pop out";
  const title = pip.showing
    ? `${label}: cameras and screens in a window over your other apps. After a pop-out, the browser can open it by itself when you switch tabs.`
    : "Nobody has a camera or a screen on yet, so there is nothing to pop out.";
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        size="icon-sm"
        variant={on ? "outline" : "secondary"}
        aria-label={label}
        aria-pressed={on}
        title={title}
        disabled={!on && !pip.showing}
        onClick={() => void pip.toggle()}
      >
        <PictureInPicture2Icon />
      </Button>
      {pip.error ? (
        <span role="alert" className="text-xs text-destructive">
          {pip.error}
        </span>
      ) : null}
    </span>
  );
}

/** `children` in the floating window while it is open, and here when it is not. */
export function CallPipPlace({ pip, children }: { pip: CallPip; children: ReactNode }) {
  return pip.floating ? createPortal(children, pip.floating.window.document.body) : children;
}
