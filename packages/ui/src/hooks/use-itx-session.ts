// use-itx-session.ts — THE HOOKS THAT CARRY A VIEW OVER A NEW SESSION of a page's `memberItx`
// (src/browser/member-itx.ts), for a file outside the registry and, through
// `@iterate-com/ui/live`, for a no-build page. They stay here until they move to `iterate/react`.
// The plain parts under them, which a registry item uses with React's own hooks, are in
// #/lib/itx-session.ts.
//
//   useItxConnection(itx)                 the epoch (how many sessions have opened) and the state
//   useHeldContext(session, open, deps)   a context's stub, opened again at each new session; the
//                                         stub in hand stays until its successor arrives
//   useKeptContext(context, key)          what `useIterateContext` returns, with the rows the view
//                                         held: kept while a new session reads, and under its
//                                         newer rows after
//   useKept(value, settled, key)          any value, with its last settled answer meanwhile
//
// An `itx` that is no `memberItx` is one session that is always open: the hooks then do what the
// SDK's own do.
import { useState, useSyncExternalStore, type DependencyList } from "react";
import { useContextStub } from "iterate/react";
import {
  itxSessionOf,
  kept,
  keptContext,
  type ItxConnection,
  type ItxSession,
} from "#/lib/itx-session.ts";

/** The connection of an `itx`, live. A page that reads it lives on over a new session: put the
 *  epoch in the deps of what holds a stub. */
export function useItxConnection(itx: object): ItxConnection {
  const session = itxSessionOf(itx);
  return useSyncExternalStore(session.subscribe, session.get, session.get);
}

/** HOLD A CONTEXT'S STUB OVER RECONNECTS: the SDK's `useContextStub`, which also opens at each
 *  new session of `session` (`itxSessionOf(itx)`). `deps` name the context: when they change,
 *  nothing of the last one stays. A new session alone is the same context: the stub in hand
 *  stays, dead, until its successor arrives, so a view that holds it keeps what it draws. An open
 *  that fails while no session is open is no refusal: the next session opens again. `open` null
 *  opens nothing.
 *
 *  OPEN FROM THE PAGE'S `itx` (`() => itx.cd(path)`), which is always the current session. The
 *  stub this answers is the last session's until its successor arrives: a context opened from it
 *  then would be asked of a session that ended. */
export function useHeldContext<S extends Disposable>(
  session: ItxSession,
  open: (() => PromiseLike<S>) | null,
  deps: DependencyList,
): { stub?: S; error?: string; pending: boolean } {
  const { epoch, state } = useSyncExternalStore(session.subscribe, session.get, session.get);
  const opened = useContextStub(open, [...deps, epoch]);
  // which context it is: a number that grows when `deps` change
  const [named, setNamed] = useState({ deps, context: 0 });
  if (deps.length !== named.deps.length || deps.some((one, at) => !Object.is(one, named.deps[at])))
    setNamed({ deps, context: named.context + 1 });
  const lost = Boolean(opened.error) && state !== "open";
  const [keep] = useState(() => kept<typeof opened>());
  const held = keep(opened, !opened.pending && !lost, String(named.context));
  return lost && held === opened ? { pending: true } : held;
}

/** `value` while it is `settled`, and its last settled answer under the same `key` while it is
 *  not (`kept`). */
export function useKept<T>(value: T, settled: boolean, key: string): T {
  const [keep] = useState(() => kept<T>());
  return keep(value, settled, key);
}

/** What `useIterateContext` returns for the context `key` (its path), over reconnects
 *  (`keptContext`): the rows the view held stay, as the same objects, and a new session's newer
 *  rows come after them. */
export function useKeptContext<C extends Parameters<ReturnType<typeof keptContext>>[0]>(
  context: C,
  key: string,
): C {
  const [keep] = useState(() => keptContext<C>());
  return keep(context, key);
}
