import type { DependencyList } from "react";
import { z } from "zod";
import { type FacetLiveSnapshot, useContextStub, useFacetLiveState } from "iterate/react";

/** What `useFacetLiveState` subscribes through, held by `useContextStub`. */
export type FacetHost = NonNullable<Parameters<typeof useFacetLiveState>[0]> & Disposable;

/** What `useFacetView` answers for a context `S` whose facet's state parses as `T`. */
export type FacetView<S extends FacetHost, T> = ReturnType<typeof useFacetView<S, T>>;

/** ONE FACET'S LIVE STATE on a context the page holds, parsed: the state once read, the stub and
 *  the raw value, what failed — a stub that failed to open leaves its subscription connecting for
 *  good, so it fails the view too — and whether a loader's snapshot shows while the subscription
 *  connects (`seeding`: the page shows a spinner by its heading). */
export function useFacetView<S extends FacetHost, T>(
  open: (() => PromiseLike<S>) | null,
  deps: DependencyList,
  facet: string,
  initial: FacetLiveSnapshot | undefined,
  schema: z.ZodType<T>,
) {
  const opened = useContextStub(open, deps);
  const live = useFacetLiveState(opened.stub, facet, initial);
  const read = live.value ? schema.safeParse(live.value) : undefined;
  const error = opened.error || live.error || (read?.error ? z.prettifyError(read.error) : null);
  return {
    stub: opened.stub,
    value: live.value,
    state: read?.data,
    error,
    failed: Boolean(opened.error) || live.status === "error",
    seeding: live.status === "connecting" && Boolean(live.value),
    settled: Boolean(live.value) || Boolean(error),
  };
}
