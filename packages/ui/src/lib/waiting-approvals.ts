// waiting-approvals.ts — WHAT WAITS FOR A MEMBER'S YES IN A MIND, read through the page's own
// `read`: for the count a Dash shows on every page of the mind (the alert in the sidebar,
// `ApprovalsAlert`, and the number in the tab's title). A page with an app client passes its
// `read`; a page that holds one `itx` passes `(ask) => ask(itx)`. It answers what waits and no
// more: the decisions and the rules of a mind are whole only in the log of every secret, and a
// page that lists them reads the secrets it shows.
//
// WHAT IS READ. The mind's catalog (`itx.contexts.list`) counts each context's events by type, in
// one call that wakes no other context. A secret's request can wait only when its log holds an
// `approval-requested` event, so only the secrets whose row counts one are read, and a mind where
// no secret was ever asked about reads no secret at all. Each log is read on from the offset the
// last ask read through, and a secret whose count of events did not change is not read again.
// Never more than a few logs at a time, so the page's own reads do not wait behind these.
//
// WHAT IS NEVER READ. Not the log of every secret: on one mind that was 358 logs with half a
// million events, 49 MB at every page load (16 November 2026). So there is no second way to find
// the secrets: when the catalog cannot be asked, the ask fails and the count keeps its last value.
// And not `itx.secrets.list()`, which asks the vault to describe each path, one call into the
// vault for every secret ever made: a shell that asked that on a timer filled the vault's memory
// (12 November 2026).
import { useSyncExternalStore } from "react";
import type { AuthenticatedApp } from "iterate/app";
import { z } from "zod";
import { mindApprovalsOf, type LogEvent } from "./approvals.ts";
import { heldActsOf, proposedRulesOf } from "./held-acts.ts";

type Read = AuthenticatedApp["read"];

/** At most this many logs are read at the same time, and a log's pages are this far apart: a
 *  shell's reads share the page's socket, and the page's own reads come first. */
const pace = { logsAtOnce: 3, pauseBetweenPagesMs: 50 };

const REQUESTED = "events.iterate.com/secret/approval-requested";
/** What `approvalsOf` folds into the requests that wait: the rest of a secret's log is not kept. */
const FOLDED = new Set([
  REQUESTED,
  "events.iterate.com/secret/request-approved",
  "events.iterate.com/secret/request-rejected",
]);
const UsedWithDigest = z.object({ digest: z.string() });
const keptOfSecret = (event: LogEvent) =>
  FOLDED.has(event.type) ||
  (event.type === "events.iterate.com/secret/used" &&
    UsedWithDigest.safeParse(event.payload).success);

/** What `heldActsOf` and `proposedRulesOf` fold. */
const keptOfGate = (event: LogEvent) => event.type.startsWith("events.iterate.com/approval/");

/** What an ask read of one log: the offset it read through, the events kept from it, and for a
 *  secret the catalog's count of its events when it was read. */
type HeldLog = { through: number; events: LogEvent[]; eventCount?: number };

/** WHAT ASKS OF ONE MIND KEEP between them, so that the next one reads only what is new. */
export type HeldApprovals = { gate: HeldLog; secrets: Map<string, HeldLog> };

export const holdNothing = (): HeldApprovals => ({
  gate: { through: 0, events: [] },
  secrets: new Map(),
});

/** `log` read on from where it was read through, one read per page so each answer is plain data.
 *  Only the events that `keep` keeps are held. A read that fails changes nothing. */
async function readOn(
  read: Read,
  path: string,
  log: HeldLog,
  keep: (event: LogEvent) => boolean,
): Promise<HeldLog> {
  const events = [...log.events];
  let after = log.through;
  for (;;) {
    const from = after;
    const page = await read(async (itx) => {
      using context = itx.cd(path);
      return await context.readEvents(from, 1000);
    });
    events.push(...page.events.filter(keep));
    after = Math.max(after, page.scannedThroughOffset);
    if (page.atHead || page.scannedThroughOffset <= from) return { ...log, through: after, events };
    await new Promise((resolve) => setTimeout(resolve, pace.pauseBetweenPagesMs));
  }
}

/** Run `work` on each item, never more than `pace.logsAtOnce` at the same time. Fails as
 *  `Promise.all` does, once every started item is over. */
async function inTurns<T>(items: T[], work: (item: T) => Promise<void>) {
  const queue = [...items];
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(pace.logsAtOnce, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    }),
  );
  for (const result of results) if (result.status === "rejected") throw result.reason;
}

const CatalogRow = z.object({
  path: z.string(),
  eventCount: z.number(),
  eventTypes: z.record(z.string(), z.number()),
});

/** The secrets that ever had a request, with their count of events, from the mind's catalog.
 *  The search is a match on the row's text, so the count of requests is checked too. It throws
 *  when the catalog cannot be asked (the header says why nothing else is tried). */
async function candidatesOf(read: Read): Promise<Map<string, number>> {
  const rows: unknown[] = await read((itx) =>
    itx.contexts.list({ under: "/secrets", search: REQUESTED, limit: 1000 }),
  );
  const candidates = new Map<string, number>();
  for (const row of rows) {
    const parsed = CatalogRow.safeParse(row);
    if (
      parsed.success &&
      // a secret's own path: nothing below one is a secret
      /^\/secrets\/[^/]+$/.test(parsed.data.path) &&
      (parsed.data.eventTypes[REQUESTED] ?? 0) > 0
    )
      candidates.set(parsed.data.path, parsed.data.eventCount);
  }
  return candidates;
}

/** The mind's approvals: the requests that wait by their secret, from the secrets' logs, and the
 *  mails and calls that wait in the gate, from `/approvals`. `served: false` for a mind with no
 *  vault yet. `held` is what the last ask of this mind read: it reads on from there, and keeps what
 *  it read in it. */
export async function readMindApprovals(read: Read, held: HeldApprovals = holdNothing()) {
  // the list is read only once the root is known to be there
  const vault = await read((itx) => itx.rewriteRules.get("itx.secrets"));
  if (!vault?.target) return { served: false as const };
  const candidates = await candidatesOf(read);
  for (const secret of held.secrets.keys())
    if (!candidates.has(secret)) held.secrets.delete(secret);
  const changed = [...candidates].filter(
    ([secret, eventCount]) => held.secrets.get(secret)?.eventCount !== eventCount,
  );
  await inTurns<"gate" | [string, number]>(["gate", ...changed], async (log) => {
    if (log === "gate") {
      // a mind from before the gate has no such context: nothing waits there
      held.gate = await readOn(read, "/approvals", held.gate, keptOfGate).catch(() => held.gate);
      return;
    }
    const [secret, eventCount] = log;
    const before = held.secrets.get(secret) ?? { through: 0, events: [] };
    held.secrets.set(secret, {
      ...(await readOn(read, secret, before, keptOfSecret)),
      eventCount,
    });
  });
  const logs = [...held.secrets]
    .map(([secret, log]) => ({ secret, events: log.events }))
    .sort((a, b) => a.secret.localeCompare(b.secret));
  const now = Date.now();
  return {
    served: true as const,
    waiting: mindApprovalsOf(logs, now).waiting,
    acts: heldActsOf(held.gate.events, now),
    proposed: proposedRulesOf(held.gate.events),
  };
}

/** How often the shell asks again while its tab is in front. An ask is a few small reads: the
 *  catalog, and what is new in the logs that can hold a request. A page that shows the list asks
 *  for itself, a tab that comes to the front asks at once, and a page that decided something asks
 *  at once (`askWaitingApprovals`). */
const ASK_EVERY_MS = 5 * 60_000;

/** An answer this new is not asked for again by a shell that mounts or a tab that comes to the
 *  front: a page that leaves a mind's shell and comes back, or a tab switched to and fro, reads
 *  nothing. */
const FRESH_MS = 10_000;

/** The first ask of a watch waits this long after its first shell subscribed: the page's own
 *  content is read and drawn first. */
const FIRST_ASK_AFTER_MS = 3_000;

/** WHAT THE SHELLS OF ONE MIND SHARE while somebody shows it: the count, and the one read, the one
 *  timer and the one listener for the tab that keep it. */
type Watch = {
  /** The newest `read` a shell gave: a page's client can hand it a new function at each navigation. */
  read: Read;
  /** Undefined until the first answer: nobody knows yet whether anything waits. */
  count: number | undefined;
  /** When the last answer came. */
  answeredAt: number;
  /** What the asks read, so that the next one reads only what is new. */
  held: HeldApprovals;
  listeners: Set<() => void>;
  /** A read runs now. `again`: a page said meanwhile that the list changed, so one more follows. */
  reading: boolean;
  again: boolean;
  stop?: () => void;
  /** ONE FUNCTION FOR THE MIND'S WHOLE LIFE. React subscribes again whenever it is handed a
   *  different function, and a first subscription reads the mind. A function made in the hook's
   *  body is a different one at every render, so the shell would read the mind at every
   *  render. */
  subscribe(changed: () => void): () => void;
  getCount(): number | undefined;
};
const watches = new Map<string, Watch>();

/** Read the mind's approvals into the watch's count. One read at a time: an ask that comes while
 *  one runs starts none, unless it says that the list changed (`afterChange`), and then one more
 *  read follows the one that runs, however many asked. */
async function ask(watch: Watch, afterChange = false) {
  if (watch.reading) {
    watch.again ||= afterChange;
    return;
  }
  watch.reading = true;
  try {
    do {
      watch.again = false;
      // a read that fails keeps the last count: the next one says
      const answer = await readMindApprovals(watch.read, watch.held).catch(() => null);
      if (answer) {
        watch.answeredAt = Date.now();
        // a proposed rule waits for a member too: to sign it or to reject it
        const count = answer.served
          ? answer.waiting.length + answer.acts.length + answer.proposed.length
          : 0;
        if (watch.count !== count) {
          watch.count = count;
          for (const changed of watch.listeners) changed();
        }
      }
    } while (watch.again);
  } finally {
    watch.reading = false;
  }
}

function watchOf(mind: string, read: Read): Watch {
  const held = watches.get(mind);
  if (held) {
    held.read = read;
    return held;
  }
  const listeners = new Set<() => void>();
  const askIfStale = () => {
    if (document.visibilityState === "visible" && Date.now() - watch.answeredAt >= FRESH_MS)
      void ask(watch);
  };
  const watch: Watch = {
    read,
    count: undefined,
    answeredAt: 0,
    held: holdNothing(),
    listeners,
    reading: false,
    again: false,
    subscribe(changed) {
      listeners.add(changed);
      // the first shell starts the watch; a second one of the same mind shares it
      if (!watch.stop) {
        const first = setTimeout(askIfStale, FIRST_ASK_AFTER_MS);
        const timer = setInterval(askIfStale, ASK_EVERY_MS);
        document.addEventListener("visibilitychange", askIfStale);
        watch.stop = () => {
          clearTimeout(first);
          clearInterval(timer);
          document.removeEventListener("visibilitychange", askIfStale);
        };
      }
      return () => {
        listeners.delete(changed);
        if (listeners.size > 0) return;
        watch.stop?.();
        watch.stop = undefined;
      };
    },
    getCount: () => watch.count,
  };
  watches.set(mind, watch);
  return watch;
}

/** Ask now: after a page saw the list change. */
export function askWaitingApprovals(mind: string) {
  const watch = watches.get(mind);
  if (watch) void ask(watch, true);
}

/** How many requests wait for a yes in `mind`. Undefined until the first answer: a page shows
 *  that as not known, never as nothing waiting. */
export function useWaitingApprovals(mind: string, read: Read): number | undefined {
  const watch = watchOf(mind, read);
  return useSyncExternalStore(watch.subscribe, watch.getCount, notKnown);
}

/** The server's HTML has no count. */
const notKnown = () => undefined;

/** The tab's title with the count before it, "(2) Approvals · …", for as long as `count` is known
 *  and not 0. The router writes the title on each navigation, so the count is put back when it
 *  does. */
export function titleWithCount(title: string, count: number | undefined): string {
  const bare = title.replace(/^\(\d+\) /, "");
  return count ? `(${count}) ${bare}` : bare;
}
