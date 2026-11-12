// The log folded for reading, as a pure function: a day mark wherever the date turns, and a RUN
// wherever events repeat. A run is two or more events in a row, on one day, that are all of one
// type ("itx/rewrite-rule-configured ×2") or all the stream's upkeep, whatever their types
// ("itx/woken, itx/subscription-configured ×4": core-events.tsx `isUpkeep`). A run is one row,
// which opens in place to its events. Every other event is a row of its own.
// INCREMENTALLY, for a log of 100,000 events that grows at both ends (live appends at the tail,
// older pages prepended at the head): `refold` re-folds only the last item and what was appended,
// or the first item and what was prepended, and folds the whole log only when it changed otherwise.
// It equals `foldEvents` over the whole log (folds.test.tsx proves it across appends and prepends).
import { isUpkeep } from "./core-events.tsx";
import type { ContextViewEvent } from "./types.tsx";

export type FeedItem =
  | { kind: "day"; key: string; date: Date }
  | { kind: "event"; key: string; event: ContextViewEvent }
  /** Events in a row of one type, or all upkeep: one row with their types and counts. */
  | { kind: "run"; key: string; events: ContextViewEvent[] };

/** The LOCAL calendar day an event fell on — the day the reader's clock says, the same day the
 *  separator labels (feed-rows.tsx); grouping by the UTC date would open a second "Today" for an
 *  evening anywhere east or west of Greenwich. Remembered per event object: a fold asks it of every
 *  event it passes, and a Date per event per fold is most of a 100,000-event fold's time. */
function dayOf(event: ContextViewEvent): string {
  let day = daysSeen.get(event);
  if (!day) {
    day = new Date(event.createdAt).toDateString();
    daysSeen.set(event, day);
  }
  return day;
}
const daysSeen = new WeakMap<ContextViewEvent, string>();

/** Fold `events` into items. `markedDay` is the day already marked above them (a re-fold of the
 *  tail continues the day its first event fell on, so it opens no second separator for it). */
export function foldEvents(events: readonly ContextViewEvent[], markedDay = ""): FeedItem[] {
  const items: FeedItem[] = [];
  let lastDay = markedDay;
  let i = 0;
  while (i < events.length) {
    const event = events[i]!;
    const day = dayOf(event);
    if (day !== lastDay) {
      items.push({ kind: "day", key: `day:${day}`, date: new Date(event.createdAt) });
      lastDay = day;
    }
    // upkeep continues a run of upkeep; anything else continues a run of its own type
    const upkeep = isUpkeep(event);
    let end = i + 1;
    while (
      end < events.length &&
      dayOf(events[end]!) === day &&
      (upkeep ? isUpkeep(events[end]!) : events[end]!.type === event.type)
    )
      end += 1;
    items.push(
      end - i === 1
        ? { kind: "event", key: `event:${String(event.offset)}`, event }
        : { kind: "run", key: `run:${String(event.offset)}`, events: events.slice(i, end) },
    );
    i = end;
  }
  return items;
}

/** Per item, who acted on the last row before it that anyone acted on — "" at the top and after
 *  a day mark (a new day names its first actor again, since yesterday may have scrolled off).
 *  The rows name who acted only when it changes against this. `before` is who acted last above
 *  `items` (a re-fold of the tail carries it on). */
export function whoBefore(
  items: readonly FeedItem[],
  actorOf: (event: ContextViewEvent) => string,
  before = "",
): string[] {
  let last = before;
  return items.map((item) => {
    if (item.kind === "day") {
      last = "";
      return "";
    }
    const before = last;
    const event = lastEventOf(item);
    if (event && actorOf(event)) last = actorOf(event);
    return before;
  });
}

/** The last event an item covers — the anchor for the next row's gap. */
export function lastEventOf(item: FeedItem | undefined): ContextViewEvent | undefined {
  if (!item || item.kind === "day") return undefined;
  return item.kind === "event" ? item.event : item.events.at(-1);
}

/** How many events an item covers. */
const sizeOf = (item: FeedItem): number =>
  item.kind === "day" ? 0 : item.kind === "event" ? 1 : item.events.length;

/** How `next` grew from `previous`, both sorted by offset and `next` holding every element of
 *  `previous` (the SDK's log, a filter of it): the elements added at the end, or at the start —
 *  null when it changed any other way (a filter changed, a window was dropped). Compares the two
 *  ends by identity, which is enough for sorted arrays of distinct elements: if `next` keeps
 *  `previous`'s last element at `previous`'s last index, nothing was added before it. */
export function growthOf<T>(
  previous: readonly T[],
  next: readonly T[],
): { end: readonly T[] } | { start: readonly T[] } | null {
  if (next === previous) return { end: [] };
  if (next.length < previous.length) return null;
  if (previous.length === 0) return { end: next };
  const added = next.length - previous.length;
  if (next[0] === previous[0] && next[previous.length - 1] === previous.at(-1))
    return { end: next.slice(previous.length) };
  if (next.at(-1) === previous.at(-1) && next[added] === previous[0])
    return { start: next.slice(0, added) };
  return null;
}

/** A fold and what it folded, for the next `refold`. */
export type Fold = {
  events: readonly ContextViewEvent[];
  items: FeedItem[];
  /** `whoBefore` of `items`. */
  namedBefore: string[];
};

/** `foldEvents` + `whoBefore` of `events`, re-using `previous` where the log only grew at one
 *  end: an append re-folds the last item (a run the new events may continue) and the new events;
 *  a prepend re-folds the new events and the first item (a run they may extend backwards — the fold
 *  is greedy from the top, so the items after it stand). Anything else folds the whole log. */
export function refold(
  previous: Fold | undefined,
  events: readonly ContextViewEvent[],
  actorOf: (event: ContextViewEvent) => string,
): Fold {
  const growth = previous && previous.items.length > 0 ? growthOf(previous.events, events) : null;
  if (previous && growth && "end" in growth) {
    if (growth.end.length === 0) return { ...previous, events };
    const last = previous.items.at(-1)!; // a day mark is always followed by an item: never a day
    const start = previous.events.length - sizeOf(last);
    const tail = foldEvents(events.slice(start), dayOf(events[start]!));
    return {
      events,
      items: previous.items.slice(0, -1).concat(tail),
      namedBefore: previous.namedBefore
        .slice(0, -1)
        .concat(whoBefore(tail, actorOf, previous.namedBefore.at(-1))),
    };
  }
  if (previous && growth && "start" in growth) {
    const first = previous.items[1]!; // items[0] is the first day's mark
    const refolded = foldEvents(events.slice(0, growth.start.length + sizeOf(first)));
    const items = refolded.concat(previous.items.slice(2));
    return { events, items, namedBefore: whoBefore(items, actorOf) };
  }
  const items = foldEvents(events);
  return { events, items, namedBefore: whoBefore(items, actorOf) };
}
