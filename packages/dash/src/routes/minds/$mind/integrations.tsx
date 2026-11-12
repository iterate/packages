// /minds/<address>/integrations — what the mind's packages registered (packages/ui
// `IntegrationsPage`). This route is the page's wiring: its loader reads the registry's snapshot
// once, so the page shows it while its subscription connects. A mind that does not serve
// `itx.integrations` yet gets one line that says so (lib/served.ts).
import { createFileRoute } from "@tanstack/react-router";
import { IntegrationsPage } from "@iterate-com/ui/components/integrations-page";
import { INTEGRATIONS_PATH } from "iterate/integrations";
import { facetSnapshotOf } from "iterate/react";
import { NotServedYet } from "../../../components/not-served-yet.tsx";
import { servesRoot } from "../../../lib/served.ts";

export const Route = createFileRoute("/minds/$mind/integrations")({
  // `useFacetLiveState`'s `initial` for the registry: a read that fails leaves the view waiting on
  // its subscription
  // react-doctor-disable-next-line react-doctor/tanstack-start-loader-parallel-fetch -- the registry is read only once the root is known to be there
  loader: async ({ context }) => {
    if (!(await servesRoot(context.read, "integrations"))) return { served: false as const };
    const registry = await context
      .read(async (itx) => {
        using registry = itx.cd(INTEGRATIONS_PATH);
        return await facetSnapshotOf(registry, "integration");
      })
      .catch(() => undefined);
    return { served: true as const, registry };
  },
  staticData: { page: "Integrations" },
  head: ({ params }) => ({ meta: [{ title: `Integrations · ${params.mind} · Dash` }] }),
  component: MindIntegrations,
});

function MindIntegrations() {
  const data = Route.useLoaderData();
  const { itx, mind } = Route.useRouteContext();
  if (!data.served) return <NotServedYet title="Integrations" what="integrations" />;
  return (
    <IntegrationsPage
      openRegistry={() => itx.cd(INTEGRATIONS_PATH)}
      deps={[itx]}
      seed={data.registry}
      mind={mind}
    />
  );
}
