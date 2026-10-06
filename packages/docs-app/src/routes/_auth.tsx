import { createFileRoute, Outlet } from "@tanstack/react-router";
import { createIterateClient } from "iterate/app";
import { usePosthogIdentity } from "@iterate-com/ui/components/posthog";
import { ProjectAppFrame } from "@iterate-com/ui/components/project-app-shell";
const iterate = createIterateClient();
export const Route = createFileRoute("/_auth")({
  ssr: false,
  // back to the page the browser addressed, its base path included
  beforeLoad: ({ context, location }) =>
    iterate.authenticate(`${context.basePath}${location.href}`),
  // the project's frame from the URL: the server's HTML, and the page until the browser has signed in
  pendingComponent: Frame,
  component: Identified,
});

function Identified() {
  usePosthogIdentity(Route.useRouteContext().info.principal);
  return <Outlet />;
}

/** The project's frame from the URL (`ProjectAppFrame`), its links under the page's base path. */
function Frame() {
  return <ProjectAppFrame app="Docs" basePath={Route.useRouteContext().basePath} />;
}
