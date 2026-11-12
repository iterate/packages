// waiting-approvals.ts — WHAT WAITS FOR A MEMBER'S YES IN A MIND, read through the page's own
// `read`: for an Approvals page, and for the count a Dash shows on every page of the mind (the
// alert in the sidebar, `ApprovalsAlert`, and the number in the tab's title). A page with an app
// client passes its `read`; a page that holds one `itx` passes `(ask) => ask(itx)`.
import { useSyncExternalStore } from "react";
import type { AuthenticatedApp } from "iterate/app";
import { mindApprovalsOf, type LogEvent } from "./approvals.ts";
import { heldActsOf } from "./held-acts.ts";

type Read = AuthenticatedApp["read"];

/** One read per page of a log, so each answer is plain data. */
async function logOf(read: Read, path: string): Promise<LogEvent[]> {
  const events: LogEvent[] = [];
  let after = 0;
  for (;;) {
    const page = await read(async (itx) => {
      using context = itx.cd(path);
      return await context.readEvents(after, 1000);
    });
    events.push(...page.events);
    if (page.atHead || page.scannedThroughOffset <= after) return events;
    after = page.scannedThroughOffset;
  }
}

/** The path of every secret the mind ever had, from the `/secrets` context's own record of its
 *  children: a deleted one too, whose log may still hold a decision. NOT `itx.secrets.list()`,
 *  which asks the vault to describe each path, one call into the vault for every secret ever made:
 *  a shell that asked that on a timer filled the vault's memory (12 November 2026). */
async function secretPaths(read: Read): Promise<string[]> {
  const created = await logOf(read, "/secrets").catch((): LogEvent[] => []);
  const paths = created.flatMap((event) => {
    const child = Object(event.payload).childPath;
    return event.type === "events.iterate.com/itx/child-created" &&
      typeof child === "string" &&
      /^\/secrets\/[^/]+$/.test(child)
      ? [child]
      : [];
  });
  return [...new Set(paths)].sort();
}

/** The mind's approvals: the requests that wait by their secret, from the secrets' logs, and the
 *  mails and calls that wait in the gate, from `/approvals`. `served: false` for a mind with no
 *  vault yet. */
export async function readMindApprovals(read: Read) {
  // the list is read only once the root is known to be there
  const vault = await read((itx) => itx.rewriteRules.get("itx.secrets"));
  if (!vault?.target) return { served: false as const };
  const [secrets, gate] = await Promise.all([
    secretPaths(read),
    // a mind from before the gate has no such context: nothing waits there
    logOf(read, "/approvals").catch((): LogEvent[] => []),
  ]);
  const logs = await Promise.all(
    secrets.map(async (secret) => ({ secret, events: await logOf(read, secret) })),
  );
  const now = Date.now();
  return {
    served: true as const,
    ...mindApprovalsOf(logs, now),
    acts: heldActsOf(gate, now),
  };
}

/** How often the shell asks again while its tab is in front. Each ask reads the log of every
 *  secret, so it is rare: a page that shows the list asks for itself, a tab that comes to the front
 *  asks at once, and a page that decided something asks at once (`askWaitingApprovals`). */
const ASK_EVERY_MS = 5 * 60_000;

/** An answer this new is not asked for again by a shell that mounts or a tab that comes to the
 *  front: a page that leaves a mind's shell and comes back, or a tab switched to and fro, reads
 *  nothing. */
const FRESH_MS = 10_000;

/** WHAT THE SHELLS OF ONE MIND SHARE while somebody shows it: the count, and the one read, the one
 *  timer and the one listener for the tab that keep it. */
type Watch = {
  /** The newest `read` a shell gave: a page's client can hand it a new function at each navigation. */
  read: Read;
  count: number;
  /** When the last answer came. */
  answeredAt: number;
  listeners: Set<() => void>;
  /** A read runs now. `again`: a page said meanwhile that the list changed, so one more follows. */
  reading: boolean;
  again: boolean;
  stop?: () => void;
  /** ONE FUNCTION FOR THE MIND'S WHOLE LIFE. React subscribes again whenever it is handed a
   *  different function, and a first subscription reads the mind. A function made in the hook's
   *  body is a different one at every render, so the shell would read every secret's log at
   *  every render. */
  subscribe(changed: () => void): () => void;
  getCount(): number;
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
      const answer = await readMindApprovals(watch.read).catch(() => null);
      if (answer) {
        watch.answeredAt = Date.now();
        const count = answer.served ? answer.waiting.length + answer.acts.length : 0;
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
    count: 0,
    answeredAt: 0,
    listeners,
    reading: false,
    again: false,
    subscribe(changed) {
      listeners.add(changed);
      // the first shell starts the watch; a second one of the same mind shares it
      if (!watch.stop) {
        askIfStale();
        const timer = setInterval(askIfStale, ASK_EVERY_MS);
        document.addEventListener("visibilitychange", askIfStale);
        watch.stop = () => {
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

/** How many requests wait for a yes in `mind`: 0 until the first answer. */
export function useWaitingApprovals(mind: string, read: Read): number {
  const watch = watchOf(mind, read);
  return useSyncExternalStore(watch.subscribe, watch.getCount, noneWaiting);
}

/** The server's HTML has no count. */
const noneWaiting = () => 0;

/** The tab's title with the count before it, "(2) Approvals · …", for as long as `count` is not 0.
 *  The router writes the title on each navigation, so the count is put back when it does. */
export function titleWithCount(title: string, count: number): string {
  const bare = title.replace(/^\(\d+\) /, "");
  return count > 0 ? `(${count}) ${bare}` : bare;
}
