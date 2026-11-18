// presence.ts — WHO IS HERE NOW in a context, and who is typing, with nothing durable in its log.
//
// WHO IS HERE is the platform's fact, not the pages' word. A page reads a context through a
// subscription: a ROW of the context's subscriptions table whose target is a stub the page's
// session lends (`itx.builtins.rpcStubs.get("subscription:<name>")`, a live callback). The context
// removes the row when the page's socket closes, and the platform stamps the row with who holds it
// (`heldBy`: the principal, and `via.appPage` when an app's page opened it). A PAGE in a
// conversation is a row whose stub is lent now, that a principal holds through an app's page, and
// that hears presence (its `consumes` names `presence/status`): the log's own subscription of a
// chat, one per page, whatever live states the page also follows. A row that no principal holds,
// a script's or a CLI's (no `via`), or one whose stub is no longer lent, is nobody.
//
// WHAT ONLY A PAGE KNOWS is its STATUS: whether it is hidden (`away`), whether its person writes
// (`typing`), and `marks` another page may set (a voice page's "voice", "camera"). A page says it
// in ONE ephemeral event, `presence/status`, which names the page's own row (`subscription`): when
// it changes, and once, a moment later, when a page of another principal appears. No beat. A
// status counts only while its row is a page, and only when the platform's stamp on the event
// says who said it and that is the principal who holds that row: nobody sets another person's
// status, and a closed page's status goes with its row. The stamp says who in two shapes alone
// (`saidBy`): a member's own session (`source.principal`), or a person's one-context view
// (`source.onBehalfOf` with `via.appPage` and no `run` or `call`, as core/itx person-context.ts
// appends it). Code that ran for someone (`run`), a facet's call for them (`call`), a schedule, a
// copy and the platform's own fact are nobody's.
//
// "Typing" lasts 6 s after the status said so, on the mind's clock: a page learns how far its own
// clock is from the mind's from the newest event it has received, so a status that reaches a page
// late is as old as it is. What a principal writes by their own hand ends the typing they said
// before it: their message and the end of their dots are one moment. Only a status newer than it
// says they type again, and their own page says it at the next key.
//
// The parts, no SDK and no router:
//   hereOf            the pages now, by principal: the rows and the lent stubs alone
//   connectPresence   one page: it says its status, folds the others', and holds who is here
//   usePresence       that in a component
//
// A subscription must name the type (`PRESENCE_EVENT_TYPES`): a wildcard never matches an
// ephemeral event.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { labelOf, type ShownPrincipal } from "./principal-label.ts";

/** How a principal is shown in words (lib/principal-label.ts), here too for a page that reads
 *  presence. */
export { labelOf };

/** What a subscription names in `consumes` to hear who is here. */
export const PRESENCE_EVENT_TYPES = ["presence/status"];

/** Whether an event is a page's status: a view of the log (its rows, their count) leaves these out. */
export const isPresenceEvent = (event: { type: string }) => event.type === "presence/status";

/** While its person types a page says so at most this often, and "typing" lasts this long unsaid. */
const TYPING_SAY_MS = 3_000;
const TYPING_TTL_MS = 6_000;
/** A page answers another page's arrival within this long, at a random moment, so that ten pages
 *  do not answer in the same instant. */
const ANSWER_MS = 400;

/** A principal as the platform names one (`source.principal`, a row's `heldBy.principal`). A
 *  row's holder may be a guest: `kind` "guest", with the name they typed in `name` and no email. */
export type PresencePrincipal = ShownPrincipal;

/** A row of the context's subscriptions table (`itx.subscriptions.list()`), as far as presence
 *  reads it. `heldBy`: who holds a live callback's row, by the platform's stamp on the event that
 *  made it, and the app page it was opened through; absent on every other row. */
export type PresenceRow = {
  name: string;
  target: string;
  consumes?: string[];
  heldBy?: { principal: PresencePrincipal; via?: { appPage: string } };
};

/** The key of the rpc stub a row delivers to (`itx.builtins.rpcStubs.get('<key>')…`), if it does:
 *  the row is a session's live callback, connected while the key is lent. */
export function lentStubKey(row: { target: string }): string | undefined {
  return /rpcStubs\.get\((["'])(.+?)\1\)/.exec(row.target)?.[2];
}

/** A principal with pages open here: the names of those pages' rows. */
export type HerePrincipal = PresencePrincipal & {
  pages: string[];
  /** The viewer themselves. */
  me: boolean;
};

/** WHO IS HERE: the principals with a page open now, the others first in the order of their
 *  long label, then the viewer (`me`: their actor id, or their address). */
export function hereOf(
  rows: readonly PresenceRow[],
  rpcStubs: readonly string[],
  me: string | undefined,
): HerePrincipal[] {
  const lent = new Set(rpcStubs);
  const byActor = new Map<string, HerePrincipal>();
  for (const row of rows) {
    const key = lentStubKey(row);
    if (!key || !lent.has(key) || !row.heldBy?.via || !row.consumes?.includes("presence/status"))
      continue;
    const { principal } = row.heldBy;
    const held = byActor.get(principal.actor);
    if (held) held.pages.push(row.name);
    else
      byActor.set(principal.actor, {
        ...principal,
        pages: [row.name],
        me: isViewer(principal, me),
      });
  }
  return [...byActor.values()].sort(
    (a, b) => Number(a.me) - Number(b.me) || labelOf(a).localeCompare(labelOf(b)),
  );
}

/** Whether `principal` is the viewer, known by their actor id or their address. */
function isViewer(principal: { actor: string; email?: string }, me: string | undefined): boolean {
  if (!me) return false;
  return principal.actor === me || principal.email?.toLowerCase() === me.toLowerCase();
}

/** What a page says of itself. Nothing in it names anybody: the platform's stamp does. */
const Status = z.object({
  subscription: z.string().min(1).max(200),
  away: z.boolean(),
  typing: z.boolean(),
  marks: z.array(z.string().min(1).max(32)).max(8).optional(),
});

/** A stamp of something said now: no schedule fired it, it is no copy and no fact of the platform. */
const SaidNow = z.object({
  schedule: z.undefined().optional(),
  copiedFrom: z.undefined().optional(),
  platform: z.undefined().optional(),
});

const StampPrincipal = z.object({ actor: z.string().min(1), email: z.string().optional() });

/** The stamp of a status: who said it, now, or nothing when no person did. */
const StatusStamp = SaidNow.extend({
  principal: StampPrincipal.optional(),
  onBehalfOf: z
    .object({
      principal: z.object({ actor: z.string().min(1) }),
      via: z.object({ appPage: z.string() }),
      run: z.undefined().optional(),
      call: z.undefined().optional(),
    })
    .optional(),
});

/** The actor whose page said a status, by the platform's stamp on it (`source`): a member's own
 *  session, or a person's one-context view. Anything else, both at once included, is nobody's. */
function saidBy(source: unknown): string | undefined {
  const stamp = StatusStamp.safeParse(source);
  if (!stamp.success) return undefined;
  const { principal, onBehalfOf } = stamp.data;
  if (principal && !onBehalfOf) return principal.actor;
  if (onBehalfOf && !principal) return onBehalfOf.principal.actor;
  return undefined;
}

/** The stamp of an event a principal wrote by their own hand: their own session, or a call or a
 *  view for them. Code that ran for them (`run`) is not their hand. */
const AuthorStamp = SaidNow.extend({
  principal: StampPrincipal.optional(),
  onBehalfOf: z.object({ principal: StampPrincipal, run: z.undefined().optional() }).optional(),
});

/** Who wrote an event by their own hand, by the platform's stamp on it, if a principal did. */
function writtenBy(source: unknown): z.infer<typeof StampPrincipal> | undefined {
  const stamp = AuthorStamp.safeParse(source);
  if (!stamp.success) return undefined;
  return stamp.data.principal || stamp.data.onBehalfOf?.principal;
}

/** An event of a context's log, as far as presence reads it. */
export type PresenceEvent = {
  type: string;
  createdAt: string;
  payload?: unknown;
  source?: unknown;
};

const statusKey = (actor: string, subscription: string) => `${actor}\n${subscription}`;

/** The key of each page's status: its holder and its row. */
const pageKeysOf = (here: readonly HerePrincipal[]) =>
  here.flatMap((principal) => principal.pages.map((name) => statusKey(principal.actor, name)));

/** One principal who is here, with what their pages said of themselves. */
export type PresentPrincipal = PresencePrincipal & {
  /** How many pages of theirs are open here. */
  pages: number;
  /** `away` when every page of theirs is hidden. */
  state: "active" | "away";
  typing: boolean;
  /** Every mark one of their pages set. */
  marks: string[];
  me: boolean;
};

/** What a page tells presence about itself. A test passes its own. */
export type PresencePage = {
  visible(): boolean;
  /** `changed` when the page is hidden or shown. */
  watch(changed: () => void): () => void;
};

/** The page as the browser has it. A page starts in an effect, so only a browser reads this. */
const browserPage: PresencePage = {
  visible: () => document.visibilityState !== "hidden",
  watch(changed) {
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  },
};

/** One event as a page appends it. */
type PresenceSend = (event: {
  type: string;
  ephemeral: true;
  payload: Record<string, unknown>;
}) => Promise<unknown> | void;

const NOBODY: readonly PresentPrincipal[] = [];

type PresenceOfPage = {
  /** Who is here now, as a render reads it: the same array until it changes. */
  get(): readonly PresentPrincipal[];
  subscribe(listener: () => void): () => void;
  /** The subscriptions table and the stubs lent now, each time either is read again. */
  see(rows: readonly PresenceRow[], rpcStubs: readonly string[]): void;
  /** The context's events as the page holds them, in log order: what is new is folded. An array
   *  that did not only grow at its end (older rows read, a new session's rows) is folded again
   *  from its start. */
  take(events: readonly PresenceEvent[]): void;
  /** The person types, or has stopped (sent, or emptied the box). */
  typing(isTyping: boolean): void;
  /** The page's marks; a change is said. */
  mark(marks: readonly string[]): void;
  /** Start saying this page's status: `send` appends one event to the context, `subscription` is
   *  the name of the page's own row. */
  start(send: PresenceSend, subscription: string): void;
  /** Stop saying it. What the page heard still ends on time. */
  stop(): void;
  /** Stop saying and hearing: every timer ends. For the end of the page. */
  close(): void;
};

/** The newest status of a page, by the principal who said it and the row it names. */
type HeardStatus = z.infer<typeof Status> & { at: number };

/** ONE PAGE in a context: what it says of itself, and who it sees. Nothing is said until `start`.
 *  `me` is the viewer's actor id or address. */
export function connectPresence(opts: { me?: string; page?: PresencePage } = {}): PresenceOfPage {
  const now = Date.now;
  const page = opts.page || browserPage;
  let here: HerePrincipal[] = [];
  let statuses = new Map<string, HeardStatus>();
  /** When each principal last wrote by their own hand, on the mind's clock, by actor. */
  let wrote = new Map<string, number>();
  let present = NOBODY;
  /** What was folded last: the array's first and last event and how many it held. */
  let folded: { first?: PresenceEvent; last?: PresenceEvent; count: number } = { count: 0 };
  /** The mind's clock minus this page's, by the freshest event received; none received: none. */
  let ahead: number | undefined;
  let saying: { send: PresenceSend; subscription: string } | undefined;
  /** The other principals' pages this page has said its status to. */
  let greeted = new Set<string>();
  let marks: readonly string[] = [];
  let typingUntil = 0;
  let typingSaidAt = 0;
  let answerTimer: ReturnType<typeof setTimeout> | undefined;
  let clockTimer: ReturnType<typeof setTimeout> | undefined;
  let unwatch: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const publish = () => {
    // the mind's clock
    const at = now() + (ahead || 0);
    const next = here.map(({ pages, ...principal }): PresentPrincipal => {
      // a status counts when the principal who holds the row said it
      const said = pages.flatMap((name) => statuses.get(statusKey(principal.actor, name)) || []);
      return {
        ...principal,
        pages: pages.length,
        state:
          said.length === pages.length && said.every((status) => status.away) ? "away" : "active",
        // a status counts for typing while it is fresh and newer than what they wrote last
        typing: said.some(
          (status) =>
            status.typing &&
            status.at + TYPING_TTL_MS > at &&
            status.at > (wrote.get(principal.actor) || 0),
        ),
        marks: [...new Set(said.flatMap((status) => status.marks || []))],
      };
    });
    clearTimeout(clockTimer);
    const ends = [...statuses.values()]
      .filter((status) => status.typing)
      .map((status) => status.at + TYPING_TTL_MS)
      .filter((end) => end > at);
    if (ends.length > 0) clockTimer = setTimeout(publish, Math.min(...ends) - at + 5);
    if (JSON.stringify(next) === JSON.stringify(present)) return;
    present = next;
    for (const listener of listeners) listener();
  };
  const say = () => {
    if (!saying) return;
    const { send, subscription } = saying;
    const typing = typingUntil > now();
    if (typing) typingSaidAt = now();
    const payload = {
      subscription,
      away: !page.visible(),
      typing,
      ...(marks.length > 0 && { marks: [...marks] }),
    };
    // presence is best effort: a status that is refused or lost is made good by the next
    void Promise.resolve()
      .then(() => send({ type: "presence/status", ephemeral: true, payload }))
      .catch(() => {});
  };
  /** Another principal's page that this page has not yet said its status to: say it, soon. A page
   *  that went is forgotten, so it is greeted again when it comes back under the same name. */
  const greet = () => {
    if (!saying) return;
    const others = here
      .filter((principal) => !principal.me)
      .flatMap((principal) => principal.pages);
    const newcomer = others.some((name) => !greeted.has(name));
    greeted = new Set(others);
    if (!newcomer) return;
    answerTimer ||= setTimeout(() => {
      answerTimer = undefined;
      say();
    }, Math.random() * ANSWER_MS);
  };

  const stop = () => {
    saying = undefined;
    unwatch?.();
    unwatch = undefined;
    clearTimeout(answerTimer);
    answerTimer = undefined;
  };

  return {
    get: () => present,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    see(rows, rpcStubs) {
      const before = pageKeysOf(here);
      here = hereOf(rows, rpcStubs, opts.me);
      // a page that went takes its status with it
      const after = new Set(pageKeysOf(here));
      for (const key of before) if (!after.has(key)) statuses.delete(key);
      greet();
      publish();
    },
    take(events) {
      const grewAtEnd =
        folded.count > 0 && events[0] === folded.first && events[folded.count - 1] === folded.last;
      if (grewAtEnd && events.length === folded.count) return;
      // another array than the one that only grew: everything in it is read again, from nothing
      if (!grewAtEnd) {
        statuses = new Map();
        wrote = new Map();
      }
      const fresh = grewAtEnd ? events.slice(folded.count) : events;
      folded = { first: events[0], last: events.at(-1), count: events.length };
      const arrivedAt = now();
      for (const event of fresh) {
        const at = Date.parse(event.createdAt);
        if (!Number.isFinite(at)) continue;
        // the freshest event tells how far the mind's clock is ahead of this page's
        ahead = Math.max(ahead ?? -Infinity, at - arrivedAt);
        if (!isPresenceEvent(event)) {
          const author = writtenBy(event.source);
          if (!author) continue;
          wrote.set(author.actor, Math.max(wrote.get(author.actor) || 0, at));
          // the viewer's own words ended the typing this page said: the next key says it anew
          if (isViewer(author, opts.me)) typingSaidAt = 0;
          continue;
        }
        const actor = saidBy(event.source);
        const status = Status.safeParse(event.payload);
        if (!actor || !status.success) continue;
        const key = statusKey(actor, status.data.subscription);
        if ((statuses.get(key)?.at || 0) > at) continue;
        statuses.set(key, { ...status.data, at });
      }
      publish();
    },
    typing(isTyping) {
      const was = typingUntil > now();
      typingUntil = isTyping ? now() + TYPING_TTL_MS : 0;
      if (isTyping ? now() - typingSaidAt >= TYPING_SAY_MS : was) say();
      if (!isTyping) typingSaidAt = 0;
    },
    mark(next) {
      if (JSON.stringify(next) === JSON.stringify(marks)) return;
      marks = next;
      say();
    },
    start(send, subscription) {
      saying = { send, subscription };
      // a new row of its own: every page there is hears this page's status anew
      greeted = new Set();
      unwatch = page.watch(say);
      greet();
    },
    stop,
    close() {
      stop();
      clearTimeout(clockTimer);
    },
  };
}

const NO_MARKS: readonly string[] = [];

/** WHO IS HERE in the context whose subscriptions table (`rows`), lent stubs (`rpcStubs`) and
 *  `events` a page holds, seen by `me`. While `enabled` is false the page says nothing and sees
 *  nobody. With `send` (appending as the signed-in principal, the page's own session) and the
 *  name of the page's own row (`subscription`), the page also says its status: `typing(true)` on
 *  each change of what the person writes, `typing(false)` once it is sent or emptied. */
export function usePresence(opts: {
  enabled: boolean;
  rows: readonly PresenceRow[];
  rpcStubs: readonly string[];
  events: readonly PresenceEvent[];
  send: ((events: unknown[]) => Promise<unknown>) | undefined;
  me: string | undefined;
  subscription: string | undefined;
  marks?: readonly string[];
}): { present: readonly PresentPrincipal[]; typing: (isTyping: boolean) => void } {
  const { enabled, rows, rpcStubs, events, send, me, subscription, marks = NO_MARKS } = opts;
  const [held, setHeld] = useState(() => ({ me, presence: connectPresence({ me }) }));
  // another viewer sees another picture: made during render, as React asks of state that follows a prop
  const presence = held.me === me ? held.presence : connectPresence({ me });
  if (presence !== held.presence) setHeld({ me, presence });
  // the newest `send` is the one a status uses, and a new one never restarts the page
  const sender = useRef(send);
  useEffect(() => {
    sender.current = send;
  }, [send]);
  const saying = enabled && Boolean(send) && subscription ? subscription : undefined;
  // what the page SAYS follows its own row: a new row, or none, ends it
  useEffect(() => {
    if (!saying) return;
    presence.start((event) => sender.current?.([event]), saying);
    return () => presence.stop();
  }, [presence, saying]);
  // what it HEARS lives as long as the store: the timer that ends a heard typing stops with it
  useEffect(() => () => presence.close(), [presence]);
  // `mark` says a change only: a new array of the same marks says nothing
  useEffect(() => {
    presence.mark(marks);
  }, [presence, marks]);
  useEffect(() => {
    if (enabled) presence.see(rows, rpcStubs);
  }, [presence, enabled, rows, rpcStubs]);
  // before paint: a message and the end of its writer's dots are drawn in one frame
  useLayoutEffect(() => {
    if (enabled) presence.take(events);
  }, [presence, enabled, events]);
  const present = useSyncExternalStore(presence.subscribe, presence.get, () => NOBODY);
  return { present: enabled ? present : NOBODY, typing: presence.typing };
}
