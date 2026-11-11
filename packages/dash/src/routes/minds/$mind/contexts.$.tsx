// /minds/<address>/contexts/<path> — any context of the mind, live: its log, its processors,
// who is here and every hosted processor's live state, in the general-purpose context view
// (packages/ui `ContextView`) over the SDK's one hook. The path is the URL's own tail —
// `/minds/<address>/contexts` is the root `/`, `…/contexts/repos/config` is `/repos/config` —
// and the view's filter, inspected event and open sheet are its search, so every state is a link.
// Full width, two panes: on the left the context tree over the mind's context registry, live; on
// the right the context, its path once on the view's strip (the wiring is packages/ui
// `use-context-explorer.ts`). A phone has the tree in a sheet, opened from the path. The view's
// composer appends as the signed-in person. The shell's breadcrumb ends in "Contexts".
import { createFileRoute } from "@tanstack/react-router";
import { useIterateContext } from "iterate/react";
import { ContextPath } from "@iterate-com/ui/components/context-view/context-path";
import {
  ContextTree,
  ContextTreeSheet,
} from "@iterate-com/ui/components/context-view/context-tree";
import { ContextView } from "@iterate-com/ui/components/context-view/context-view";
import { ContextViewState } from "@iterate-com/ui/components/context-view/context-view-search";
import {
  contextPathOf,
  useContextExplorer,
  useRegistryPaths,
} from "@iterate-com/ui/hooks/use-context-explorer";

export const Route = createFileRoute("/minds/$mind/contexts/$")({
  // the view's every choice — mode, filter, the inspected event, the open sheet — is this URL
  validateSearch: ContextViewState,
  staticData: { page: "Contexts" },
  head: ({ params }) => ({
    meta: [{ title: `${contextPathOf(params._splat)} · Contexts · ${params.mind} · Dash` }],
  }),
  component: MindContexts,
});

function MindContexts() {
  const { itx, mind } = Route.useRouteContext();
  const { _splat } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const explorer = useContextExplorer({
    base: `/minds/${encodeURIComponent(mind)}/contexts`,
    splat: _splat,
    // a handle of its own on `/`, which the explorer releases: never the page's `itx` itself
    openRoot: () => itx.cd("/"),
    deps: [itx],
  });
  const { path, links, error, stub } = explorer;
  const tree = { paths: useRegistryPaths(explorer.rootStub), ...explorer.tree };
  // `liveState` omitted: the hook opens the core reduce's live state and every hosted facet's as
  // the processors table it holds loads — exactly what the panel shows
  const context = useIterateContext(stub);
  const title = (
    <>
      <ContextTreeSheet {...tree} className="lg:hidden" />
      <ContextPath path={path} links={links} className="max-lg:hidden" />
    </>
  );
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
            state={search}
            onStateChange={(patch) =>
              void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true })
            }
            pathLinks={links}
            onAppend={stub ? (events) => stub.append(...events) : undefined}
            // the feed scrolls itself: it fills what the page leaves it, never less than 24rem
            className="min-h-96 flex-1"
          />
        )}
      </div>
    </div>
  );
}
