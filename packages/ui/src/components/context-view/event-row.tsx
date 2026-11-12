// One row of the stream, ONE line that never runs past the view on a desktop (two on a phone), read
// like a log, left to right in fixed columns: `#offset` in a muted gutter sized to the log's largest
// offset (`--offset-width`, set by the view), the clock, the gap since the row before (blank under a
// second; coloured by its size, so a long pause runs hot), THE EVENT'S TYPE AS IT IS STORED, a
// glance at its payload's fields, and who, when it is not who acted on the row before. The type is
// shown without the `events.iterate.com/` that every type of the platform starts with; the row's
// title has it whole. Everything is in the page's own font and one size: no sentence, no badge, no
// second font, and a path or an id is plain text. The columns' figures are tabular. No rule between
// rows: the hover and the inspected row's 2px bar are enough. THE PAYLOAD TAKES THE WIDTH THAT IS
// LEFT, and the row's end cuts it, once. On a phone the type comes first, the payload is a line of
// its own under it, and the rest is one muted line under that. What a line cuts, the inspector (a
// click) shows whole, with the event as JSON.
import { memo } from "react";
import { cn } from "cn";
import { formatClockTime, formatDelta, rowClass } from "./event-row-format.ts";
import { actorLabel, payloadSummary, shortEventType } from "./filters.tsx";
import type { ContextViewEvent } from "./types.tsx";

/** The gap's colour by its size: under ten seconds the success colour, then the warning colour, a
 *  faded destructive, and the destructive colour for a pause of ten minutes or more — where the log
 *  went quiet stands out. */
function deltaColor(ms: number): string {
  if (ms < 10_000) return "text-success";
  if (ms < 60_000) return "text-warning";
  if (ms < 600_000) return "text-destructive/70";
  return "text-destructive";
}

const OFFSET =
  "shrink-0 text-xs text-muted-foreground/60 tabular-nums sm:w-[var(--offset-width,6ch)] sm:text-right";
const CLOCK = "shrink-0 text-xs text-muted-foreground tabular-nums sm:w-[8ch]";
const GAP = "shrink-0 text-xs tabular-nums max-sm:empty:hidden sm:w-[7ch] sm:text-right";

/** `#123`, right-aligned in the gutter the view sizes to its largest offset (`--offset-width`). */
export function RowOffset({ offset }: { offset: number }) {
  return <span className={OFFSET}>#{offset}</span>;
}

/** The empty columns before the body (the offset, and with `times` the clock and the gap), so a
 *  line that is not an event — a day, the top of the log, the composer — starts where they do. */
export function RowGutter({ times }: { times?: boolean }) {
  return (
    <>
      <span aria-hidden className={cn(OFFSET, "max-sm:hidden")} />
      {times ? (
        <>
          <span aria-hidden className={cn(CLOCK, "max-sm:hidden")} />
          <span aria-hidden className={cn(GAP, "max-sm:hidden")} />
        </>
      ) : null}
    </>
  );
}

/** Who acted, when it changes hands: the right edge on a desktop, the meta line on a phone. */
export function RowWho({ who }: { who: string }) {
  return (
    <span className="max-w-48 min-w-0 truncate text-xs text-muted-foreground sm:ml-auto sm:shrink-0">
      {who}
    </span>
  );
}

/** The clock and the gap since the row before (from its LAST moment, so a run's gap is the idle
 *  time between rows, not inside one): two columns, the gap blank under a second. */
export function RowTimes({
  event,
  previous,
}: {
  event: ContextViewEvent;
  previous?: ContextViewEvent;
}) {
  const at = Date.parse(event.createdAt);
  const gap = previous ? Math.max(0, at - Date.parse(previous.createdAt)) : undefined;
  return (
    <>
      <time dateTime={event.createdAt} title={new Date(at).toISOString()} className={CLOCK}>
        {formatClockTime(at)}
      </time>
      <span className={cn(GAP, gap !== undefined && deltaColor(gap))} title="Since the row before">
        {gap === undefined || gap < 1_000 ? "" : formatDelta(gap)}
      </span>
    </>
  );
}

/** The body column: first on a phone, where it takes the whole first line. */
export const rowBody = "min-w-0 flex-1 max-sm:order-first max-sm:basis-full";

/** The body of every row, in the page's font. On a desktop it is one line, and the type has a
 *  column of its own, so the payloads start in line. On a phone the payload is under the type. */
export const rowLine = "flex min-w-0 items-baseline gap-x-3 text-sm leading-5 max-sm:flex-col";

/** The type's column. */
export const rowType = "min-w-0 shrink-0 truncate max-sm:max-w-full sm:w-60";

/** The body: the type as stored, then the payload's fields in one line. */
export function EventLine({ event }: { event: ContextViewEvent }) {
  const glance = payloadSummary(event.payload);
  return (
    <span className={rowLine}>
      <span className={rowType} title={event.type} data-event-type>
        {shortEventType(event.type)}
      </span>
      {glance ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground max-sm:w-full">
          {glance}
        </span>
      ) : null}
    </span>
  );
}

export const EventRow = memo(function EventRow({
  event,
  previous,
  showWho,
  selected,
  onOpen,
}: {
  event: ContextViewEvent;
  previous?: ContextViewEvent;
  /** Whether to name who acted — false when the row before was theirs too. */
  showWho: boolean;
  selected?: boolean;
  onOpen: (offset: number) => void;
}) {
  const who = actorLabel(event);
  return (
    <button
      type="button"
      onClick={() => onOpen(event.offset)}
      data-offset={event.offset}
      className={rowClass(selected)}
    >
      <RowOffset offset={event.offset} />
      <RowTimes event={event} previous={previous} />
      <span className={rowBody}>
        <EventLine event={event} />
      </span>
      {showWho && who ? <RowWho who={who} /> : null}
    </button>
  );
});
