import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ConnectMind } from "@iterate-com/ui/components/connect-mind";

// The standard page that points the app at a mind by its address. The gate sends a browser here
// for a mind it is not connected to, with the address and where to go after (iterate/app-server).
export const Route = createFileRoute("/connect")({
  validateSearch: z.object({
    mind: z.string().optional().catch(undefined),
    next: z.string().optional().catch(undefined),
  }),
  component: Connect,
});

function Connect() {
  const { mind, next } = Route.useSearch();
  return <ConnectMind app="Agents" mind={mind} next={next} />;
}
