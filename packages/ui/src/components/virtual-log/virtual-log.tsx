// THE VIRTUAL LOG: a log as ONE virtual list in its own scroll region (TanStack Virtual), the root
// every view of a log stands on. A view brings its rows and how to draw one, and gets the rest: only
// the rows in view, plus an overscan, are in the DOM, so 100,000 rows scroll like 100. The list opens
// at its newest row and stays there as rows arrive, a reader in history is never moved, older pages
// load near the top, and once a reader is in history a bubble at the bottom counts what came in and
// leads back to it, and one at the top goes all the way up. `ContextView`'s feed, the agent chat and an LLM trace are each this and
// their own rows, as a view of any other domain is. A view has three places for what it shows:
// - `rows`: what is in the log, virtual, as many as there are.
// - `tail`: what is not in the log yet and ends the list: work in flight, an answer streaming in, any
//   stack of them. It scrolls with the rows, so a reader can leave it behind, and it can grow.
// - `footer`: what is always there, a composer: the rows scroll behind it.
//
//   const DEPLOY_ROWS: VirtualLogRowInfo<DeployEvent> = {
//     key: (event) => String(event.offset),
//     estimateSize: () => 72,
//     offset: (event) => event.offset,
//   };
//   const deploys = useMemo(() => context.events.filter(isDeploy), [context.events]);
//   <VirtualLog
//     rows={deploys}
//     rowInfo={DEPLOY_ROWS}
//     renderRow={(event) => <DeployCard event={event} />}
//     tail={running ? <DeployInProgress state={running} /> : undefined}
//     footer={<DeployComposer />}
//     older={context.older}
//     label="Deploys"
//   />
//
// The scheme is TanStack Virtual's chat mode (https://tanstack.com/virtual/latest/docs/chat):
// `anchorTo: "end"` keeps what a reader sees still as rows land above them, `scrollToEnd()` opens,
// jumps and follows. Rows are keyed by identity, never by index, which is what lets the anchor find
// its row after a prepend. Load state stays out of the list, as the guide asks: index i is row i.
// Two things here go past the guide, each through a public option:
// - `footer` (a composer of any height) sits inside the scroller, sticky at the bottom, so the
//   scrollbar runs past it. `observeElementRect` reports the scroller less the footer: the part the
//   rows have is the viewport the virtualizer should reason about.
// - The view follows by `scrollToEnd()` itself, not `followOnAppend`, which needs the last key to
//   change: rows settling above the tail leave that key as it was. A layout effect does it for new
//   rows and `onChange` for measured ones: with `directDomUpdates` the sizer is already the new size
//   there, so the view lands on the true end before the frame is painted.
//   `rangeExtractor` has the rows at the end mounted before the view gets there.
// Vertical breathing room is `paddingStart` and `paddingEnd`, not wrapper padding the virtualizer
// cannot see. A row's spacing is padding, not margin, and a row renders its real height at once (no
// deferred content): the first measurement is the one the anchor trusts.
import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type Rect,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { cn } from "cn";
import { OLDER_EXHAUSTED, type OlderPages } from "./older-pages.ts";
import { SCROLL_END_THRESHOLD, useReader } from "./use-reader.ts";

/** Rows kept mounted at the edge the view is bound for: a view's worth at the smallest rows on a
 *  usual screen, so that a jump there, which the virtualizer only reads back a frame later, lands on
 *  rows and not on blank. */
const EDGE_ROWS = 40;

/** The tail's virtual key: its index moves up as rows land above it, and keyed by index its (often
 *  tall) measurement would pass to the row that takes its place. */
const TAIL_KEY = "virtual-log/tail";

/** The tail's height until it is measured. */
const TAIL_ESTIMATE = 48;

/** Older pages are asked for when the top of the view is this near the top of what is loaded. */
const LOAD_OLDER_WITHIN_PX = 1_500;

/** What the list needs to know of a row. Stable across renders (a constant, or `useMemo`): the
 *  virtualizer lays every row out again when these change. */
export type VirtualLogRowInfo<Row> = {
  /** A row's identity, stable as rows arrive at either end. */
  key: (row: Row) => string;
  /** A row's height until it is measured. */
  estimateSize: (row: Row) => number;
  /** Where a row sits in the log: what the pill counts and what `reveal` finds. A row that is not
   *  in the log (a day mark, the work in flight) has none. */
  offset: (row: Row) => number | undefined;
};

export function VirtualLog<Row>({
  rows,
  rowInfo,
  renderRow,
  older = OLDER_EXHAUSTED,
  readingOlder,
  empty,
  label,
  arrivals,
  tail,
  footer,
  followTail,
  reveal,
  paddingStart = 0,
  paddingEnd = 0,
  columnClassName,
  className,
}: {
  rows: readonly Row[];
  rowInfo: VirtualLogRowInfo<Row>;
  renderRow: (row: Row, index: number) => ReactNode;
  older?: OlderPages;
  /** What shows at the top of the view while an older page is read. */
  readingOlder?: ReactNode;
  /** What shows when there are no rows. */
  empty?: ReactNode;
  /** The list's accessible name, which makes it a `log`. */
  label?: string;
  /** What is not in the log yet and ends the list: work in flight, an answer streaming in, any stack
   *  of them. It scrolls with the rows and can grow, and a view at the end stays at the end of it. */
  tail?: ReactNode;
  /** What the bubble counts, when a row can stand for many (a fold): the log's entries as they
   *  arrive. By default, the rows with an `offset`. */
  arrivals?: readonly { offset: number }[];
  /** What is always there, in front of the rows at the bottom of the view: a composer, whatever its
   *  height. Its own background says how the rows go behind it. */
  footer?: ReactNode;
  /** Each change pins the view to the tail again, wherever the reader was (the person's own words
   *  or append: the next rows to arrive are theirs, and they land in view). */
  followTail?: number;
  /** An offset to bring into view, once per change (a link, an inspector paging the log), never
   *  again as rows arrive, so a reader who scrolled away from it stays there. One not loaded yet is
   *  brought in when a page brings it: reading that far is the caller's. */
  reveal?: number;
  paddingStart?: number;
  paddingEnd?: number;
  /** The column the rows sit in, inside the scroller, so its scrollbar stays at the edge. */
  columnClassName?: string;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const reader = useReader(footerRef, rows.length);
  const { atEnd, atTop, atEndRef, goingToTopRef, touchingRef, pressedRef, scrollingRef, follow } =
    reader;
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      const bound = goingToTopRef.current ? 0 : atEnd ? range.count - EDGE_ROWS : null;
      if (bound === null) return indexes;
      const from = Math.max(bound, 0);
      const edge = Array.from({ length: Math.min(EDGE_ROWS, range.count) }, (_, at) => from + at);
      return [...new Set([...indexes, ...edge])].sort((a, b) => a - b);
    },
    [atEnd, goingToTopRef],
  );
  const getItemKey = useCallback(
    (index: number) => (index < rows.length ? rowInfo.key(rows[index]!) : TAIL_KEY),
    [rowInfo, rows],
  );
  const estimateSize = useCallback(
    (index: number) => (index < rows.length ? rowInfo.estimateSize(rows[index]!) : TAIL_ESTIMATE),
    [rowInfo, rows],
  );
  const count = rows.length + (tail ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    anchorTo: "end",
    scrollEndThreshold: SCROLL_END_THRESHOLD,
    overscan: 16,
    paddingStart,
    paddingEnd,
    observeElementRect: (instance, report) =>
      observeRowsRect(instance, report, footerRef.current!, () => reader.keepAtEnd(instance)),
    rangeExtractor,
    directDomUpdates: true,
    onChange: reader.keepAtEnd,
  });

  useLayoutEffect(() => {
    atEndRef.current = true;
    goingToTopRef.current = false;
    scrollingRef.current = null;
    virtualizer.scrollToEnd();
  }, [followTail, virtualizer, atEndRef, goingToTopRef, scrollingRef]);

  useLayoutEffect(() => {
    if (atEndRef.current && !touchingRef.current) virtualizer.scrollToEnd();
  }, [rows, count, paddingEnd, virtualizer, atEndRef, touchingRef]);
  // rows arriving: the press is over, and what opens later is not its doing
  useLayoutEffect(() => {
    pressedRef.current = null;
  }, [count, pressedRef]);

  useLayoutEffect(() => {
    if (!goingToTopRef.current) return;
    virtualizer.scrollToOffset(0);
    goingToTopRef.current = !older.exhausted;
  });

  // After every render, from where the DOM stands: the layout effects have already opened the view
  // at the end, and at the very top no scroll event comes to say so. A log shorter than this is
  // always near its top, and a page that adds no rows leads to the next.
  useEffect(() => {
    if (older.loading || older.exhausted) return;
    if (scrollRef.current!.scrollTop < LOAD_OLDER_WITHIN_PX) older.loadOlder();
  });

  const revealRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    revealRef.current = reveal;
  }, [reveal]);
  useEffect(() => {
    const offset = revealRef.current;
    if (offset === undefined || rows.length === 0) return;
    const index = rows.findIndex((row) => rowInfo.offset(row) === offset);
    // not loaded yet: it is wanted until the pages run out (folded away, it never comes)
    if (index < 0 && !older.exhausted) return;
    revealRef.current = undefined;
    if (index < 0) return;
    goingToTopRef.current = false;
    follow(false);
    virtualizer.scrollToIndex(index, { align: "auto" });
  });

  const arrived = useArrivedSince(
    (arrivals || rows).length,
    arrivals ? (at) => arrivals[at]!.offset : (at) => rowInfo.offset(rows[at]!),
    atEnd,
  );
  return (
    <div
      ref={scrollRef}
      data-slot="virtual-log"
      role="presentation"
      tabIndex={-1}
      style={{ overflowAnchor: "none" }}
      {...reader.scrollerProps(virtualizer)}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain outline-none",
        className,
      )}
    >
      <div className={cn("sticky top-0 z-10 h-0 shrink-0", columnClassName)}>
        {older.loading && rows.length > 0 ? (
          <div className="flex h-6 items-center bg-background animate-in fade-in-0 fill-mode-both delay-300">
            {readingOlder}
          </div>
        ) : null}
        {atTop || atEnd ? null : (
          <ScrollBubble
            label="Scroll to top"
            className="absolute top-8 right-3 sm:right-auto sm:left-1/2 sm:-translate-x-1/2"
            onClick={() => {
              follow(false);
              goingToTopRef.current = true;
              scrollRef.current!.focus({ preventScroll: true });
              virtualizer.scrollToOffset(0);
            }}
          >
            <ArrowUpIcon className="size-3.5" />
          </ScrollBubble>
        )}
      </div>
      <div
        role={label ? "log" : undefined}
        aria-label={label}
        className={cn("shrink-0 grow", columnClassName)}
      >
        {count === 0 ? (
          empty
        ) : (
          <div ref={virtualizer.containerRef} className="relative w-full">
            {virtualizer.getVirtualItems().map((virtualItem) => (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
              >
                {virtualItem.index < rows.length
                  ? renderRow(rows[virtualItem.index]!, virtualItem.index)
                  : tail}
              </div>
            ))}
          </div>
        )}
      </div>
      <div ref={footerRef} className="sticky bottom-0 z-10 shrink-0">
        {atEnd ? null : (
          <ScrollBubble
            label={arrived > 0 ? `Scroll to bottom, ${String(arrived)} new` : "Scroll to bottom"}
            className="absolute right-3 bottom-full mb-1 sm:right-auto sm:left-1/2 sm:-translate-x-1/2"
            onClick={() => {
              goingToTopRef.current = false;
              scrollRef.current!.focus({ preventScroll: true });
              follow(true);
              virtualizer.scrollToEnd();
            }}
          >
            <ArrowDownIcon className="size-3.5" />
            {arrived > 0 ? (
              <span className="tabular-nums text-foreground">{arrived} new</span>
            ) : null}
          </ScrollBubble>
        )}
        {footer}
      </div>
    </div>
  );
}

/** Reports the part of the scroller the rows have: all of it less the footer over them. It is the
 *  viewport the virtualizer should reason about. When the rows lose room the end moves with no row
 *  changing, which it does not pin for (TanStack/virtual#1298), so a view at the end goes on. */
function observeRowsRect(
  instance: Virtualizer<HTMLDivElement, Element>,
  report: (rect: Rect) => void,
  footer: HTMLElement,
  keepAtEnd: () => void,
) {
  const scroller = instance.scrollElement!;
  const reportRect = () =>
    report({
      width: scroller.clientWidth,
      height: Math.max(scroller.clientHeight - footer.offsetHeight, 0),
    });
  reportRect();
  const observer = new ResizeObserver(() => {
    reportRect();
    keepAtEnd();
  });
  observer.observe(scroller);
  observer.observe(footer);
  return () => observer.disconnect();
}

/** How many entries came in since the reader left the tail. */
function useArrivedSince(
  length: number,
  offsetAt: (at: number) => number | undefined,
  atEnd: boolean,
) {
  let newest = 0;
  for (let at = length - 1; at >= 0 && newest === 0; at--) newest = offsetAt(at) ?? 0;
  const leftAtRef = useRef(newest);
  useEffect(() => {
    if (atEnd) leftAtRef.current = newest;
  }, [atEnd, newest]);
  if (atEnd) return 0;
  let arrived = 0;
  for (let at = length - 1; at >= 0; at--) {
    const offset = offsetAt(at);
    if (offset === undefined) continue;
    if (offset <= leftAtRef.current) break;
    arrived += 1;
  }
  return arrived;
}

/** A way to an end of the log, over the rows. */
function ScrollBubble({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        // small on the rows it sits over, and a finger's size to press
        "flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full border bg-background px-2 text-xs text-muted-foreground shadow-sm animate-in fade-in-0 hover:text-foreground before:absolute before:-inset-1.5 before:content-['']",
        className,
      )}
    >
      {children}
    </button>
  );
}
