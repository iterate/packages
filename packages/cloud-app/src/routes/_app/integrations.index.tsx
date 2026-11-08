import { createFileRoute, redirect } from "@tanstack/react-router";

/** `/integrations` is its first page. */
export const Route = createFileRoute("/_app/integrations/")({
  beforeLoad: () => {
    throw redirect({ to: "/integrations/x", replace: true });
  },
});
