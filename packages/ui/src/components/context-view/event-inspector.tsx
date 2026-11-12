// The inspector: one event, whole, in a right-edge sheet (full width on a phone), paged through the
// loaded log, over the view's sorted array.
// - PAGING: Prev / Next and ← → move to the neighbouring event of the whole loaded log (not the
//   filter's), each a `state.event` patch, so the URL follows and
//   every step is a link. The keys are heard on the window in the capture phase: Base UI's popup
//   (our Sheet) stops ← → on bubble for its nested composites. A field or editor with focus keeps
//   its arrows; a modifier (⌘←, ⇧→) is never a page. ← on the oldest loaded event reads the page
//   below and steps onto it once it lands.
// - A LINK TO AN EVENT NOT LOADED (`?event=5` on a 100,000 event log, whose newest page is all that
//   is read) reads older pages until it is, rather than showing nothing; an offset no event has (an
//   ephemeral one, a typo) says so and offers its neighbours.
// - THE HEADER: the event's type as stored (the full type on hover), `#offset · N loaded ·
//   when`, and the gap to the previous and to the next event (`+166ms · +28ms to next`).
// - THE BODY: a rich inspector when one is registered for the type (the message as prose, the
//   script as code), who and on what grant, then the raw event in the read-only CodeMirror block —
//   YAML first, keys signal first (type, payload, then the envelope), a YAML/JSON toggle, copy
//   either, fold, ⌘F search.
// - CLOSING keeps the last event painted through the sheet's exit slide, with paging off.
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  elapsedBetween,
  inspectedPlace,
  isTypingTarget,
  orderEventKeys,
  type InspectedPlace,
} from "./event-inspector-log.ts";
import { actorLabel, shortEventType } from "./filters.tsx";
import { type ContextViewEvent, type EventInspectors, inspectorFor } from "./types.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet.tsx";
import { SerializedObjectCodeBlock } from "#/components/code-block.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import type { OlderPages } from "#/components/virtual-log/older-pages.ts";

export function EventInspector({
  events,
  offset,
  older,
  inspectors,
  onNavigate,
  onClose,
}: {
  /** The loaded log, sorted by offset. */
  events: readonly ContextViewEvent[];
  /** The inspected offset (`state.event`); undefined = closed. */
  offset: number | undefined;
  /** Reading the log below what is loaded. */
  older: OlderPages;
  inspectors?: EventInspectors;
  /** Inspect another offset — a `state.event` patch. */
  onNavigate: (offset: number) => void;
  onClose: () => void;
}) {
  const open = offset !== undefined;
  // the last offset inspected, painted while the sheet slides out after `offset` went undefined
  const [shown, setShown] = useState(offset);
  if (offset !== undefined && offset !== shown) setShown(offset);
  const place = useMemo(
    () => (shown === undefined ? undefined : inspectedPlace(events, shown)),
    [events, shown],
  );
  const paging = useInspectorPaging({ open, shown, place, older, onNavigate });
  return (
    <Sheet open={open} onOpenChange={(opened) => !opened && onClose()}>
      <SheetContent
        side="right"
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl"
        inert={!open}
      >
        {shown === undefined ? null : (
          <InspectedEvent
            shown={shown}
            open={open}
            loaded={events.length}
            place={place}
            paging={paging}
            inspectors={inspectors}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** ← → and Prev / Next through the loaded log: a step onto a neighbour, a page read when ← is
 *  pressed on the oldest loaded event, and pages read down to a link's event. */
function useInspectorPaging({
  open,
  shown,
  place,
  older,
  onNavigate,
}: {
  open: boolean;
  shown: number | undefined;
  place: InspectedPlace | undefined;
  older: OlderPages;
  onNavigate: (offset: number) => void;
}) {
  const { previous, next, missing } = place || {};
  const olderLeft = !older.exhausted;
  // ← pressed on the oldest loaded event: the offset it was pressed on, until the page below lands
  const steppingBackFrom = useRef<number>(undefined);
  const stepBack = () => {
    if (previous) onNavigate(previous.offset);
    else if (olderLeft && shown !== undefined) {
      steppingBackFrom.current = shown;
      older.loadOlder();
    }
  };
  const stepForward = () => next && onNavigate(next.offset);
  // what the page landing, or the reader moving on, makes of that step
  const settleStepBack = useEffectEvent(() => {
    const from = steppingBackFrom.current;
    if (from === undefined) return;
    if (from !== shown || previous || older.exhausted) steppingBackFrom.current = undefined;
    if (from === shown && previous) onNavigate(previous.offset);
  });
  useEffect(() => settleStepBack(), [shown, previous, older.exhausted]);
  // a link to an event older than the loaded pages: read on down to it
  const readingDown = open && missing === "below" && olderLeft;
  useEffect(() => {
    if (readingDown && !older.loading) older.loadOlder();
  }, [readingDown, older]);

  const onKey = useEffectEvent((key: KeyboardEvent) => {
    if (key.altKey || key.ctrlKey || key.metaKey || key.shiftKey) return;
    if (isTypingTarget(key.target)) return;
    if (key.key === "ArrowLeft" && (previous || olderLeft)) {
      key.preventDefault();
      stepBack();
    } else if (key.key === "ArrowRight" && next) {
      key.preventDefault();
      stepForward();
    }
  });
  useEffect(() => {
    if (!open) return;
    const listener = (key: KeyboardEvent) => onKey(key);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [open]);
  return {
    stepBack,
    stepForward,
    canStepBack: Boolean(previous) || olderLeft,
    canStepForward: Boolean(next),
    steppingBack: older.loading && !previous,
    readingDown,
  };
}

/** Who stamped an event, the rows that have a value. */
function envelopeOf(event: ContextViewEvent): [label: string, value: string][] {
  const { source } = event;
  const rows: [string, string][] = [
    ["Who", actorLabel(event)],
    ["From", source?.origin || ""],
    // a copy row's event: what it copied, which the payload alone rarely says
    [
      "Copy of",
      source?.copiedFrom
        ? `${shortEventType(source.copiedFrom.type)} #${source.copiedFrom.offset}${source.copiedFrom.subscription ? ` (row ${source.copiedFrom.subscription})` : ""}`
        : "",
    ],
    ["Grant", source?.grant || ""],
    ["Processor", source?.processor ? `${source.processor.slug}@${source.processor.version}` : ""],
  ];
  return rows.filter((row) => Boolean(row[1]));
}

/** The sheet's contents: the event's header, the paging row, and its body. */
function InspectedEvent({
  shown,
  open,
  loaded,
  place,
  paging,
  inspectors,
}: {
  shown: number;
  open: boolean;
  loaded: number;
  place: InspectedPlace | undefined;
  paging: ReturnType<typeof useInspectorPaging>;
  inspectors: EventInspectors | undefined;
}) {
  const { event, previous, next, missing } = place || {};
  return (
    <>
      <SheetHeader className="shrink-0 pr-12">
        <SheetTitle className="line-clamp-2 text-sm break-all" title={event?.type}>
          {event ? shortEventType(event.type) : `Event #${String(shown)}`}
        </SheetTitle>
        <SheetDescription className="text-xs tabular-nums">
          #{shown} · {loaded.toLocaleString()} loaded
          {event ? ` · ${event.createdAt}` : ""}
        </SheetDescription>
      </SheetHeader>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-3">
        <Button
          size="sm"
          variant="outline"
          disabled={!open || !paging.canStepBack}
          onClick={paging.stepBack}
        >
          {paging.steppingBack ? <Spinner /> : <ChevronLeftIcon />}
          Prev
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!open || !paging.canStepForward}
          onClick={paging.stepForward}
        >
          Next
          <ChevronRightIcon />
        </Button>
        <span className="hidden text-xs text-muted-foreground/70 sm:inline">← → page the log</span>
        <NeighbourGaps event={event} previous={previous} next={next} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-t px-4 py-3">
        {event ? (
          <EventBody event={event} inspectors={inspectors} />
        ) : (
          <MissingEvent shown={shown} missing={missing} readingDown={paging.readingDown} />
        )}
      </div>
    </>
  );
}

/** The gap to the event before and the event after. */
function NeighbourGaps({
  event,
  previous,
  next,
}: {
  event: ContextViewEvent | undefined;
  previous: ContextViewEvent | undefined;
  next: ContextViewEvent | undefined;
}) {
  const sincePrevious = event && previous && elapsedBetween(previous.createdAt, event.createdAt);
  const untilNext = event && next && elapsedBetween(event.createdAt, next.createdAt);
  return (
    <span className="ml-auto flex items-center gap-2 font-mono text-2xs text-muted-foreground">
      {sincePrevious ? <span title="Since the previous event">{sincePrevious}</span> : null}
      {sincePrevious && untilNext ? <span>·</span> : null}
      {untilNext ? <span title="Until the next event">{untilNext} to next</span> : null}
    </span>
  );
}

/** What the sheet says of an offset no loaded event has. */
function MissingEvent({
  shown,
  missing,
  readingDown,
}: {
  shown: number;
  missing: InspectedPlace["missing"];
  readingDown: boolean;
}) {
  if (readingDown)
    return (
      <p className="font-readme text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Spinner /> Reading older events to reach #{shown}…
        </span>
      </p>
    );
  return (
    <p className="font-readme text-sm text-muted-foreground">
      {missing === "above"
        ? `No event #${String(shown)} yet.`
        : `No event has offset #${String(shown)}. Prev and Next go to its neighbours.`}
    </p>
  );
}

/** A rich inspector when one is registered, who stamped the event, then the raw event. */
function EventBody({
  event,
  inspectors,
}: {
  event: ContextViewEvent;
  inspectors: EventInspectors | undefined;
}) {
  // a new object only when the event is another: CodeMirror rebuilds on a new document
  const raw = useMemo(() => orderEventKeys(event), [event]);
  const body = inspectorFor(inspectors, event.type)?.(event) ?? null;
  const envelope = envelopeOf(event);
  return (
    <>
      {body ? <div className="min-w-0">{body}</div> : null}
      {envelope.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {envelope.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate font-mono" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="min-w-0">
        <SerializedObjectCodeBlock data={raw} />
      </div>
    </>
  );
}
