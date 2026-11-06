// /deployments/<id> — one deployment, live from its own context; components/deployment-body.tsx
// draws it.
import { createFileRoute } from "@tanstack/react-router";
import { ErrorMessage } from "@iterate-com/ui/components/standalone-page";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import { Connection } from "../../components/connection.tsx";
import { DeploymentBody } from "../../components/deployment-body.tsx";
import { useDeployment } from "../../lib/live.ts";

export const Route = createFileRoute("/_app/deployments/$id")({
  head: () => ({ meta: [{ title: "Deployment · iterate" }] }),
  component: DeploymentPage,
});

/** Keyed by the id: nothing of one deployment (a revealed password, read output, an error, the
 *  last live value) shows on another's page. */
function DeploymentPage() {
  const { id } = Route.useParams();
  return <Deployment key={id} id={id} />;
}

function Deployment({ id }: { id: string }) {
  const deployment = useDeployment(id);
  const state = deployment.value;
  if (!state)
    return deployment.error ? <ErrorMessage>{deployment.error}</ErrorMessage> : <Spinner />;
  return (
    <DeploymentBody
      id={id}
      state={state}
      connection={<Connection live={deployment} />}
      actions={deployment.handle}
    />
  );
}
