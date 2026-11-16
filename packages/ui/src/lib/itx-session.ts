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
  events: readonly { offset: number }[];
  caughtUp: boolean;
  error?: string;
  older: { loading: boolean; exhausted: boolean };
  processors: { loaded: boolean; error?: string };
  liveState: Record<string, { status: string }>;
};

/** A KEEPER OF A CONTEXT'S LOG OVER RECONNECTS: `keep(context, key)` answers what
 *  `useIterateContext` returned for the context `key` (its path), with what the view showed in
 *  the place of what a new session has not read yet.
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
 *  The processors table stays until the new one is read, and the facets' live state until each
 *  has its seed. Another `key` keeps nothing. */
export function keptContext<C extends LiveContext>() {
  const keepProcessors = kept<C["processors"]>();
  const keepLiveState = kept<C["liveState"]>();
  let key: string | undefined;
  /** The log as last answered for a read that had caught up or failed. */
  let shown: C | undefined;
  /** A read that has not caught up came after `shown`: the next one that has is a new session's. */
  let reading = false;
  /** The events shown before the session whose log is read now, and whether they went back to
   *  the log's first. */
  let held: { events: C["events"]; exhausted: boolean } | undefined;
  /** The last merge, answered again for the same input: a view folds a log by its identity. */
  let merged: { from: C["events"]; held: C["events"]; events: C["events"] } | undefined;
  let older: { from: C["older"]; older: C["older"] } | undefined;

  const logOf = (context: C): C => {
    if (!context.caughtUp && !context.error) {
      reading = true;
      return shown || context;
    }
    if (reading && shown) held = { events: shown.events, exhausted: shown.older.exhausted };
    reading = false;
    const last = held?.events.at(-1);
    const first = context.events[0];
    // nothing held, or the new page starts above it: events may be missing between the two
    if (!held || !last || (first ? first.offset > last.offset : !context.error)) {
      held = undefined;
      return (shown = context);
    }
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

  return (context: C, of: string): C => {
    if (of !== key) {
      key = of;
      shown = held = merged = older = undefined;
      reading = false;
    }
    const log = logOf(context);
    const tableRead = context.processors.loaded || Boolean(context.processors.error);
    const processors = keepProcessors(context.processors, tableRead, of);
    const liveState = keepLiveState(
      context.liveState,
      tableRead && Object.values(context.liveState).every((one) => one.status !== "connecting"),
      of,
    );
    if (log === context && processors === context.processors && liveState === context.liveState)
      return context;
    return { ...log, processors, liveState };
  };
}
