// THE CONTEXT VIEW — one context's stream with its processors and its presence, the general-purpose
// view every app reuses (the dash's activity pages, the agents feed's base): a strip, one line (what
// this is — a path once, each segment a link up, `context-path.tsx` —, how many events, who is here,
// then Filter and Processors as labelled text buttons), a filter row (a text query, the types
// left ticked), the log folded for reading (folds.tsx) as rows one line wide on a desktop and two
// on a phone, and two right-edge sheets — the inspector for one event, the processors with their
// live state. The log reads one way: event-row.tsx says what a row is, and folds.tsx which events
// are one row. Nothing here ever scrolls sideways; the inspector shows what a line cuts.
// BUILT FOR 100,000 EVENTS: the log arrives newest page first and grows at both ends (live
// appends, older pages as the reader scrolls up — `older`); the filter, the type counts and the fold
// follow that growth instead of passing over the whole log again (folds.tsx `refold`), and the rows
// are one virtual list in the view's own scroll region (feed-list.tsx), so the view needs a bounded
// height from its caller (a flex child that fills the page).
// CONTROLLED: every choice a person makes here is `state` (context-view-search.ts — a URL's search
// in every app) and comes back as an `onStateChange` patch, so a view is a link: the
// filter, the inspected event, the open sheet. Only the runs opened in place stay local — scroll-
// position-grade ephemera. Pure otherwise: the context arrives as ONE prop, `context` — what the
// SDK's `useIterateContext(itx)` returns, typed structurally here (`ContextViewSource`) so the UI kit
// stays free of the SDK: `<ContextView context={useIterateContext(itx)} … />`.
// APPENDING: given `onAppend` (the caller's `itx.append`), a raw YAML composer sits under the feed
// (append-composer.tsx), closed to one button; what it appends arrives by the live subscription, and
// the feed follows its tail so it lands in view. No `onAppend`, no composer.
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "cn";
import {
  contextViewFilterOf,
  RIGHT_EDGE_CLOSED,
  type ContextViewState,
} from "./context-view-search.ts";
import { coreEventInspectors } from "./core-events.tsx";
import { EventInspector } from "./event-inspector.tsx";
import { FeedList } from "./feed-list.tsx";
import { actorLabel, narrows, recount, refilter, sortedCounts } from "./filters.tsx";
import { refold } from "./folds.tsx";
import { AppendComposer } from "./append-composer.tsx";
import { type ContextViewAppendEvent } from "./append-events.ts";
import { FilterRow } from "./filter-row.tsx";
import { EventRate, PresenceStrip } from "./presence-strip.tsx";
import { ProcessorsPanel } from "./processors-panel.tsx";
import type {
  ContextViewEvent,
  ContextViewPresence,
  ContextViewProcessor,
  LiveStateView,
  EventInspectors,
} from "./types.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import {
  heldShare,
  OLDER_EXHAUSTED,
  type OlderPages,
} from "#/components/virtual-log/older-pages.ts";
import { ReadProgress } from "#/components/virtual-log/read-progress.tsx";
import { remembered } from "#/components/virtual-log/remembered.ts";

/** The strip's text buttons: a word, muted, the one that is on on a quiet fill — no border. */
const stripButton = (on: boolean) =>
  cn(
    "rounded-md px-2 py-0.5 whitespace-nowrap",
    on ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
  );

export function ContextView({
  title,
  context,
  error: callerError,
  inspectors,
  state,
  onStateChange,
  onAppend,
  emptyText = "Nothing has happened on this context yet.",
  className,
  columnClassName,
}: {
  /** What this context is, for the strip: a path (`ContextPath`), a name. */
  title: ReactNode;
  /** The context, live: what `useIterateContext(itx)` returns. */
  context: ContextViewSource;
  /** The caller's own failure (opening the context), shown over the context's. */
  error?: string;
  /** Rich inspector bodies by type — over the platform's own (a script's code, its result). */
  inspectors?: EventInspectors;
  /** The view's state — the route's parsed search (`validateSearch: ContextViewState`). */
  state: ContextViewState;
  /** A patch to the state; an `undefined` value drops the key (the route spreads it into the search). */
  onStateChange: (patch: Partial<ContextViewState>) => void;
  /** Append to the context (`(events) => itx.append(...events)`); omitted = a view with no composer.
   *  The platform stamps who appended: nothing to add here. */
  onAppend?: (events: ContextViewAppendEvent[]) => Promise<unknown>;
  emptyText?: string;
  className?: string;
  /** The column the text sits in, when it is narrower than the view, so that the scrollbar stays at
   *  the edge of the view. */
  columnClassName?: string;
}) {
  const { events, caughtUp, head, presence, liveState } = context;
  // a read that failed stands in the error, and is not to be asked for again and again
  const older = (!context.error && context.older) || OLDER_EXHAUSTED;
  const processors = context.processors.rows;
  const error = callerError || context.error || context.processors.error;
  const filter = useMemo(() => contextViewFilterOf(state), [state]);
  const filtering = Boolean(state.filter);
  const inspected = state.event;
  /** The runs opened in place, by item key. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  /** Bumped by each append from here: the feed goes back to its tail to show it land. */
  const [followTail, setFollowTail] = useState(0);
  const allInspectors = useMemo(() => ({ ...coreEventInspectors, ...inspectors }), [inspectors]);
  const { shown, items, namedBefore, types } = useFoldedLog({
    events,
    filter,
    counting: filtering,
  });
  const filtered = narrows(filter);
  // stable, so the memoised rows skip the re-render every scroll frame and every append brings
  const toggleOpened = useCallback(
    (key: string) =>
      setOpened((held) => {
        const next = new Set(held);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  const onStateChangeRef = useRef(onStateChange);
  useLayoutEffect(() => {
    onStateChangeRef.current = onStateChange;
  });
  const inspect = useCallback(
    (offset: number) => onStateChangeRef.current({ ...RIGHT_EDGE_CLOSED, event: offset }),
    [],
  );
  const loaded = events.length.toLocaleString();
  // every row's columns start in line: the offset gutter fits the largest offset, `#` included
  // (the feed's rows, the day marks and the composer read it); cast: React's CSSProperties has no
  // index for a custom property
  const gutter = {
    "--offset-width": `${String(String(events.at(-1)?.offset ?? 0).length + 1)}ch`,
  } as CSSProperties;
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)} style={gutter}>
      <div className={columnClassName}>
        <ContextStrip
          title={title}
          count={countText({ filtered, shown, loaded, older, head })}
          caughtUp={caughtUp}
          events={events}
          presence={presence}
          pickedActor={filter.actor}
          filtering={filtering}
          filtered={filtered}
          processorCount={processors.length}
          onStateChange={onStateChange}
        />
        {filtering ? (
          <div className="px-3 sm:px-4 pb-2">
            <FilterRow
              filter={filter}
              counts={types}
              narrowed={filtered}
              partial={!older.exhausted}
              loaded={loaded}
              onStateChange={onStateChange}
            />
          </div>
        ) : null}
        {error ? (
          <p data-type="error" className="px-3 sm:px-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <FeedList
        items={items}
        namedBefore={namedBefore}
        inspected={inspected}
        onInspect={inspect}
        opened={opened}
        onToggle={toggleOpened}
        older={older}
        logShare={heldShare(events, head)}
        followTail={followTail}
        arrivals={shown}
        columnClassName={columnClassName}
        empty={
          error ? null : (
            <FeedEmpty
              caughtUp={caughtUp}
              readProgress={older.exhausted ? undefined : heldShare(events, head)}
              text={filtered ? "No event matches the filter." : emptyText}
            />
          )
        }
        footer={
          onAppend ? (
            <div className="bg-background">
              <div className={columnClassName}>
                <AppendComposer
                  onAppend={onAppend}
                  onAppended={() => setFollowTail((count) => count + 1)}
                  events={events}
                  processors={processors}
                />
              </div>
            </div>
          ) : null
        }
      />
      <EventInspector
        events={events}
        offset={inspected}
        older={older}
        inspectors={allInspectors}
        onNavigate={inspect}
        onClose={() => onStateChange({ event: undefined })}
      />
      <ProcessorsPanel
        open={Boolean(state.processors)}
        onClose={() => onStateChange({ processors: undefined })}
        processors={processors}
        presence={presence}
        liveState={liveState}
        events={events}
        head={head}
        onPickActor={(actor) => onStateChange({ actor, processors: undefined })}
      />
    </div>
  );
}

/** Each pass over the log keeps what it made last and redoes only what the log's growth changed:
 *  the added events filtered, the fold's edge re-folded, the added types counted. */
function useFoldedLog({
  events,
  filter,
  counting,
}: {
  events: readonly ContextViewEvent[];
  filter: ReturnType<typeof contextViewFilterOf>;
  /** The type counts are asked for only while the filter row that lists them is open. */
  counting: boolean;
}) {
  const [filtering] = useState(() => remembered(refilter));
  const shown = useMemo(() => filtering(events, filter).shown, [filtering, events, filter]);
  const [folding] = useState(() => remembered(refold));
  const { items, namedBefore } = useMemo(() => folding(shown, actorLabel), [folding, shown]);
  const [recounting] = useState(() => remembered(recount));
  const types = useMemo(
    () => (counting ? sortedCounts(recounting(events).counts) : []),
    [counting, recounting, events],
  );
  return { shown, items, namedBefore, types };
}

/** How much of the log the view holds, in words. */
function countText({
  filtered,
  shown,
  loaded,
  older,
  head,
}: {
  filtered: boolean;
  shown: readonly ContextViewEvent[];
  loaded: string;
  older: OlderPages;
  head: number | undefined;
}) {
  if (filtered) return `${shown.length.toLocaleString()} of ${loaded} loaded events`;
  if (older.exhausted) return `${loaded} events`;
  return `${loaded} loaded of ~${(head ?? 0).toLocaleString()} events`;
}

/** The view's strip: what this is, how much of it is held, who is here, and its switches. */
function ContextStrip({
  title,
  count,
  caughtUp,
  events,
  presence,
  pickedActor,
  filtering,
  filtered,
  processorCount,
  onStateChange,
}: {
  title: ReactNode;
  count: string;
  caughtUp: boolean;
  events: readonly ContextViewEvent[];
  presence: ContextViewSource["presence"];
  pickedActor: string | undefined;
  filtering: boolean;
  filtered: boolean;
  processorCount: number;
  onStateChange: (patch: Partial<ContextViewState>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 sm:px-4 py-1.5">
      <div className="flex min-w-0 items-baseline gap-4">
        <div className="min-w-0 truncate text-sm">{title}</div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {count}
          {caughtUp ? "" : " · loading"}
          <EventRate events={events} />
        </span>
      </div>
      <PresenceStrip
        className="hidden min-w-0 xl:flex"
        actors={presence.actors}
        rpcStubs={presence.rpcStubs}
        onPick={(actor) => onStateChange({ actor: pickedActor === actor ? undefined : actor })}
      />
      <div className="ml-auto flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => onStateChange({ filter: filtering ? undefined : true })}
          aria-expanded={filtering}
          className={stripButton(filtering || filtered)}
        >
          Filter
        </button>
        <button
          type="button"
          onClick={() => onStateChange({ ...RIGHT_EDGE_CLOSED, processors: true })}
          className={stripButton(false)}
        >
          Processors <span className="text-foreground tabular-nums">{processorCount}</span>
        </button>
      </div>
    </div>
  );
}

/** What the feed shows with no rows: the first read, older pages being read for a first row, or
 *  `text`. */
function FeedEmpty({
  caughtUp,
  readProgress,
  text,
}: {
  caughtUp: boolean;
  readProgress: number | undefined;
  text: string;
}) {
  if (!caughtUp)
    return (
      <div className="flex items-center gap-2 px-3 sm:px-4 py-6 text-sm text-muted-foreground">
        <Spinner /> Loading the log…
      </div>
    );
  if (readProgress !== undefined)
    return (
      <div className="px-3 sm:px-4 py-6">
        <ReadProgress label="Reading the log" value={readProgress} />
      </div>
    );
  return <p className="px-3 sm:px-4 py-6 text-sm text-muted-foreground">{text}</p>;
}

/** What `ContextView` reads of the SDK's `useIterateContext` result — structural, so any source of
 *  the same shape renders (a test's fixture, a recorded log). */
export type ContextViewSource = {
  /** The events loaded, sorted by offset. */
  events: readonly ContextViewEvent[];
  caughtUp: boolean;
  error?: string;
  /** Reading the log below what is loaded; omitted = the whole log is loaded. */
  older?: OlderPages;
  /** The newest offset of the log, so the strip can say how much of it is loaded. */
  head?: number;
  /** The subscriptions table (`itx.subscriptions.list()`): a row hosting a facet is a processor. */
  processors: { rows: readonly ContextViewProcessor[]; error?: string };
  presence: { actors: readonly ContextViewPresence[]; rpcStubs: readonly string[] };
  /** Each live state by name — `core`, and every hosted facet's — for the processors panel. */
  liveState: Record<string, LiveStateView>;
};
