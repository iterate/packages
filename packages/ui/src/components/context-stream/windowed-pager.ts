// Two-window pager for infinite scrolling and offset deep-linking over sparse append-only logs:
// - When no history jump is active (`!history`), the view reads directly from the live `tailEvents`
//   window (`useIterateContext`) with zero extra state or copies.
// - Calling `openAt(targetOffset)` opens a bounded `history` window centered around `targetOffset`
//   (snapping across sparse offset gaps via `readEvents(targetOffset - 1, 1)`), paging backward
//   (`loadOlder`) and forward (`loadNewer`), trimming past `maxHeldEvents`, and bridging seamlessly
//   into `tailEvents` whenever `provenUpTo >= tailFirst - 1` (reopening `newer` paging automatically
//   if a rolling `tailEvents` window advances past `provenUpTo + 1`).
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  NEWER_EXHAUSTED,
  OLDER_EXHAUSTED,
  type NewerPages,
  type OlderPages,
} from "#/components/virtual-log/older-pages.ts";

export type OffsetEvent = { offset: number };

/** Reads up to `limit` stored events strictly after `afterOffset` (`offset > afterOffset`), ordered
 *  ascending by `offset` (the contract of `itx.readEvents`). */
export type ReadEventsAfter<E extends OffsetEvent> = (
  afterOffset: number,
  limit: number,
) => Promise<readonly E[]>;

/** Merges two ascending-offset event slices, deduplicating by `offset`. */
export function mergeEventsByOffset<E extends OffsetEvent>(
  left: readonly E[],
  right: readonly E[],
): E[] {
  if (left.length === 0) return [...right];
  if (right.length === 0) return [...left];
  const byOffset = new Map<number, E>();
  for (const item of left) byOffset.set(item.offset, item);
  for (const item of right) byOffset.set(item.offset, item);
  return [...byOffset.values()].toSorted((a, b) => a.offset - b.offset);
}

/** Trims `events` to at most `maxHeld` items, dropping from the side opposite `keepEnd`. */
export function trimEventWindow<E extends OffsetEvent>(
  events: readonly E[],
  maxHeld: number,
  keepEnd: "start" | "end",
): readonly E[] {
  if (events.length <= maxHeld) return events;
  return keepEnd === "end" ? events.slice(events.length - maxHeld) : events.slice(0, maxHeld);
}

/** Trims `events` to at most `maxHeld` contiguous items centered around `targetOffset` so the
 *  requested anchor row is always retained even when `maxHeld < 2 * pageSize`. */
function trimAroundOffset<E extends OffsetEvent>(
  events: readonly E[],
  maxHeld: number,
  targetOffset: number,
): readonly E[] {
  if (events.length <= maxHeld) return events;
  const foundIndex = events.findIndex((e) => e.offset >= targetOffset);
  const anchorIndex = foundIndex >= 0 ? foundIndex : events.length - 1;
  const halfBefore = Math.floor((maxHeld - 1) / 2);
  const start = Math.min(Math.max(0, anchorIndex - halfBefore), events.length - maxHeld);
  return events.slice(start, start + maxHeld);
}

/** Reads a gap-free slice of stored events in `(scanFrom, olderCursor]` (up to `pageSize` items
 *  immediately preceding `olderCursor`) so exponential step growth across sparse gaps never leaves
 *  unread rows between the returned slice and `olderCursor`. */
async function readOlderSlice<E extends OffsetEvent>(
  readEvents: ReadEventsAfter<E>,
  scanFrom: number,
  olderCursor: number,
  pageSize: number,
): Promise<{ slice: readonly E[]; nextOlderCursor: number }> {
  const firstBatch = await readEvents(scanFrom, pageSize);
  const firstBelow = firstBatch.filter((e) => e.offset <= olderCursor);
  if (firstBelow.length === 0) {
    return { slice: [], nextOlderCursor: scanFrom };
  }
  const lastFetched = firstBatch.at(-1)!;
  if (firstBatch.length < pageSize || lastFetched.offset >= olderCursor) {
    return { slice: firstBelow, nextOlderCursor: scanFrom };
  }
  let tailBelow: E[] = [...firstBelow];
  let cursor = lastFetched.offset;
  while (cursor < olderCursor) {
    const batch = await readEvents(cursor, pageSize);
    if (batch.length === 0) break;
    for (const item of batch) {
      if (item.offset <= olderCursor) tailBelow.push(item);
    }
    if (tailBelow.length > pageSize) {
      tailBelow = tailBelow.slice(tailBelow.length - pageSize);
    }
    const batchLast = batch.at(-1)!;
    if (batch.length < pageSize || batchLast.offset >= olderCursor) break;
    cursor = batchLast.offset;
  }
  const lowestKept = tailBelow[0]!.offset;
  return { slice: tailBelow, nextOlderCursor: Math.max(0, lowestKept - 1) };
}

type HistoryWindow<E extends OffsetEvent> = {
  events: readonly E[];
  /** Highest offset below `events` proven to have no unread gap up to `events[0]`. */
  olderCursor: number;
  olderStep: number;
  olderExhausted: boolean;
  olderLoading: boolean;
  olderFailed: boolean;
  newerLoading: boolean;
  newerFailed: boolean;
  /** Highest offset covered by `events` (or proven empty at the time of a read). */
  provenUpTo: number;
  /** True only when `tailEvents` is empty and forward reads hit EOF of the log. */
  reachedEof: boolean;
  revealOffset?: number;
};

export function useWindowedEventPager<E extends OffsetEvent>({
  tailEvents,
  tailOlder = OLDER_EXHAUSTED,
  readEvents,
  pageSize = 80,
  maxHeldEvents = 3_000,
}: {
  tailEvents: readonly E[];
  tailOlder?: OlderPages;
  readEvents?: ReadEventsAfter<E>;
  pageSize?: number;
  maxHeldEvents?: number;
}): {
  events: readonly E[];
  older: OlderPages;
  newer: NewerPages;
  attachedToHead: boolean;
  reveal: number | undefined;
  openAt: (targetOffset: number) => Promise<void>;
  jumpToLatest: () => void;
} {
  const safePageSize = Math.max(1, pageSize);
  const safeMaxHeld = Math.max(1, maxHeldEvents);
  const [history, setHistory] = useState<HistoryWindow<E> | null>(null);
  const [tailReveal, setTailReveal] = useState<number | undefined>(undefined);
  const generationRef = useRef(0);
  const tailRef = useRef(tailEvents);

  useLayoutEffect(() => {
    tailRef.current = tailEvents;
  }, [tailEvents]);

  const tailFirst = tailEvents[0]?.offset;
  let isCaughtUp = true;
  if (history) {
    if (tailFirst !== undefined) {
      isCaughtUp = history.provenUpTo >= tailFirst - 1;
    } else {
      isCaughtUp = history.reachedEof;
    }
  }

  const jumpToLatest = useCallback(() => {
    generationRef.current += 1;
    setTailReveal(undefined);
    setHistory(null);
  }, []);

  const openAt = useCallback(
    async (targetOffset: number) => {
      const currentTail = tailRef.current;
      const currentFirst = currentTail[0]?.offset;
      const currentLast = currentTail.at(-1)?.offset;
      if (
        currentFirst !== undefined &&
        currentLast !== undefined &&
        targetOffset >= currentFirst &&
        targetOffset <= currentLast
      ) {
        const snappedInTail =
          currentTail.find((e) => e.offset >= targetOffset)?.offset ?? targetOffset;
        generationRef.current += 1;
        setHistory(null);
        setTailReveal(snappedInTail);
        return;
      }
      if (!readEvents) {
        setTailReveal(targetOffset);
        return;
      }

      const gen = ++generationRef.current;
      // Advancing `generationRef` cancels any in-flight `older`/`newer` page read, so clear its
      // loading flag immediately — otherwise a failing `openAt` would leave paging stuck loading.
      setHistory((prev) =>
        prev && (prev.olderLoading || prev.newerLoading)
          ? { ...prev, olderLoading: false, newerLoading: false }
          : prev,
      );
      const anchorProbe = await readEvents(Math.max(0, targetOffset - 1), 1);
      if (gen !== generationRef.current) return;
      const snappedAnchor = anchorProbe[0]?.offset ?? targetOffset;
      const backStep = Math.min(snappedAnchor, safePageSize);
      const backStart = Math.max(0, snappedAnchor - backStep);
      // Capture `tailFirstBeforeSlice` BEFORE dispatching `afterSlice` so a short read only raises
      // `provenUpTo` to an offset that already existed before the read began (never to a newer
      // rolling-tail start that arrived while the read was in flight).
      const tailFirstBeforeSlice = tailRef.current[0]?.offset;
      const [beforeSlice, afterSlice] = await Promise.all([
        readEvents(backStart, safePageSize),
        readEvents(Math.max(0, snappedAnchor - 1), safePageSize),
      ]);
      if (gen !== generationRef.current) return;

      const unbounded = mergeEventsByOffset(beforeSlice, afterSlice);
      const combined = trimAroundOffset(unbounded, safeMaxHeld, snappedAnchor);
      const lowestKept = combined[0]?.offset;
      const droppedOlder = lowestKept !== undefined && lowestKept > (unbounded[0]?.offset ?? 0);
      const initialOlderCursor = droppedOlder ? Math.max(backStart, lowestKept - 1) : backStart;
      const combinedLast = combined.at(-1)?.offset;
      const unboundedLast = unbounded.at(-1)?.offset;
      const keptForwardEdge = combinedLast === unboundedLast;
      let provenUpTo = combinedLast ?? initialOlderCursor;
      if (
        keptForwardEdge &&
        afterSlice.length < safePageSize &&
        tailFirstBeforeSlice !== undefined
      ) {
        provenUpTo = Math.max(provenUpTo, tailFirstBeforeSlice - 1);
      }

      setTailReveal(undefined);
      setHistory({
        events: combined,
        olderCursor: initialOlderCursor,
        olderStep: safePageSize,
        olderExhausted: initialOlderCursor === 0,
        olderLoading: false,
        olderFailed: false,
        newerLoading: false,
        newerFailed: false,
        provenUpTo,
        reachedEof: keptForwardEdge && afterSlice.length < safePageSize,
        revealOffset: snappedAnchor,
      });
    },
    [readEvents, safePageSize, safeMaxHeld],
  );

  const loadHistoryOlder = useCallback(() => {
    if (!readEvents) return;
    setHistory((prev) => {
      // Serialize `older` and `newer` reads so concurrent capacity trims cannot create an internal gap.
      if (
        !prev ||
        prev.olderLoading ||
        prev.newerLoading ||
        prev.olderExhausted ||
        prev.olderFailed
      ) {
        return prev;
      }
      const gen = generationRef.current;
      const scanFrom = Math.max(0, prev.olderCursor - prev.olderStep);
      const targetCursor = prev.olderCursor;
      const currentStep = prev.olderStep;
      void readOlderSlice(readEvents, scanFrom, targetCursor, safePageSize).then(
        ({ slice, nextOlderCursor }) => {
          if (gen !== generationRef.current) return;
          setHistory((curr) => {
            if (!curr) return null;
            if (curr.olderCursor !== targetCursor) {
              return curr.olderLoading ? { ...curr, olderLoading: false } : curr;
            }
            const unbounded = mergeEventsByOffset(slice, curr.events);
            const droppedNewer = unbounded.length > safeMaxHeld;
            const merged = trimEventWindow(unbounded, safeMaxHeld, "start");
            const mergedLast = merged.at(-1)?.offset;
            return {
              ...curr,
              events: merged,
              olderCursor: nextOlderCursor,
              olderStep: slice.length === 0 ? currentStep * 2 : safePageSize,
              olderExhausted: nextOlderCursor === 0,
              olderLoading: false,
              provenUpTo: droppedNewer ? (mergedLast ?? nextOlderCursor) : curr.provenUpTo,
              reachedEof: droppedNewer ? false : curr.reachedEof,
            };
          });
        },
        () => {
          if (gen !== generationRef.current) return;
          setHistory((curr) =>
            curr ? { ...curr, olderLoading: false, olderFailed: true, olderExhausted: true } : null,
          );
        },
      );
      return { ...prev, olderLoading: true };
    });
  }, [readEvents, safePageSize, safeMaxHeld]);

  const loadHistoryNewer = useCallback(() => {
    if (!readEvents) return;
    setHistory((prev) => {
      if (!prev || prev.olderLoading || prev.newerLoading || prev.newerFailed) return prev;
      const tailFirstBeforeRead = tailRef.current[0]?.offset;
      const alreadyBridged =
        tailFirstBeforeRead !== undefined
          ? prev.provenUpTo >= tailFirstBeforeRead - 1
          : prev.reachedEof;
      if (alreadyBridged) return prev;
      const highest = Math.max(prev.events.at(-1)?.offset ?? prev.olderCursor, prev.provenUpTo);
      const gen = generationRef.current;
      void readEvents(highest, safePageSize).then(
        (fetched) => {
          if (gen !== generationRef.current) return;
          setHistory((curr) => {
            if (!curr) return null;
            const currHighest = Math.max(
              curr.events.at(-1)?.offset ?? curr.olderCursor,
              curr.provenUpTo,
            );
            if (currHighest !== highest) {
              return curr.newerLoading ? { ...curr, newerLoading: false } : curr;
            }
            const unbounded = mergeEventsByOffset(curr.events, fetched);
            const merged = trimEventWindow(unbounded, safeMaxHeld, "end");
            const droppedOlder = unbounded.length > merged.length;
            const lowestKept = merged[0]?.offset;
            const mergedLast = merged.at(-1)?.offset;
            const hitEof = fetched.length < safePageSize;
            let provenUpTo = mergedLast ?? curr.provenUpTo;
            if (hitEof && tailFirstBeforeRead !== undefined) {
              provenUpTo = Math.max(provenUpTo, tailFirstBeforeRead - 1);
            }
            return {
              ...curr,
              events: merged,
              olderCursor:
                droppedOlder && lowestKept !== undefined
                  ? Math.max(curr.olderCursor, lowestKept - 1)
                  : curr.olderCursor,
              olderExhausted: curr.olderExhausted && !droppedOlder,
              newerLoading: false,
              provenUpTo,
              reachedEof: hitEof,
            };
          });
        },
        () => {
          if (gen !== generationRef.current) return;
          setHistory((curr) => (curr ? { ...curr, newerLoading: false, newerFailed: true } : null));
        },
      );
      return { ...prev, newerLoading: true };
    });
  }, [readEvents, safePageSize, safeMaxHeld]);

  const older: OlderPages = useMemo(() => {
    if (!history) return tailOlder;
    return {
      loadOlder: loadHistoryOlder,
      loading: history.olderLoading,
      exhausted: history.olderExhausted,
      ...(history.olderFailed && { failed: true }),
    };
  }, [history, tailOlder, loadHistoryOlder]);

  const newer: NewerPages = useMemo(() => {
    if (isCaughtUp || !history) return NEWER_EXHAUSTED;
    return {
      loadNewer: loadHistoryNewer,
      loading: history.newerLoading,
      exhausted: false,
      ...(history.newerFailed && { failed: true }),
    };
  }, [isCaughtUp, history, loadHistoryNewer]);

  const events = useMemo(() => {
    if (!history) return tailEvents;
    if (!isCaughtUp) return history.events;
    return mergeEventsByOffset(history.events, tailEvents);
  }, [history, isCaughtUp, tailEvents]);

  return {
    events,
    older,
    newer,
    attachedToHead: isCaughtUp,
    reveal: history ? history.revealOffset : tailReveal,
    openAt,
    jumpToLatest,
  };
}
