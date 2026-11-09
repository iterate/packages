// /deployments/<id> — one deployment, live from its own context; components/deployment-body.tsx
// draws it.
import { createFileRoute } from "@tanstack/react-router";
import { ErrorMessage } from "@iterate-com/ui/components/standalone-page";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import { Connection } from "../../components/connection.tsx";
import { DeploymentBody, type DeploymentActions } from "../../components/deployment-body.tsx";
import {
  callDeployment,
  callPerson,
  useDeploymentLive,
  useMe,
  type Me,
} from "../../lib/iterate.ts";

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
  const me = useMe();
  const deployment = useDeploymentLive(me, id);
  const state = deployment.value;
  if (!state)
    return deployment.error ? <ErrorMessage>{deployment.error}</ErrorMessage> : <Spinner />;
  return (
    <DeploymentBody
      id={id}
      state={state}
      connection={<Connection live={deployment} />}
      actions={actionsOf(me, id)}
    />
  );
}

/** What the page asks of the deployment: its own facet's lent methods, and the person's for a
 *  creation that stopped before the deployment's request. */
const actionsOf = (me: Me, id: string): DeploymentActions => ({
  requestCreation: () => callPerson(me, (person) => person.finishCreation(id)),
  prepareAgain: () => callDeployment(me, id, (deployment) => deployment.prepareAgain()),
  requestRun: (kind) => callDeployment(me, id, (deployment) => deployment.requestRun(kind)),
  readOutput: (requestOffset, step) =>
    callDeployment(me, id, (deployment) => deployment.readOutput(requestOffset, step)),
  signInPassword: () => callDeployment(me, id, (deployment) => deployment.signInPassword()),
  proveAgain: () => callDeployment(me, id, (deployment) => deployment.proveAgain()),
});
