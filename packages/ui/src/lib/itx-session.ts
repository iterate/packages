// itx-session.ts — A PAGE'S CONNECTION TO THE MIND, AS PLAIN DATA, and what carries a view over a
// new one. A page's `itx` from `memberItx` (src/browser/member-itx.ts) is a proxy to the current
// session: when the socket closes, a new session is dialled and the same `itx` calls through it. A
// stub or a subscription is of one session and ends with it, so what holds one opens it again
// when the session's epoch grows, and shows meanwhile what it showed.
//
// No React here. A component reads the session with React's own `useSyncExternalStore`, and keeps
// one keeper for its life, as a view keeps a `remembered` (components/virtual-log):
//
//   const session = itxSessionOf(itx);
//   const { epoch } = useSyncExternalStore(session.subscribe, session.get, session.get);
//   const agent = useContextStub(() => itx.cd(path), [itx, path, epoch]);
//   const [keep] = useState(() => keptContext<ReturnType<typeof useIterateContext>>());
//   const context = keep(useIterateContext(agent.stub), path);
//
// The same as hooks, for a file outside the registry and for a no-build page: src/hooks/use-itx-session.ts.

/** The page's connection, as a render reads it. */
export type ItxConnection = {
  /** How many sessions have opened: 0 until the first socket is open, one more at each new one.
   *  What holds a stub or a subscription opens it again when this changes. */
  epoch: number;
  /** `open`: a session's socket is open. `opening`: none for under two seconds, of which a page
   *  says nothing. `reconnecting`: none for longer, and the dials go on. `unreachable`: the quick
   *  dials all failed, and a slow one goes on for as long as the page is up. */
  state: "open" | "opening" | "reconnecting" | "unreachable";
};

/** The connection as a store for `useSyncExternalStore`. */
export type ItxSession = {
  get(): ItxConnection;
  /** For what opens again, at each new epoch, what it holds of the session. While anything
   *  subscribes, the page is one that lives on over a new session. */
  subscribe(changed: () => void): () => void;
  /** For what only shows the state (`ReconnectingMark`): it says nothing of what the page holds,
   *  so a page with watchers alone is still reloaded when a new session opens. */
  watch(changed: () => void): () => void;
};

/** The property under which a `memberItx` proxy answers its session. Registered, so the copy of
 *  this module in another chunk of the build reads the same one. */
export const ITX_SESSION = Symbol.for("iterate.itx-session");

const ONE_SESSION: ItxConnection = { epoch: 0, state: "open" };
const none = () => () => {};
const ALWAYS_OPEN: ItxSession = { get: () => ONE_SESSION, subscribe: none, watch: none };

/** The session of an `itx`: `memberItx`'s own. Any other (a test's object, an app client's) is
 *  one session that is always open. */
export function itxSessionOf(itx: object): ItxSession {
  // Only memberItx's proxy answers this symbol, and it answers an ItxSession; a capnweb stub
  // answers undefined for a symbol it does not know.
  const session = Reflect.get(itx, ITX_SESSION) as ItxSession | undefined;
  return session || ALWAYS_OPEN;
}

/** One read through an `itx`, as `keptRead` holds it: its answer, the epoch it was asked in, and
 *  whether it failed because that session was gone. */
export type KeptRead<T> = { answer: Promise<T>; epoch: number; lost: boolean };

/** A READ ASKED ONCE FOR THE LIFE OF THE PAGE, whoever asks: `held` while it stands, else a new
 *  `read`. Its promise is one object for every ask, so a component can `use` it at each render.
 *  `read` answers also when its call fails, and calls `failed()` then. A failure while its
 *  session is open is the mind's answer, and stands like any other. A failure while its session
 *  is gone is the lost connection's: it stands until a new session opens, and the first ask
 *  after that reads again. So no render and no refusal starts a read. */
export function keptRead<T>(
  itx: object,
  held: KeptRead<T> | undefined,
  read: (failed: () => void) => Promise<T>,
): KeptRead<T> {
  const session = itxSessionOf(itx);
  const { epoch } = session.get();
  if (held && !(held.lost && held.epoch !== epoch)) return held;
  const asked: KeptRead<T> = {
    epoch,
    lost: false,
    answer: read(() => {
      const now = session.get();
      asked.lost ||= now.epoch !== epoch || now.state !== "open";
    }),
  };
  return asked;
}

/** A KEEPER OF ONE VALUE: `keep(value, settled, key)` answers `value` while it is `settled`, and
 *  while it is not, what it last was when settled under the same `key`, if it ever was. A view
 *  over a subscription that is opened again draws this, so it shows the last answer until the new
 *  one is whole, and its loading state only when it never had one. It answers the same for the
 *  same input, since React can replay a render. */
export function kept<T>() {
  let last: { key: string; value: T } | undefined;
  return (value: T, settled: boolean, key: string): T => {
    if (settled) last = { key, value };
    return last?.key === key ? last.value : value;
  };
}

/** What `keptContext` reads of the SDK's `useIterateContext` result. */
type LiveContext = {
  events: readonly { offset: number; createdAt?: string; ephemeral?: boolean }[];
  caughtUp: boolean;
  error?: string;
  head?: number;
  older: { loading: boolean; exhausted: boolean };
  processors: { loaded: boolean; error?: string };
  liveState: Record<string, { status: string }>;
};

/** A saved tail of a context's log (#/lib/saved-log-tail.ts): its newest durable events, oldest
 *  first, and whether they go back to the log's first. */
export type LogSeed<C extends LiveContext> = { events: C["events"]; exhausted: boolean };

/** What `keptContext` answers: the context, and `savedCopy` while its rows are a saved tail's. */
export type KeptLiveContext<C extends LiveContext> = C & {
  /** The rows are a copy saved by an earlier page, not yet checked against the log: draw them,
   *  and decide nothing by them (an opener, an empty chat). */
  savedCopy?: boolean;
};

/** A KEEPER OF A CONTEXT'S LOG OVER RECONNECTS AND RELOADS: `keep(context, key, seed)` answers
 *  what `useIterateContext` returned for the context `key` (its path), with what the view showed
 *  in the place of what a new read has not read yet.
 *
 *  THE ROWS A VIEW HOLDS STAY, AS THE SAME OBJECTS. A new session reads the newest page only.
 *  Offsets never change, so the events the view held are still right: once the new read has
 *  caught up, the log is the held events with the new session's newer ones after them (and its
 *  older ones before them, when it reads further back than they go). A view folds and draws only
 *  what was added: a reader keeps the older pages they loaded, and no row is drawn again. When the
 *  new page starts above the last event held, events may be missing between the two: the held
 *  rows go, and the log is the new session's alone. A read that failed shows its error over the
 *  held rows.
 *
 *  A RELOAD IS THE SAME, WITH THE LAST PAGE LOAD IN THE PLACE OF THE LAST SESSION. `seed` is the
 *  tail that an earlier page saved. While nothing is shown yet, it is shown as a log that has
 *  caught up, with `savedCopy`. Once the read has caught up, it is held as a last session's rows
 *  are, if the read holds its newest event: the same offset and the same `createdAt`. If not, the
 *  copy is older than the newest page, or of a log made again under the same path, or longer than
 *  the log: its rows go. An error, or a call without the seed, drops a copy that is shown: a saved
 *  copy never stands beside an error. Once a read has caught up, a seed changes nothing.
 *
 *  The processors table stays until the new one is read, and the facets' live state until each
 *  has its seed. Another `key` keeps nothing.
 *
 *  `keep.through(key)` is the offset of the newest durable event last answered for `key`: the
 *  `since` of the next read, which then reads only what is newer. `keep.anotherLog(key)` is true
 *  once a seed was dropped because the log holds ANOTHER event at the seed's newest offset: the
 *  context was made again, and a read that began at that offset holds only what follows it. */
export function keptContext<C extends LiveContext>() {
  const keepProcessors = kept<C["processors"]>();
  const keepLiveState = kept<C["liveState"]>();
  let key: string | undefined;
  /** The log as last answered for a read that had caught up or failed. */
  let shown: C | undefined;
  /** A read that has not caught up came after `shown`: the next one that has is a new session's. */
  let reading = false;
  /** The events shown before the session whose log is read now, and whether they went back to
   *  the log's first. `seed`: they are a saved tail's, not yet found in the log. */
  let held: { events: C["events"]; exhausted: boolean; seed: boolean } | undefined;
  /** The seed shown while the read has not caught up, answered again for the same input. */
  let copy: { seed: LogSeed<C>; from: C; log: KeptLiveContext<C> } | undefined;
  /** The last merge, answered again for the same input: a view folds a log by its identity. */
  let merged: { from: C["events"]; held: C["events"]; events: C["events"] } | undefined;
  let older: { from: C["older"]; older: C["older"] } | undefined;
  /** The last answer, and what it was made of: the same object for the same input. */
  let answer:
    | { log: C; processors: C["processors"]; liveState: C["liveState"]; value: C }
    | undefined;
  /** The events last answered, for `through`. */
  let answered: C["events"] | undefined;
  /** A seed was dropped for an event of another log at its newest offset. */
  let another = false;

  const logOf = (context: C, seed: LogSeed<C> | undefined): KeptLiveContext<C> => {
    if (!context.caughtUp && !context.error) {
      reading = true;
      if (shown) return shown;
      if (!seed?.events.length) {
        copy = undefined;
        return context;
      }
      if (copy?.seed !== seed || copy.from !== context) {
        const head = seed.events.at(-1)!.offset;
        // The seed's rows in the place of the read's: C with its own events, and its head and
        // `older` as the seed has them.
        const log = {
          ...context,
          events: seed.events,
          caughtUp: true,
          head,
          older: { ...context.older, loading: false, exhausted: seed.exhausted },
          savedCopy: true,
        } as KeptLiveContext<C>;
        copy = { seed, from: context, log };
      }
      return copy.log;
    }
    if (copy) {
      // the read answered over a shown copy: hold it as a last session's rows, unless it failed
      // or the caller withdrew it
      if (!context.error && seed === copy.seed)
        held = { events: copy.seed.events, exhausted: copy.seed.exhausted, seed: true };
      copy = undefined;
    } else if (reading && shown)
      held = { events: shown.events, exhausted: shown.older.exhausted, seed: false };
    reading = false;
    const last = held?.events.at(-1);
    const first = context.events[0];
    // nothing held, or the new page starts above it: events may be missing between the two; and
    // a seed whose newest event the read does not hold is of an older page or of another log
    if (
      !held ||
      !last ||
      (first ? first.offset > last.offset : !context.error) ||
      (held.seed &&
        !context.events.some(
          (event) => event.offset === last.offset && event.createdAt === last.createdAt,
        ))
    ) {
      // the log holds an event at the seed's newest offset, and it is not the seed's
      another ||= Boolean(
        held?.seed && last && context.events.some((event) => event.offset === last.offset),
      );
      held = undefined;
      return (shown = context);
    }
    // found in the log: from now on the seed's rows are held as any session's
    if (held.seed) held = { ...held, seed: false };
    if (merged?.from !== context.events || merged.held !== held.events) {
      const start = held.events[0]!.offset;
      const below = context.events.filter((event) => event.offset < start);
      const above = context.events.filter((event) => event.offset > last.offset);
      // The held events of C's own event type with C's own events around them, in offset order.
      const events = (
        below.length + above.length ? [...below, ...held.events, ...above] : held.events
      ) as C["events"];
      merged = { from: context.events, held: held.events, events };
    }
    if (older?.from !== context.older)
      older = {
        from: context.older,
        older:
          held.exhausted && !context.older.exhausted
            ? { ...context.older, loading: false, exhausted: true }
            : context.older,
      };
    return (shown = { ...context, events: merged.events, older: older.older });
  };

  const keep = (context: C, of: string, seed?: LogSeed<C>): KeptLiveContext<C> => {
    if (of !== key) {
      key = of;
      shown = held = copy = merged = older = answer = undefined;
      reading = another = false;
    }
    const log = logOf(context, seed);
    const tableRead = context.processors.loaded || Boolean(context.processors.error);
    const processors = keepProcessors(context.processors, tableRead, of);
    const liveState = keepLiveState(
      context.liveState,
      tableRead && Object.values(context.liveState).every((one) => one.status !== "connecting"),
      of,
    );
    answered = log.events;
    if (log === context && processors === context.processors && liveState === context.liveState)
      return context;
    if (answer?.log !== log || answer.processors !== processors || answer.liveState !== liveState)
      answer = { log, processors, liveState, value: { ...log, processors, liveState } };
    return answer.value;
  };

  return Object.assign(keep, {
    /** The offset of the newest durable event last answered for `of`; undefined when none was. */
    through(of: string): number | undefined {
      if (of !== key) return undefined;
      return answered?.findLast((event) => event.ephemeral !== true)?.offset;
    },
    /** A seed of `of` was dropped as a copy of another log (see above). */
    anotherLog: (of: string) => of === key && another,
  });
}
