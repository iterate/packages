// /minds/<address>/analytics — the mind's telemetry (packages/ui `AnalyticsPage`, which says what
// it asks and when). This route asks first whether the mind has telemetry (lib/served.ts): a mind
// that does not serve `itx.telemetry` gets the kit's `TelemetryOff`, which says what turns it on,
// and no query is made.
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AnalyticsPage,
  telemetryQueryOf,
  TelemetryOff,
} from "@iterate-com/ui/components/analytics-page";
import { servesRoot } from "../../../lib/served.ts";

export const Route = createFileRoute("/minds/$mind/analytics")({
  loader: async ({ context }) => ({ served: await servesRoot(context.read, "telemetry") }),
  staticData: { page: "Analytics" },
  head: ({ params }) => ({ meta: [{ title: `Analytics · ${params.mind} · Dash` }] }),
  component: MindAnalytics,
});

function MindAnalytics() {
  const { served } = Route.useLoaderData();
  const { itx, mind } = Route.useRouteContext();
  // one function while the page holds this `itx`: the page reads again when it gets another
  const query = useMemo(() => telemetryQueryOf(itx), [itx]);
  if (!served) return <TelemetryOff mind={mind} />;
  return <AnalyticsPage query={query} />;
}
