// THE CONTEXT EXPLORER: a mind's contexts as one page. On the left is the tree of every context the
// mind's registry holds, live. On the right is one context, live: its log, its processors and who
// is here (`ContextView`). A phone has the tree in a sheet, opened from the path. With no context
// chosen (`path` undefined) it holds nothing, the root included: the list stands alone, from the
// catalog, and a phone shows it at full width.
//
// It knows no router. The page says which context is shown (`path`), where a path's link goes and
// what a click on one does (`links`), and holds the view's state (`state`, `onStateChange`), so an
// app with a router and a page with none draw the same explorer:
//
//   <ContextExplorer
//     openRoot={() => itx.cd("/")}
//     deps={[itx]}
//     session={itxSessionOf(itx)}
//     path="/agents/onboarding"
//     links={{ hrefOf: (path) => `?context=${path}`, onNavigate }}
//     state={state}
//     onStateChange={(patch) => setState((before) => ({ ...before, ...patch }))}
//     tails={savedLogTails({ mind, actor })}
//   />
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type DependencyList,
  type ReactNode,
} from "react";
import { z } from "zod";
import type { AuthenticatedApp } from "iterate/app";
import { resolveContextPath } from "iterate/lib";
import { useContextStub, useFacetLiveState } from "iterate/react";
import { ContextPath, type ContextPathLinks } from "#/components/context-view/context-path.tsx";
import { ContextTree, ContextTreeSheet } from "#/components/context-view/context-tree.tsx";
import { ContextViewState } from "#/components/context-view/context-view-search.ts";
import { ContextView } from "#/components/context-view/context-view.tsx";
import { ContextAbout } from "#/components/context-catalog/context-about.tsx";
import { ContextCatalog } from "#/components/context-catalog/context-catalog-list.tsx";
import {
  describeContext,
  type ContextListing,
} from "#/components/context-catalog/context-catalog-rows.ts";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { itxSessionOf, kept, type ItxSession } from "#/lib/itx-session.ts";
import { useHasSavedTail, useSavedContext } from "#/lib/saved-context.ts";
import type { SavedLogTails } from "#/lib/saved-log-tail.ts";

/** The session of a page whose connection is not `memberItx`'s: one that is always open. */
const oneSession = itxSessionOf({});

/** A held context, as a mind's root hands it (`itx.cd(path)`). */
type ContextStub = Awaited<ReturnType<AuthenticatedApp["itx"]["cd"]>>;

export function ContextExplorer({
  openRoot,
  deps,
  session = oneSession,
  path,
  links,
  state,
  onStateChange,
  catalog,
  actions,
  empty,
  tails,
}: {
  /** The mind's catalog of its contexts (`useContextCatalog` of components/context-catalog), when the app reads it: the tree
   *  marks the awake ones, a "Recent" list joins the tree, and the context shown says what it is. */
  catalog?: readonly ContextListing[];
  /** Opens a handle of its own on the mind's root, which the explorer holds while `deps` stand and
   *  then releases: never the page's own `itx`. Null while the root cannot be named yet. */
  openRoot: (() => PromiseLike<ContextStub>) | null;
  deps: DependencyList;
  /** The session of a page's `memberItx` (`itxSessionOf(itx)`), whose socket is dialled again
   *  when it closes: the explorer opens its contexts again at each new session, and shows what it
   *  had until the new read has caught up. Absent: the root is opened once. */
  session?: ItxSession;
  /** The context shown, canonical (`contextPathOf`): `/` is the root. Undefined: none is
   *  chosen, so the explorer opens no context and reads no log, and shows `empty` beside the list. */
  path: string | undefined;
  links: ContextPathLinks;
  /** The view's every choice: mode, filter, the inspected event, the open sheet. */
  state: ContextViewState;
  onStateChange(patch: Partial<ContextViewState>): void;
  /** What the page puts after the path: a link to the same context in another view. */
  actions?: ReactNode;
  /** What the main area says while no context is chosen. */
  empty?: ReactNode;
  /** The member's saved tails (`savedLogTails` of lib/saved-log-tail): a log shown again, also
   *  after a reload, draws the rows it showed last at once, and the mind is asked only for what is
   *  newer. Absent: each log is read anew. */
  tails?: SavedLogTails;
}) {
  const { stub, contexts, context, error } = useHeldContexts({
    session,
    openRoot,
    deps,
    path,
    tails,
  });
  // While the store looks for saved rows of this log (at once from the page's memory, else
  // within 300 ms), the view waits and says nothing of a read: with saved rows none holds the
  // reader up, and they are in the view's first render.
  const looking = useHasSavedTail(path ? tails : undefined, path || "") === undefined;
  // with the root not held, the catalog's paths make the tree
  const paths = useMemo(
    () => [
      ...new Set([
        ...Object.keys(Registry.safeParse(contexts).data?.contexts || {}),
        ...(catalog || []).map((row) => row.path),
      ]),
    ],
    [contexts, catalog],
  );
  const awake = useMemo(
    () => new Set((catalog || []).flatMap((row) => (row.awake ? [row.path] : []))),
    [catalog],
  );
  const tree = {
    paths,
    awake,
    current: path,
    links,
    // a typed path resolves against the one shown
    resolvePath: (typed: string) => resolveContextPath(path || "/", typed),
  };
  const shownRow = catalog?.find((row) => row.path === path);
  if (!path)
    return (
      <div className="flex min-h-0 flex-1">
        <SideList tree={tree} catalog={catalog} className="w-full lg:w-64 lg:border-r" />
        <p className="p-4 text-sm text-muted-foreground max-lg:hidden">{empty}</p>
      </div>
    );
  const title = (
    <>
      <ContextTreeSheet {...tree} current={path} className="lg:hidden" />
      <ContextPath path={path} links={links} className="max-lg:hidden" />
      {catalog ? (
        <ContextAbout
          // a draft of a description is one context's: another path starts afresh
          key={path}
          row={shownRow}
          onDescribe={
            stub
              ? (description, title) =>
                  describeContext((event) => stub.append(event), shownRow, description, title)
              : undefined
          }
        />
      ) : null}
      {actions}
    </>
  );
  return (
    <div className="flex min-h-0 flex-1">
      <SideList tree={tree} catalog={catalog} className="w-64 border-r max-lg:hidden" />
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
        ) : looking ? (
          <div className="flex items-center px-3 py-1.5 sm:px-4">{title}</div>
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

/** WHAT THE EXPLORER HOLDS OF THE MIND, over the sessions of `session`: the root, the context
 *  shown, every path of the mind's registry, and the shown context's log, live. Each is opened
 *  again at a new session, and what the explorer showed stays meanwhile. */
function useHeldContexts({
  session,
  openRoot,
  deps,
  path,
  tails,
}: {
  session: ItxSession;
  openRoot: (() => PromiseLike<ContextStub>) | null;
  deps: DependencyList;
  path: string | undefined;
  tails: SavedLogTails | undefined;
}) {
  const { epoch, state: connection } = useSyncExternalStore(
    session.subscribe,
    session.get,
    session.get,
  );
  // THE ROOT, opened again at each new session: none is in hand while the new one opens.
  const root = useContextStub(path ? openRoot : null, [...deps, Boolean(path), epoch]);
  const rootStub = root.stub;
  // THE CONTEXT SHOWN, opened from the root in hand alone, so never from a root whose session
  // ended: it is released while a new root opens, and opened again from that one, and as the path
  // changes. What the view showed stays meanwhile (`keepContext` below).
  const shown = useContextStub(rootStub && path ? () => rootStub.cd(path) : null, [rootStub, path]);
  // every path the mind's registry holds: the `mind` facet's `contexts` on the root, live; a new
  // root subscribes again, and the tree keeps its paths until that answers
  const registry = useFacetLiveState(rootStub, "mind");
  const [keepContexts] = useState(() => kept<unknown>());
  const contexts = keepContexts(registry.value, registry.value !== undefined, "mind");
  // `liveState` omitted: the hook opens the core reduce's live state and every hosted facet's as
  // the processors table it holds loads, which is exactly what the panel shows. A new session
  // reads the context again: the rows the view holds stay, and the new ones come after them. A
  // reload draws the saved rows at once (`tails`). With no path, nothing is read or saved.
  const refusal = useRefusal(shown, rootStub, epoch, path || "");
  const context = useSavedContext({
    held: { stub: shown.stub, error: refusal },
    options: {},
    path: path || "",
    session,
    tails: path ? tails : undefined,
  });
  return {
    stub: shown.stub,
    contexts,
    context,
    // what did not open while no session is open says nothing: the next session opens it
    error: connection === "open" ? root.error || shown.error : undefined,
  };
}

/** The error of the context shown, when it is the mind's answer: a `cd` from the root in hand, and
 *  that root opened in this session. A saved copy goes for good on it. The stub is released while
 *  a new root opens, so an error of the old root's `cd` can stay in hand for a render beside the
 *  new root, or land after the new session opened: that one is the lost connection's. And for a
 *  render after the path changed, what is in hand is still the last path's: its error is not this
 *  path's. */
function useRefusal(
  shown: { error?: string },
  root: object | undefined,
  epoch: number,
  path: string,
) {
  const [rootArrived, setRootArrived] = useState({ root, epoch });
  if (rootArrived.root !== root) setRootArrived({ root, epoch });
  const [shownArrived, setShownArrived] = useState({ shown, root, path });
  if (shownArrived.shown !== shown) setShownArrived({ shown, root, path });
  const ofThisSessionAndPath =
    rootArrived.root === root &&
    rootArrived.epoch === epoch &&
    shownArrived.shown === shown &&
    shownArrived.root === root &&
    shownArrived.path === path;
  return ofThisSessionAndPath ? shown.error : undefined;
}

/** The side list: the tree of contexts and, with a catalog, its Recent list, one at a time. */
function SideList({
  tree,
  catalog,
  className,
}: {
  tree: Parameters<typeof ContextTree>[0];
  catalog: readonly ContextListing[] | undefined;
  className: string;
}) {
  const [sidebar, setSidebar] = useState<"tree" | "recent">("tree");
  return (
    <div className={`flex shrink-0 flex-col gap-1.5 px-2 pt-1.5 pb-2 ${className}`}>
      {catalog ? (
        <Tabs
          value={sidebar}
          onValueChange={(value) => setSidebar(value === "recent" ? "recent" : "tree")}
        >
          <TabsList className="w-full" aria-label="How the contexts are listed">
            <TabsTrigger value="tree" className="text-xs">
              Tree
            </TabsTrigger>
            <TabsTrigger value="recent" className="text-xs">
              Recent
            </TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      {catalog && sidebar === "recent" ? (
        <ContextCatalog
          rows={catalog}
          current={tree.current}
          links={tree.links}
          className="flex-1"
        />
      ) : (
        <ContextTree {...tree} className="flex-1" />
      )}
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
