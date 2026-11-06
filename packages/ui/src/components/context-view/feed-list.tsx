// The folded log, on the virtual log (virtual-log/virtual-log.tsx). Opened folds list their members
// as rows of their own.
import { useMemo, type ReactNode } from "react";
import { EventRow, RowGutter } from "./event-row.tsx";
import { DaySeparator, HousekeepingRow, RepeatRow } from "./feed-rows.tsx";
import { actorLabel } from "./filters.tsx";
import { type FeedItem, lastEventOf } from "./folds.tsx";
import type { ContextViewEvent, ContextViewMode, EventRenderers } from "./types.tsx";
import type { OlderPages } from "#/components/virtual-log/older-pages.ts";
import { ReadProgress } from "#/components/virtual-log/read-progress.tsx";
import { VirtualLog, type VirtualLogRowInfo } from "#/components/virtual-log/virtual-log.tsx";

/** A member of an opened fold, listed under it. */
type MemberRow = {
  kind: "member";
  key: string;
  event: ContextViewEvent;
  previous?: ContextViewEvent;
  /** The fold was housekeeping: the member reads muted. */
  quiet: boolean;
};

export function FeedList({
  items,
  namedBefore,
  mode,
  renderers,
  inspected,
  onInspect,
  opened,
  onToggle,
  older,
  logShare,
  followTail,
  arrivals,
  columnClassName,
  empty,
  footer,
}: {
  items: readonly FeedItem[];
  /** `whoBefore(items)`: a row names who acted only when it changes against this. */
  namedBefore: readonly string[];
  mode: ContextViewMode;
  renderers: EventRenderers;
  inspected?: number;
  onInspect: (offset: number) => void;
  opened: ReadonlySet<string>;
  onToggle: (itemKey: string) => void;
  older: OlderPages;
  /** How much of the log is held, from 0 to 1. */
  logShare: number;
  /** Each change pins the view to the tail again, wherever the reader was (the view's own append:
   *  the next rows to arrive are the person's, and they land in view). */
  followTail?: number;
  /** The events behind the rows, which is what the bubble counts: a fold is many. */
  arrivals: readonly { offset: number }[];
  columnClassName?: string;
  /** What shows when there are no rows: the empty log, a filter matching nothing, the first read. */
  empty: ReactNode;
  /** The composer, under the rows. */
  footer: ReactNode;
}) {
  // Opened folds add their members after them. Nothing opened (the common case) lists the items
  // themselves, with no pass over 100,000 of them.
  const { rows, itemIndexOf } = useMemo(() => {
    if (opened.size === 0)
      return { rows: items as readonly (FeedItem | MemberRow)[], itemIndexOf: null };
    const rows: (FeedItem | MemberRow)[] = [];
    const itemIndexOf: number[] = [];
    items.forEach((item, index) => {
      rows.push(item);
      itemIndexOf.push(index);
      if (item.kind === "day" || item.kind === "event" || !opened.has(item.key)) return;
      item.events.forEach((event, at) => {
        rows.push({
          kind: "member",
          key: `${item.key}/${String(event.offset)}`,
          event,
          previous: at === 0 ? lastEventOf(items[index - 1]) : item.events[at - 1],
          quiet: item.kind === "housekeeping",
        });
        itemIndexOf.push(-1);
      });
    });
    return { rows, itemIndexOf };
  }, [items, opened]);

  const rowInfo = useMemo(
    (): VirtualLogRowInfo<FeedItem | MemberRow> => ({
      key: (row) => row.key,
      estimateSize: (row) => {
        // every one-line row is 26px (event-row.tsx `rowClass`); a day 36; both lines 42
        if (row.kind === "day") return 36;
        if (row.kind === "member") return row.quiet ? 26 : 42;
        if (row.kind !== "event") return 26;
        return mode === "pretty-raw" ? 42 : 26;
      },
      // an event's, an opened fold member's, a fold's last; none for a day mark
      offset: (row) => (row.kind === "member" ? row.event.offset : lastEventOf(row)?.offset),
    }),
    [mode],
  );
  return (
    <VirtualLog
      rows={rows}
      rowInfo={rowInfo}
      renderRow={renderRow}
      older={older}
      readingOlder={
        <div className="flex min-w-0 flex-1 items-center gap-x-3.5 px-3 sm:px-4">
          <RowGutter times />
          <ReadProgress label="Loading older events" value={logShare} />
        </div>
      }
      empty={empty}
      label="Events"
      arrivals={arrivals}
      footer={footer}
      columnClassName={columnClassName}
      followTail={followTail}
      reveal={inspected}
      paddingStart={4}
      paddingEnd={8}
    />
  );

  function renderRow(row: FeedItem | MemberRow, index: number) {
    if (row.kind === "member")
      return (
        <EventRow
          event={row.event}
          previous={row.previous}
          renderers={renderers}
          mode={row.quiet ? "pretty" : "pretty-raw"}
          showWho={false}
          quiet={row.quiet}
          selected={inspected === row.event.offset}
          onOpen={onInspect}
        />
      );
    if (row.kind === "day") return <DaySeparator date={row.date} />;
    const itemIndex = itemIndexOf ? itemIndexOf[index]! : index;
    const previous = lastEventOf(items[itemIndex - 1]);
    const first = row.kind === "event" ? row.event : row.events[0]!;
    // who acted is named when it changes hands: against the last row that WAS someone's (the
    // platform's housekeeping between two of a person's rows names nobody), afresh each day
    const showWho = actorLabel(first) !== namedBefore[itemIndex];
    if (row.kind === "repeat")
      return (
        <RepeatRow
          itemKey={row.key}
          events={row.events}
          previous={previous}
          renderers={renderers}
          showWho={showWho}
          open={opened.has(row.key)}
          onToggle={onToggle}
        />
      );
    if (row.kind === "housekeeping")
      return (
        <HousekeepingRow
          itemKey={row.key}
          events={row.events}
          previous={previous}
          open={opened.has(row.key)}
          onToggle={onToggle}
        />
      );
    return (
      <EventRow
        event={row.event}
        previous={previous}
        renderers={renderers}
        mode={mode}
        showWho={showWho}
        selected={inspected === row.event.offset}
        onOpen={onInspect}
      />
    );
  }
}
