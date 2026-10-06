import { createFileRoute, Outlet } from "@tanstack/react-router";
import { createIterateClient } from "iterate/app";
import { usePosthogIdentity } from "@iterate-com/ui/components/posthog";
import { ProjectAppFrame } from "@iterate-com/ui/components/project-app-shell";
const iterate = createIterateClient();
export const Route = createFileRoute("/_auth")({
  ssr: false,
  beforeLoad: ({ location }) => iterate.authenticate(location.href),
  // the project's frame from the URL: the server's HTML, and the page until the browser has signed in
  pendingComponent: () => <ProjectAppFrame app="Voice" />,
  component: Identified,
});

function Identified() {
  usePosthogIdentity(Route.useRouteContext().info.principal);
  return <Outlet />;
}
