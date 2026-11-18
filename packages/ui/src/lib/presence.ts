// presence.ts — WHO IS HERE NOW in a context, and who is typing, with nothing durable in its log.
// Each open page of a signed-in principal is a SEAT. A seat says `presence/here` as an EPHEMERAL
// event on the context: when it arrives, on a beat while it stays, when its page is hidden or shown
// again, and while its person types. It says `presence/gone` when the page closes. An ephemeral
// event is never stored, so the log holds no row of any of this.
//
// WHO A SEAT IS comes from the platform's stamp on the event, `source.principal`: the principal
// whose own session appended it. Nothing in the payload names anybody, and an event that code
// appended for someone (`source.onBehalfOf`), that a schedule fired, that a row copied, or that
// carries no stamp, is no seat. A principal is a person today; the platform may name another kind
// (`kind`).
//
// WHEN is the mind's clock, never a page's: a seat is here for some time after the `createdAt` of
// what it last said. A page learns how far its own clock is from the mind's from the newest event
// it has received. So events that reach a page late (a tab that was hidden gets everything at
// once when it is shown) are as old as they are: no face for a page long gone.
//
// Three plain parts, no SDK and no router:
//   observePresence / presentOf   the fold: seats from events, and the principals present at a time
//   connectPresence               one page's seat: it sends the beats and holds the fold as a store
//   usePresence                   the store in a component
//
// A subscription must name the two types (`PRESENCE_EVENT_TYPES`): a wildcard never matches an
// ephemeral event. A beat that is lost is made good by the next one; a page that vanishes without
// a `gone` is taken for gone when its last beat is too old.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";

export const PRESENCE_HERE = "presence/here";
export const PRESENCE_GONE = "presence/gone";
/** What a subscription names in `consumes` to hear who is here. */
export const PRESENCE_EVENT_TYPES = [PRESENCE_HERE, PRESENCE_GONE];

/** Whether an event is a seat's: a view of the log (its rows, their count) leaves these out. */
export const isPresenceEvent = (event: { type: string }) =>
  event.type === PRESENCE_HERE || event.type === PRESENCE_GONE;

/** A page in view says it is here this often. */
const ACTIVE_BEAT_MS = 20_000;
/** A hidden page says so this often: a browser runs its timers about once a minute. */
const AWAY_BEAT_MS = 60_000;
/** While its person types a seat says so at most this often, and "typing" lasts this long unsaid. */
const TYPING_BEAT_MS = 3_000;
const TYPING_TTL_MS = 6_000;
/** A seat answers another seat's arrival within this long, at a random moment, so that a new page
 *  sees who is here at once and ten pages do not answer in the same instant. */
const HELLO_ANSWER_MS = 400;

/** A principal as the platform names one on an event (`source.principal`). */
export type PresencePrincipal = { actor: string; email?: string; kind?: "mind" };

/** What a seat says of itself. `seat` is this page load and `tab` the browser tab, kept over a
 *  reload: a seat of a tab replaces the tab's earlier seat. Neither is an identity. */
const Here = z.object({
  seat: z.string().min(1).max(64),
  tab: z.string().min(1).max(64),
  state: z.enum(["active", "away"]),
  typing: z.boolean(),
  /** The seat has just arrived and asks the others to say that they are here. */
  hello: z.boolean().optional(),
});
const Gone = z.object({ seat: z.string().min(1).max(64) });

/** The stamp a seat's event must carry: the principal whose own session appended it, now. An
 *  event that code appended for someone, that a schedule fired, that a row copied or that the
 *  platform wrote is no page's. */
const StampedByPrincipal = z.object({
  createdAt: z.string(),
  source: z.object({
    principal: z.object({
      actor: z.string().min(1),
      email: z.string().optional(),
      kind: z.literal("mind").optional(),
    }),
    onBehalfOf: z.undefined().optional(),
    schedule: z.undefined().optional(),
    copiedFrom: z.undefined().optional(),
    platform: z.undefined().optional(),
  }),
});

/** An event of a context's log, as far as presence reads it. */
export type PresenceEvent = {
  type: string;
  createdAt: string;
  payload?: unknown;
  source?: unknown;
};

type Seat = {
  seat: string;
  tab: string;
  principal: PresencePrincipal;
  state: "active" | "away";
  /** The mind's clock: when the seat last said so, until when it is here, and typing until when. */
  saidAt: number;
  hereUntil: number;
  typingUntil: number;
};

/** The seats heard of, by principal and seat: one principal's event never touches another's seat. */
export type PresenceSeats = ReadonlyMap<string, Seat>;

const seatKey = (actor: string, seat: string) => `${actor}\n${seat}`;

/** `seats` after `event`: the same map for an event that is no seat's (another type, no stamp of
 *  a principal, a payload of another shape) and for one older than what its seat said last.
 *  `hello`: the seat has just arrived and asks who is here; `at`: when it said so, on the mind's
 *  clock. */
export function observePresence(
  seats: PresenceSeats,
  event: PresenceEvent,
): { seats: PresenceSeats; hello: boolean; at?: number } {
  const unchanged = { seats, hello: false };
  if (!isPresenceEvent(event)) return unchanged;
  const stamped = StampedByPrincipal.safeParse(event);
  if (!stamped.success) return unchanged;
  const { principal } = stamped.data.source;
  const at = Date.parse(stamped.data.createdAt);
  if (!Number.isFinite(at)) return unchanged;
  if (event.type === PRESENCE_GONE) {
    const gone = Gone.safeParse(event.payload);
    const held = gone.success && seats.get(seatKey(principal.actor, gone.data.seat));
    if (!held || held.saidAt > at) return unchanged;
    const next = new Map(seats);
    next.delete(seatKey(principal.actor, held.seat));
    return { seats: next, hello: false, at };
  }
  const here = Here.safeParse(event.payload);
  if (!here.success) return unchanged;
  const { seat, tab, state, typing, hello } = here.data;
  const key = seatKey(principal.actor, seat);
  if ((seats.get(key)?.saidAt || 0) > at) return unchanged;
  const next = new Map(seats);
  // a reload: the tab's earlier seat is this one now
  for (const [other, held] of seats)
    if (held.principal.actor === principal.actor && held.tab === tab && held.seat !== seat)
      next.delete(other);
  next.set(key, {
    seat,
    tab,
    principal,
    state,
    saidAt: at,
    // taken for gone after two missed beats and a little: 45 s in view, 150 s hidden
    hereUntil: at + (state === "active" ? 45_000 : 150_000),
    typingUntil: typing ? at + TYPING_TTL_MS : 0,
  });
  return { seats: next, hello: Boolean(hello), at };
}

/** One principal who is here: every live seat of theirs as one. */
export type PresentPrincipal = PresencePrincipal & {
  /** How many pages of theirs are open here. */
  seats: number;
  /** `active` when one of them is in view. */
  state: "active" | "away";
  typing: boolean;
  /** The reader themselves. */
  me: boolean;
};

/** The principals with a live seat at `at` on the mind's clock, the others first in the order of
 *  their address or id, then the reader (`me`: their actor id, or their address). */
export function presentOf(
  seats: PresenceSeats,
  at: number,
  me: string | undefined,
): PresentPrincipal[] {
  const byActor = new Map<string, PresentPrincipal>();
  for (const seat of seats.values()) {
    if (seat.hereUntil <= at) continue;
    const { actor, email } = seat.principal;
    const held = byActor.get(actor);
    byActor.set(actor, {
      ...seat.principal,
      seats: (held?.seats || 0) + 1,
      state: held?.state === "active" ? "active" : seat.state,
      typing: Boolean(held?.typing) || seat.typingUntil > at,
      me: Boolean(me) && (actor === me || email?.toLowerCase() === me?.toLowerCase()),
    });
  }
  return [...byActor.values()].sort(
    (a, b) => Number(a.me) - Number(b.me) || labelOf(a).localeCompare(labelOf(b)),
  );
}

/** How a principal is shown where a face needs words: their address, else their id. The same
 *  string gives the face its colour and its initials, so one principal looks the same on every page. */
export const labelOf = (principal: PresencePrincipal) => principal.email || principal.actor;

/** What a page tells the seat about itself. A test passes its own. */
export type PresencePage = {
  visible(): boolean;
  /** `changed` when the page is hidden or shown; `left` when it is about to go for good. */
  watch(changed: () => void, left: () => void): () => void;
};

/** The page as the browser has it. A seat starts in an effect, so only a browser reads this. */
const browserPage: PresencePage = {
  visible: () => document.visibilityState !== "hidden",
  watch(changed, left) {
    // A page that the browser only freezes (a phone's app in the background, the back-forward
    // cache) is kept, and is shown again as it was: it is hidden, not gone.
    const hidden = (event: PageTransitionEvent) => {
      if (!event.persisted) left();
    };
    document.addEventListener("visibilitychange", changed);
    window.addEventListener("pagehide", hidden);
    return () => {
      document.removeEventListener("visibilitychange", changed);
      window.removeEventListener("pagehide", hidden);
    };
  },
};

/** The browser tab's own id, kept over a reload where the page has session storage. A tab that
 *  was duplicated has a copy of that storage: only a reload keeps the id, so two tabs never
 *  share one. */
function tabId(): string {
  const key = "iterate:presence-tab";
  const made = crypto.randomUUID().slice(0, 12);
  try {
    // The cast: the entries of type "navigation" are PerformanceNavigationTiming by the spec, but
    // `getEntriesByType` is typed for every type as PerformanceEntry.
    const [navigation] = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    const held = navigation?.type === "reload" && sessionStorage.getItem(key);
    if (held) return held;
    sessionStorage.setItem(key, made);
  } catch {
    // no storage (a sandboxed frame, a private mode): each load is a tab of its own
  }
  return made;
}

/** One event as a seat appends it. */
type PresenceSend = (event: {
  type: string;
  ephemeral: true;
  payload: Record<string, unknown>;
}) => Promise<unknown> | void;

const NOBODY: readonly PresentPrincipal[] = [];

type PresenceSeat = {
  /** Who is here now, as a render reads it: the same array until it changes. */
  get(): readonly PresentPrincipal[];
  subscribe(listener: () => void): () => void;
  /** The context's events as the page holds them, in log order: what is new is folded. An array
   *  that did not only grow at its end (older rows read, a new session's rows) is folded again
   *  from its start. */
  take(events: readonly PresenceEvent[]): void;
  /** The person types, or has stopped (sent, or emptied the box). */
  typing(isTyping: boolean): void;
  /** Sit down: say hello and beat. `send` appends one event to the context. */
  start(send: PresenceSend): void;
  /** Get up: say gone, and stop every timer. */
  stop(): void;
};

/** ONE PAGE'S SEAT in a context, and what it hears of the others. Nothing runs until `start`.
 *  `me` is the reader's actor id or address. */
export function connectPresence(
  opts: {
    me?: string;
    now?: () => number;
    page?: PresencePage;
    /** The seat's and the tab's ids; made here when not given. */
    ids?: { seat: string; tab: string };
  } = {},
): PresenceSeat {
  const now = opts.now || Date.now;
  const page = opts.page || browserPage;
  let ids = opts.ids;
  let send: PresenceSend | undefined;
  let seats: PresenceSeats = new Map();
  let present = NOBODY;
  /** What was folded last: the array's first and last event and how many it held. */
  let folded: { first?: PresenceEvent; last?: PresenceEvent; count: number } = { count: 0 };
  /** The mind's clock minus this page's, by the freshest event received; none received: none. */
  let ahead: number | undefined;
  let typingUntil = 0;
  let typingSaidAt = 0;
  /** The page said that it goes for good. A browser hides a page after that (`visibilitychange`
   *  follows `pagehide`), and a seat that then said "here, away" would stay for the away time. */
  let gone = false;
  let beatTimer: ReturnType<typeof setTimeout> | undefined;
  let helloTimer: ReturnType<typeof setTimeout> | undefined;
  let clockTimer: ReturnType<typeof setTimeout> | undefined;
  let unwatch: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const publish = () => {
    // the mind's clock
    const at = now() + (ahead || 0);
    // a seat whose time is over is forgotten, so the map holds only who may be here
    const live = new Map([...seats].filter(([, seat]) => seat.hereUntil > at));
    if (live.size !== seats.size) seats = live;
    const next = presentOf(seats, at, opts.me);
    clearTimeout(clockTimer);
    const changes = [...seats.values()]
      .flatMap((seat) => [seat.hereUntil, seat.typingUntil])
      .filter((time) => time > at);
    if (changes.length > 0) clockTimer = setTimeout(publish, Math.min(...changes) - at + 5);
    if (JSON.stringify(next) === JSON.stringify(present)) return;
    present = next;
    for (const listener of listeners) listener();
  };
  const say = (type: string, payload: Record<string, unknown>) => {
    // presence is best effort: a beat that is refused or lost is made good by the next
    const sender = send;
    void Promise.resolve()
      .then(() => sender?.({ type, ephemeral: true, payload }))
      .catch(() => {});
  };
  const beat = (hello = false) => {
    if (!send || !ids) return;
    clearTimeout(beatTimer);
    const visible = page.visible();
    // a page that left says nothing more, unless it is shown after all
    if (gone && !visible) return;
    gone = false;
    const typing = typingUntil > now();
    if (typing) typingSaidAt = now();
    say(PRESENCE_HERE, {
      ...ids,
      state: visible ? "active" : "away",
      typing,
      hello: hello || undefined,
    });
    beatTimer = setTimeout(beat, visible ? ACTIVE_BEAT_MS : AWAY_BEAT_MS);
  };
  const leave = () => {
    gone = true;
    clearTimeout(beatTimer);
    if (send && ids) say(PRESENCE_GONE, { seat: ids.seat });
  };

  return {
    get: () => present,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    take(events) {
      const grewAtEnd =
        folded.count > 0 && events[0] === folded.first && events[folded.count - 1] === folded.last;
      if (grewAtEnd && events.length === folded.count) return;
      // another array than the one that only grew: everything in it is read again, from nobody
      if (!grewAtEnd) seats = new Map();
      const fresh = grewAtEnd ? events.slice(folded.count) : events;
      folded = { first: events[0], last: events.at(-1), count: events.length };
      const arrivedAt = now();
      let asked = false;
      for (const event of fresh) {
        const seen = observePresence(seats, event);
        seats = seen.seats;
        if (seen.at === undefined) continue;
        // the freshest event tells how far the mind's clock is ahead of this page's
        ahead = Math.max(ahead ?? -Infinity, seen.at - arrivedAt);
        // another seat's arrival, in the last 5 s: this one says that it is here, once, a moment
        // later. An arrival read later than that needs no answer any more.
        asked ||= seen.hello && !isOwn(event, ids?.seat) && seen.at > arrivedAt + ahead - 5_000;
      }
      if (asked && send && !helloTimer)
        helloTimer = setTimeout(() => {
          helloTimer = undefined;
          beat();
        }, Math.random() * HELLO_ANSWER_MS);
      publish();
    },
    typing(isTyping) {
      const was = typingUntil > now();
      typingUntil = isTyping ? now() + TYPING_TTL_MS : 0;
      if (isTyping ? now() - typingSaidAt >= TYPING_BEAT_MS : was) beat();
      if (!isTyping) typingSaidAt = 0;
    },
    start(sender) {
      send = sender;
      // a seat that got up sits down again, also in a hidden page
      gone = false;
      ids ||= { seat: crypto.randomUUID().slice(0, 12), tab: tabId() };
      unwatch = page.watch(() => beat(), leave);
      beat(true);
    },
    stop() {
      leave();
      send = undefined;
      unwatch?.();
      unwatch = undefined;
      clearTimeout(beatTimer);
      clearTimeout(helloTimer);
      clearTimeout(clockTimer);
      helloTimer = undefined;
    },
  };
}

/** Whether a `here` is this seat's own, come back through the subscription. */
function isOwn(event: PresenceEvent, seat: string | undefined): boolean {
  const here = Here.safeParse(event.payload);
  return here.success && here.data.seat === seat;
}

/** WHO IS HERE in the context whose `events` a page holds, with this page as a seat of `me`.
 *  `send` appends events to that context as the signed-in principal (the page's own session);
 *  while it is undefined, or `enabled` is false, the page takes no seat and hears nobody.
 *  `typing(true)` on each change of what the person writes, `typing(false)` once it is sent or
 *  emptied. */
export function usePresence(opts: {
  enabled: boolean;
  events: readonly PresenceEvent[];
  send: ((events: unknown[]) => Promise<unknown>) | undefined;
  me: string | undefined;
}): { present: readonly PresentPrincipal[]; typing: (isTyping: boolean) => void } {
  const { enabled, events, send, me } = opts;
  const [held, setHeld] = useState(() => ({ me, seat: connectPresence({ me }) }));
  // another reader is another seat: made during render, as React asks of state that follows a prop
  const seat = held.me === me ? held.seat : connectPresence({ me });
  if (seat !== held.seat) setHeld({ me, seat });
  // the newest `send` is the one a beat uses, and a new one never makes the seat get up
  const sender = useRef(send);
  useEffect(() => {
    sender.current = send;
  }, [send]);
  const seated = enabled && Boolean(send);
  useEffect(() => {
    if (seated) seat.start((event) => sender.current?.([event]));
    // also for a page that never sat down: the timer of what it heard is stopped with it
    return () => seat.stop();
  }, [seat, seated]);
  useEffect(() => {
    if (enabled) seat.take(events);
  }, [seat, enabled, events]);
  const present = useSyncExternalStore(seat.subscribe, seat.get, () => NOBODY);
  return { present: seated ? present : NOBODY, typing: seat.typing };
}
