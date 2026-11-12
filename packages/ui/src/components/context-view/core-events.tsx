// What the view knows of the platform's own events, which every context's log carries whatever the
// app: which of them are the stream's upkeep (a run of those folds into one row), and the
// inspector's bodies for a script run.
import { record, str } from "./payload-readers.ts";
import type { ContextViewEvent, EventInspectors } from "./types.tsx";

/** An agent keeping itself ready: a voice call's warm-ups, and the pings of an idle agent. Warming
 *  that stopped is not one of these: it says the cache was missed, or its budget ran out. */
const KEEPING_WARM = new Set([
  "events.iterate.com/agent/warm-up-requested",
  "events.iterate.com/agent/cache-kept-warm",
  "events.iterate.com/agent/idle-check",
]);

/** The stream's UPKEEP: what it does to keep itself running (waking, wiring a client's
 *  subscription, a live-state tick, a scheduled append, an agent keeping warm), never what anyone
 *  did. A run of these folds into one row, whatever their types. The birth, a pause and a script
 *  run are not upkeep. */
export function isUpkeep({ type, payload }: Pick<ContextViewEvent, "type" | "payload">) {
  return (
    type === "events.iterate.com/itx/woken" ||
    type.startsWith("events.iterate.com/itx/subscription-") ||
    type.startsWith("events.iterate.com/itx/schedule-") ||
    type === "events.iterate.com/itx/live-state-changed" ||
    (KEEPING_WARM.has(type) && !record(payload).stopped)
  );
}

/** The inspector's rich bodies for the platform's events: a script run's code, its result. */
export const coreEventInspectors: EventInspectors = {
  "events.iterate.com/itx/run-requested": (e) => (
    <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-words">
      {str(record(e.payload).code)}
    </pre>
  ),
  "events.iterate.com/itx/run-settled": (e) => {
    const s = record(record(e.payload).settlement);
    return s.status === "succeeded" ? (
      <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-words">
        {JSON.stringify(s.result ?? null, null, 2)}
      </pre>
    ) : (
      <p data-type="error" className="text-sm text-destructive">
        {str(s.failureKind)}: {str(s.error)}
      </p>
    );
  },
};
