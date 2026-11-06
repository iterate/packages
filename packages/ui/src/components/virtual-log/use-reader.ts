// What a reader is doing with a virtual log, which is what the view answers to. Only the reader, or
// a jump, leaves the end: rows arriving, a clamp and a composer landing all move the view or the end
// with no one asking, and while the virtualizer catches up the position alone says "behind". Being
// there again is all it takes to be back.
import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type TouchEvent,
  type UIEvent,
  type WheelEvent,
} from "react";
import type { Virtualizer } from "@tanstack/react-virtual";

/** How close to the end still counts as being there. It is all a reader has to clear to get away
 *  while rows keep arriving, since each one takes a view still inside it back to the end: 2, for a
 *  scrollTop that lands on a fraction, so that a slow drag on a trackpad clears it. */
export const SCROLL_END_THRESHOLD = 2;

/** The keys that scroll a view, and where to, for what they do to following. */
const SCROLL_KEYS: Record<string, "up" | "somewhere"> = {
  ArrowUp: "up",
  PageUp: "up",
  Home: "up",
  ArrowDown: "somewhere",
  PageDown: "somewhere",
  End: "somewhere",
};

/** How far short of the end the view is. Under 0 it is past the end, in a bounce. */
const shortOfEnd = ({ scrollHeight, clientHeight, scrollTop }: Element) =>
  scrollHeight - clientHeight - scrollTop;

const nearEnd = (scroller: Element) => Math.abs(shortOfEnd(scroller)) <= SCROLL_END_THRESHOLD;

export function useReader(footerRef: RefObject<HTMLElement | null>, rowCount: number) {
  /** Following the tail: the view stays at the end through whatever changes below it. */
  const atEndRef = useRef(true);
  /** The top bubble was pressed: on up, page after page, until the log runs out or the reader acts. */
  const goingToTopRef = useRef(false);
  /** A finger on the glass: the view is theirs until it lifts, so nothing writes to it. */
  const touchingRef = useRef(false);
  /** The row last pressed, and how tall it was. Opened by that press past the height of the view,
   *  its top is what they want, and the end would take what they pressed away from them. */
  const pressedRef = useRef<{ row: HTMLElement; height: number } | null>(null);
  /** How the reader set out to scroll, until that scroll ends. A wheel, a finger or a key says which
   *  way, and has to: rows landing in the same frame can outrun it, leaving scrollTop higher than it
   *  was. */
  const scrollingRef = useRef<"up" | "somewhere" | null>(null);
  const touchYRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const [atEnd, setAtEnd] = useState(true);
  const [atTop, setAtTop] = useState(true);

  const follow = (following: boolean) => {
    atEndRef.current = following;
    setAtEnd(following);
    if (following) scrollingRef.current = null;
  };

  /** A reader setting off from the end. The browser animates a key's scroll, whose first steps are
   *  too small to leave the threshold, and a jump's own scroll event can land after the key: neither
   *  is them arriving, and a write to the end would stop them. */
  const settingOff = (scroller: Element) =>
    scrollingRef.current === "up" && atEndRef.current && nearEnd(scroller);

  const keepAtEnd = (instance: Virtualizer<HTMLDivElement, Element>) => {
    if (!atEndRef.current || touchingRef.current) return;
    const scroller = instance.scrollElement!;
    // past the end the bounce brings it back, and a write would cut that short
    if (settingOff(scroller) || shortOfEnd(scroller) < 0) return;
    const pressed = pressedRef.current;
    const height = pressed?.row.isConnected ? pressed.row.offsetHeight : 0;
    if (pressed && height > pressed.height && height > (instance.scrollRect?.height ?? Infinity)) {
      pressedRef.current = null;
      follow(false);
      instance.scrollToIndex(Number(pressed.row.dataset.index), { align: "start" });
    } else instance.scrollToEnd();
  };

  const trackEdges = ({ currentTarget }: UIEvent<HTMLDivElement>) => {
    const { scrollTop } = currentTarget;
    const movedUp = scrollTop < lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;
    setAtTop(scrollTop <= 4);
    if (settingOff(currentTarget)) return;
    if (nearEnd(currentTarget)) follow(true);
    // nobody leaves by a bounce, whose way back moves up
    else if (shortOfEnd(currentTarget) < 0) return;
    else if (scrollingRef.current === "up" || (scrollingRef.current && movedUp)) follow(false);
  };

  /** What the scroller listens to. */
  const scrollerProps = (virtualizer: Virtualizer<HTMLDivElement, Element>) => {
    const readerScrolls = (where: "up" | "somewhere") => {
      scrollingRef.current = where;
      goingToTopRef.current = false;
      virtualizer.cancelScroll();
    };
    const inFooter = (target: EventTarget) =>
      target instanceof Node && footerRef.current!.contains(target);
    const liftFinger = () => {
      touchingRef.current = false;
      keepAtEnd(virtualizer);
    };
    return {
      onScroll: trackEdges,
      onScrollEnd: () => {
        scrollingRef.current = null;
      },
      onWheel: (event: WheelEvent<HTMLDivElement>) =>
        readerScrolls(event.deltaY < 0 ? "up" : "somewhere"),
      onTouchStart: (event: TouchEvent<HTMLDivElement>) => {
        touchYRef.current = event.touches[0]!.clientY;
        touchingRef.current = !inFooter(event.target);
      },
      onTouchEnd: liftFinger,
      onTouchCancel: liftFinger,
      onTouchMove: (event: TouchEvent<HTMLDivElement>) => {
        const y = event.touches[0]!.clientY;
        // a finger going down brings older rows in
        if (!inFooter(event.target)) readerScrolls(y > touchYRef.current ? "up" : "somewhere");
        touchYRef.current = y;
      },
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        // on the scroller itself, not a row in it: its scrollbar
        if (event.target === event.currentTarget) readerScrolls("somewhere");
        const row =
          event.target instanceof Element && event.target.closest<HTMLElement>("[data-index]");
        // the tail grows by itself, and a press on it is no opening
        pressedRef.current =
          row && Number(row.dataset.index) < rowCount ? { row, height: row.offsetHeight } : null;
      },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        const where = SCROLL_KEYS[event.key];
        // the footer has keys of its own
        if (where && !inFooter(event.target)) readerScrolls(where);
      },
    };
  };

  return {
    atEnd,
    atTop,
    atEndRef,
    goingToTopRef,
    touchingRef,
    pressedRef,
    scrollingRef,
    follow,
    keepAtEnd,
    scrollerProps,
  };
}
