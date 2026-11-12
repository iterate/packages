// /minds/<address>/contexts/<path> — any context of the mind, live, in packages/ui's
// `ContextExplorer`. This route is the explorer's wiring to the router. The path is the URL's own
// tail: `/minds/<address>/contexts` is the root `/`, and `…/contexts/repos/config` is
// `/repos/config`. The view's state is the URL's search, so every state is a link. The shell's
// breadcrumb ends in "Contexts".
import { createFileRoute } from "@tanstack/react-router";
import {
  ContextExplorer,
  contextPathOf,
} from "@iterate-com/ui/components/context-explorer/context-explorer";
import { ContextViewState } from "@iterate-com/ui/components/context-view/context-view-search";
import { useContextLinks } from "@iterate-com/ui/hooks/use-context-explorer";

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
  const links = useContextLinks(`/minds/${encodeURIComponent(mind)}/contexts`);
  return (
    <ContextExplorer
      // a handle of its own on `/`, which the explorer releases: never the page's `itx` itself
      openRoot={() => itx.cd("/")}
      deps={[itx]}
      path={contextPathOf(_splat)}
      links={links}
      state={search}
      onStateChange={(patch) =>
        void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true })
      }
    />
  );
}
