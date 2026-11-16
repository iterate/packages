// saved-context.ts — A CONTEXT'S LOG THAT A RELOAD DRAWS AT ONCE: what `useIterateContext`
// returns, kept over reconnects as `useKeptContext` keeps it, and seeded with the tail that the
// last page load saved (#/lib/saved-log-tail.ts). A page calls it in the place of
// `useKeptContext(useIterateContext(stub, options), path)`:
//
//   const agent = useHeldContext(itxSessionOf(itx), () => itx.cd(path), [itx, path]);
//   const context = useSavedContext({ held: agent, options, path, session, tails });
//
// The saved rows are drawn while the mind reads, with `savedCopy`; the read asks only for what is
// newer than them (`since`), and its newer rows come after them, as the same objects. With no
// `tails` (no member known yet) it is `useKeptContext` alone.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useIterateContext, type IterateContextHandle } from "iterate/react";
import { keptContext, type ItxSession, type LogSeed } from "#/lib/itx-session.ts";
import type { SavedLogTails, SavedTail } from "#/lib/saved-log-tail.ts";

type Live = ReturnType<typeof useIterateContext>;

/** Whether `tails` holds saved rows of `path`: undefined until the store has answered (at once from
 *  the page's memory, else within 300 ms). False with no store. A page reads it before it has a
 *  view: with saved rows the wait is for the view, and the page says nothing of a read. The store
 *  keeps what it read, so the view that mounts later has its rows in its first render. */
export function useHasSavedTail(tails: SavedLogTails | undefined, path: string) {
  const known = (): { path: string; has: boolean | undefined } => {
    const held = tails?.peek(path);
    return { path, has: tails ? held && Boolean(held.tail) : false };
  };
  const [saved, setSaved] = useState(known);
  if (saved.path !== path) setSaved(known());
  const unknown = saved.has === undefined;
  useEffect(() => {
    if (!unknown || !tails) return;
    let current = true;
    void tails.read(path).then((tail) => {
      if (current) setSaved({ path, has: Boolean(tail) });
    });
    return () => {
      current = false;
    };
  }, [unknown, tails, path]);
  return saved.path === path ? saved.has : undefined;
}

/** The context `path` of `held` (what `useHeldContext` answers), read live with `options`, with
 *  the rows the view held over reconnects and the rows `tails` saved over reloads. The read starts
 *  once the store has answered (at once from the page's memory, else within 300 ms), and a context
 *  that the mind refuses while the session is open is dropped from the store. */
export function useSavedContext({
  held,
  options,
  path,
  session,
  tails,
}: {
  held: { stub?: IterateContextHandle; error?: string };
  options: Omit<NonNullable<Parameters<typeof useIterateContext>[1]>, "since">;
  path: string;
  session: ItxSession;
  tails: SavedLogTails | undefined;
}) {
  const { state, epoch } = useSyncExternalStore(session.watch, session.get, session.get);
  // The session in which the stub in hand arrived, and the path it arrived for. After a socket
  // died the old stub stays in hand until its successor arrives, also once the new session is
  // open: what its read says then is the lost connection's, not the mind's. And a page that stays
  // mounted while its path changes still has the LAST context's stub in hand for a render
  // (`useContextStub` gives it up in an effect): that stub is read under its own path alone, or
  // the last context's log would be drawn, and saved, under the new path.
  const [arrived, setArrived] = useState({ stub: held.stub, epoch, path });
  if (arrived.stub !== held.stub) setArrived({ stub: held.stub, epoch, path });
  const stubOfThisPath = arrived.stub === held.stub && arrived.path === path;
  const stubOfThisSession = stubOfThisPath && arrived.epoch === epoch;
  const [keep] = useState(() => keptContext<Live>());
  // the tail this view starts from, and whether the store has answered for `path`: the memory of
  // this page answers at once
  const seedOf = (): { path: string; tail: SavedTail | undefined; answered: boolean } => {
    const known = tails?.peek(path);
    return { path, tail: known?.tail, answered: !tails || Boolean(known) };
  };
  const [seed, setSeed] = useState(seedOf);
  if (seed.path !== path) setSeed(seedOf());
  useEffect(() => {
    if (seed.answered || !tails) return;
    let current = true;
    void tails.read(seed.path).then((tail) => {
      if (current) setSeed({ path: seed.path, tail, answered: true });
    });
    return () => {
      current = false;
    };
  }, [seed, tails]);
  // the newest durable event shown, or else saved: the read returns it again, and what is newer
  const since = keep.through(path) ?? seed.tail?.events.at(-1)?.offset;
  const live = useIterateContext(seed.answered && stubOfThisPath ? held.stub : undefined, {
    ...options,
    since,
  });
  // the mind's refusal, while the session is open: the copy goes for good. An error while no
  // session is open, or of a stub that an earlier session opened, is the lost connection's, and
  // the copy stays for the next page.
  const refused = state === "open" && Boolean(held.error || (live.error && stubOfThisSession));
  // A saved tail holds the events a page of this hook handed to `save`: the events of `Live`.
  const tail = refused ? undefined : (seed.tail as LogSeed<Live> | undefined);
  const context = keep(live, path, tail);
  // The copy was of another log: the context was made again under this path. The read began at
  // the copy's newest offset, so it holds only what follows. The page below is read now, as a
  // read with no copy would have read it: the reader has a whole first screen without scrolling.
  const another = keep.anotherLog(path);
  const { loadOlder } = live.older;
  useEffect(() => {
    if (another) loadOlder();
  }, [another, loadOlder]);
  useEffect(() => {
    if (!refused) return;
    tails?.drop(path);
    // no later read starts from the copy's newest event either
    setSeed((last) => (last.tail ? { ...last, tail: undefined } : last));
  }, [refused, tails, path]);
  const saving = live.caughtUp && !live.error;
  const { events } = context;
  const { exhausted } = context.older;
  useEffect(() => {
    if (saving) tails?.save(path, events, exhausted);
  }, [saving, tails, path, events, exhausted]);
  useEffect(() => () => void tails?.flush(), [tails]);
  return context;
}
