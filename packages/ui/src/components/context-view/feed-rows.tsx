// The rows that are not one event: the day mark (a plain word over the clock column, no rule), and
// a run of events folded into one line, which names their types as they are stored and how many of
// each ("itx/subscription-configured ×4"). A run opens in place on a click: the feed lists its
// events under it as rows of their own (feed-list.tsx), each opening the inspector like any row.
// Memoised, like every row: the feed re-renders on every scroll frame.
import { memo } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "cn";
import { formatClockTime, rowClass } from "./event-row-format.ts";
import { RowGutter, RowOffset, RowTimes, RowWho, rowBody, rowLine } from "./event-row.tsx";
import { actorLabel, shortEventType } from "./filters.tsx";
import type { ContextViewEvent } from "./types.tsx";

export const DaySeparator = memo(function DaySeparator({ date }: { date: Date }) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const label =
    date.toDateString() === today.toDateString()
      ? "Today"
      : date.toDateString() === yesterday.toDateString()
        ? "Yesterday"
        : date.toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
          });
  return (
    <div className="flex items-baseline gap-x-3.5 px-3 sm:px-4 pt-3 pb-1">
      <RowGutter />
      <span className="text-xs font-semibold text-foreground/75">{label}</span>
    </div>
  );
});

/** A run's types in the order they first come, each with its count when it comes more than once:
 *  `itx/woken, itx/subscription-configured ×4`. */
export function runLabel(types: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const type of types) counts.set(type, (counts.get(type) || 0) + 1);
  return [...counts]
    .map(([type, count]) => `${shortEventType(type)}${count > 1 ? ` ×${String(count)}` : ""}`)
    .join(", ");
}

/** A run: `events.length` events in a row as one line. Open, its events are listed under it. */
export const RunRow = memo(function RunRow({
  itemKey,
  events,
  previous,
  showWho,
  open,
  onToggle,
}: {
  /** The run's key, handed back to `onToggle`. */
  itemKey: string;
  events: ContextViewEvent[];
  previous?: ContextViewEvent;
  showWho: boolean;
  open: boolean;
  onToggle: (itemKey: string) => void;
}) {
  const first = events[0]!;
  const last = events.at(-1)!;
  const who = actorLabel(first);
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      onClick={() => onToggle(itemKey)}
      aria-expanded={open}
      data-run={events.length}
      title={`${String(events.length)} events, ${formatClockTime(Date.parse(first.createdAt))} to ${formatClockTime(Date.parse(last.createdAt))}`}
      className={rowClass()}
    >
      <RowOffset offset={first.offset} />
      <RowTimes event={first} previous={previous} />
      <span className={cn(rowBody, rowLine, "gap-x-1.5 max-sm:flex-row")}>
        <span className="min-w-0 truncate tabular-nums">
          {runLabel(events.map((event) => event.type))}
        </span>
        <Chevron className="size-3 shrink-0 self-center text-muted-foreground" />
      </span>
      {showWho && who ? <RowWho who={who} /> : null}
    </button>
  );
});
