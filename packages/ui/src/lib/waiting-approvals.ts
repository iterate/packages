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

/** The mind's approvals: the requests that wait by their secret, from the secrets' logs, and the
 *  mails and calls that wait in the gate, from `/approvals`. `served: false` for a mind with no
 *  vault yet. */
export async function readMindApprovals(read: Read) {
  // the list is read only once the root is known to be there
  const vault = await read((itx) => itx.rewriteRules.get("itx.secrets"));
  if (!vault?.target) return { served: false as const };
  const [secrets, gate] = await Promise.all([
    read((itx) => itx.secrets.list()),
    // a mind from before the gate has no such context: nothing waits there
    logOf(read, "/approvals").catch((): LogEvent[] => []),
  ]);
  const logs = await Promise.all(
    secrets.map(async (secret) => ({
      secret: secret.path,
      events: await logOf(read, secret.path),
    })),
  );
  const now = Date.now();
  return {
    served: true as const,
    ...mindApprovalsOf(logs, now),
    acts: heldActsOf(gate, now),
  };
}

/** How often the shell asks again while its tab is in front. */
const ASK_EVERY_MS = 30_000;

/** How many requests wait, per mind, asked while somebody shows it: a small store, so the shell
 *  reads it with `useSyncExternalStore` and a page that decided something can ask again at once. */
const counts = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();
const readers = new Map<string, Read>();

async function ask(mind: string) {
  const read = readers.get(mind);
  if (!read) return;
  // a read that fails keeps the last count: the next one says
  const answer = await readMindApprovals(read).catch(() => null);
  if (!answer) return;
  const count = answer.served ? answer.waiting.length + answer.acts.length : 0;
  if (counts.get(mind) === count) return;
  counts.set(mind, count);
  for (const changed of listeners.get(mind) || []) changed();
}

/** Ask now: after a page saw the list change. */
export function askWaitingApprovals(mind: string) {
  void ask(mind);
}

/** How many requests wait for a yes in `mind`: 0 until the first answer. */
export function useWaitingApprovals(mind: string, read: Read): number {
  return useSyncExternalStore(
    (changed) => {
      readers.set(mind, read);
      const of = listeners.get(mind) || new Set();
      listeners.set(mind, of);
      of.add(changed);
      void ask(mind);
      const timer = setInterval(() => {
        if (document.visibilityState === "visible") void ask(mind);
      }, ASK_EVERY_MS);
      const front = () => {
        if (document.visibilityState === "visible") void ask(mind);
      };
      document.addEventListener("visibilitychange", front);
      return () => {
        of.delete(changed);
        clearInterval(timer);
        document.removeEventListener("visibilitychange", front);
      };
    },
    () => counts.get(mind) || 0,
    () => 0,
  );
}

/** The tab's title with the count before it, "(2) Approvals · …", for as long as `count` is not 0.
 *  The router writes the title on each navigation, so the count is put back when it does. */
export function titleWithCount(title: string, count: number): string {
  const bare = title.replace(/^\(\d+\) /, "");
  return count > 0 ? `(${count}) ${bare}` : bare;
}
