import { createRootRouteWithContext } from "@tanstack/react-router";
import { AppDocument } from "@iterate-com/ui/apps/document";
import { appHead } from "@iterate-com/ui/apps/head";
import { underBasePath } from "@iterate-com/ui/apps/base-path";
import css from "../styles.css?url";

/** `basePath`: the path the Cloud is served under, "" at a host's root (@iterate-com/ui/apps/base-path). */
export const Route = createRootRouteWithContext<{ basePath: string }>()({
  head: ({ match }) =>
    appHead({
      title: "iterate",
      stylesheet: underBasePath(match.context.basePath, css),
      description: "Run iterate in your own Cloudflare account.",
    }),
  component: Root,
});

function Root() {
  const { basePath } = Route.useRouteContext();
  return <AppDocument icon="/client-logo.svg" basePath={basePath} posthogProjectKey={null} />;
}
