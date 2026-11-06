import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Plus } from "lucide-react";
import { installStatusOf } from "@iterate-com/cloud/views";
import type { DeploymentRecord } from "@iterate-com/cloud/records";
import { Badge } from "@iterate-com/ui/components/ui/badge";
import { buttonVariants } from "@iterate-com/ui/components/ui/button";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iterate-com/ui/components/ui/table";
import { Connection } from "../../components/connection.tsx";
import { useDeployment, usePerson } from "../../lib/live.ts";

/** The person's deployments, live from their own context, each row live from its own. With none
 *  yet, the wizard. */
export const Route = createFileRoute("/_app/deployments/")({
  head: () => ({ meta: [{ title: "Deployments · iterate" }] }),
  component: Deployments,
});

function Deployments() {
  const person = usePerson();
  const navigate = useNavigate();
  const deployments = person.value?.deployments;
  useEffect(() => {
    if (deployments?.length === 0) void navigate({ to: "/new", replace: true });
  }, [deployments, navigate]);
  return (
    <>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Deployments</h1>
        <Connection live={person} />
        <Link to="/new" className={buttonVariants({ className: "ml-auto" })}>
          <Plus data-icon="inline-start" />
          New deployment
        </Link>
      </div>
      {deployments?.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Cloudflare account</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...deployments].reverse().map((deployment) => (
              <Row key={deployment.id} record={deployment} />
            ))}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
}

function Row({ record }: { record: DeploymentRecord }) {
  const deployment = useDeployment(record.id);
  const state = deployment.value;
  const status = state ? installStatusOf(state) : null;
  return (
    <TableRow>
      <TableCell className="font-mono font-medium">
        <Link
          to="/deployments/$id"
          params={{ id: record.id }}
          className="underline-offset-4 hover:underline"
        >
          {record.name}
        </Link>
      </TableCell>
      <TableCell>
        {status ? (
          <Badge
            variant={
              status === "failed" ? "destructive" : status === "installed" ? "outline" : "secondary"
            }
          >
            {STATUS[status]}
          </Badge>
        ) : (
          <Spinner />
        )}
      </TableCell>
      <TableCell>
        {state?.url ? (
          <a
            href={state.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            {new URL(state.url).host}
            <ArrowUpRight className="size-3" />
          </a>
        ) : null}
      </TableCell>
      <TableCell>{record.accountName}</TableCell>
    </TableRow>
  );
}

const STATUS = {
  "not-started": "not started",
  installing: "installing",
  installed: "installed",
  failed: "stopped",
  destroyed: "destroyed",
};
