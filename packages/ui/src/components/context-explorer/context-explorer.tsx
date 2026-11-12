// THE CONTEXT EXPLORER: a mind's contexts as one page. On the left is the tree of every context the
// mind's registry holds, live. On the right is one context, live: its log, its processors and who
// is here (`ContextView`). A phone has the tree in a sheet, opened from the path.
//
// It knows no router. The page says which context is shown (`path`), where a path's link goes and
// what a click on one does (`links`), and holds the view's state (`state`, `onStateChange`), so an
// app with a router and a page with none draw the same explorer:
//
//   <ContextExplorer
//     openRoot={() => itx.cd("/")}
//     deps={[itx]}
//     path="/agents/onboarding"
//     links={{ hrefOf: (path) => `?context=${path}`, onNavigate }}
//     state={state}
//     onStateChange={(patch) => setState((before) => ({ ...before, ...patch }))}
//   />
import { useMemo, type DependencyList } from "react";
import { z } from "zod";
import type { AuthenticatedApp } from "iterate/app";
import { resolveContextPath } from "iterate/lib";
import { useContextStub, useFacetLiveState, useIterateContext } from "iterate/react";
import { ContextPath, type ContextPathLinks } from "#/components/context-view/context-path.tsx";
import { ContextTree, ContextTreeSheet } from "#/components/context-view/context-tree.tsx";
import { ContextViewState } from "#/components/context-view/context-view-search.ts";
import { ContextView } from "#/components/context-view/context-view.tsx";

/** A held context, as a mind's root hands it (`itx.cd(path)`). */
type ContextStub = Awaited<ReturnType<AuthenticatedApp["itx"]["cd"]>>;

export function ContextExplorer({
  openRoot,
  deps,
  path,
  links,
  state,
  onStateChange,
}: {
  /** Opens a handle of its own on the mind's root, which the explorer holds while `deps` stand and
   *  then releases: never the page's own `itx`. Null while the root cannot be named yet. */
  openRoot: (() => PromiseLike<ContextStub>) | null;
  deps: DependencyList;
  /** The context shown, canonical (`contextPathOf`): `/` is the root. */
  path: string;
  links: ContextPathLinks;
  /** The view's every choice: mode, filter, the inspected event, the open sheet. */
  state: ContextViewState;
  onStateChange(patch: Partial<ContextViewState>): void;
}) {
  const root = useContextStub(openRoot, deps);
  const rootStub = root.stub;
  // the context shown is released and opened again as the path changes
  const shown = useContextStub(rootStub ? () => rootStub.cd(path) : null, [rootStub, path]);
  // every path the mind's registry holds: the `mind` facet's `contexts` on the root, live
  const registry = useFacetLiveState(rootStub, "mind");
  const paths = useMemo(
    () => Object.keys(Registry.safeParse(registry.value).data?.contexts || {}),
    [registry.value],
  );
  const tree = {
    paths,
    current: path,
    links,
    // a typed path resolves against the one shown
    resolvePath: (typed: string) => resolveContextPath(path, typed),
  };
  // `liveState` omitted: the hook opens the core reduce's live state and every hosted facet's as
  // the processors table it holds loads, which is exactly what the panel shows
  const context = useIterateContext(shown.stub);
  const error = root.error || shown.error;
  const title = (
    <>
      <ContextTreeSheet {...tree} className="lg:hidden" />
      <ContextPath path={path} links={links} className="max-lg:hidden" />
    </>
  );
  const { stub } = shown;
  return (
    <div className="flex min-h-0 flex-1">
      <ContextTree {...tree} className="hidden w-60 shrink-0 border-r px-2 pt-1.5 pb-2 lg:flex" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error ? (
          <>
            {/* the path and, on a phone, the tree stay: the way out of a path that failed */}
            <div className="flex items-center px-3 py-1.5 sm:px-4">{title}</div>
            <p
              role="alert"
              data-type="error"
              className="px-3 py-2 text-sm text-destructive sm:px-4"
            >
              {error}
            </p>
          </>
        ) : (
          <ContextView
            title={title}
            context={context}
            state={state}
            onStateChange={onStateChange}
            onAppend={stub ? (events) => stub.append(...events) : undefined}
            // the feed scrolls itself: it fills what the page leaves it, never less than 24rem
            className="min-h-96 flex-1"
          />
        )}
      </div>
    </div>
  );
}

/** A URL's tail, or a path a person typed, as a context path, canonical as `cd` reads it
 *  (`resolveContextPath`, the SDK's one resolver): `` is `/`, `repos/config/` is `/repos/config`. */
export function contextPathOf(tail: string | undefined) {
  return resolveContextPath("/", tail || "");
}

/** The view's state from anything a URL can hold (a page with no router keeps it as JSON in one
 *  search key): a key with a wrong value is an absent key, never an error. */
export function contextViewStateOf(value: unknown): ContextViewState {
  return ContextViewState.safeParse(value).data || {};
}

/** The one field of the `mind` facet's state the explorer reads: the registry's paths, as keys. */
const Registry = z.looseObject({ contexts: z.record(z.string(), z.unknown()).optional() });
