import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ConnectProject } from "@iterate-com/ui/components/connect-project";

// The standard page that points the app at a project by its address. The gate sends a browser here
// for a project it is not connected to, with the address and where to go after (iterate/app-server).
export const Route = createFileRoute("/connect")({
  validateSearch: z.object({
    project: z.string().optional().catch(undefined),
    next: z.string().optional().catch(undefined),
  }),
  component: Connect,
});

function Connect() {
  const { project, next } = Route.useSearch();
  return <ConnectProject app="Agents" project={project} next={next} />;
}
