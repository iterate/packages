// /integrations/cloudflare — the person's Cloudflare connections at the Cloud: each consent, the
// login that gave it and the accounts its token reaches. A new deployment connects an account in
// its wizard; this page shows what stands.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ErrorMessage } from "@iterate-com/ui/components/standalone-page";
import { Badge } from "@iterate-com/ui/components/ui/badge";
import { buttonVariants } from "@iterate-com/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iterate-com/ui/components/ui/card";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import { usePerson } from "../../lib/iterate.ts";

export const Route = createFileRoute("/_app/integrations/cloudflare")({
  head: () => ({ meta: [{ title: "Cloudflare · iterate" }] }),
  component: CloudflareIntegration,
});

function CloudflareIntegration() {
  const person = usePerson();
  const connections = person.value?.connections || [];
  return (
    <>
      <h1 className="text-xl font-semibold">Cloudflare</h1>
      {person.error ? <ErrorMessage>{person.error}</ErrorMessage> : null}
      <Card>
        <CardHeader>
          <CardTitle>Your Cloudflare accounts</CardTitle>
          <CardDescription>
            A deployment runs in one of your Cloudflare accounts. You connect an account when you
            make a deployment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!person.value ? (
            <Spinner />
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No account connected yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {[...connections].reverse().map((connection) => (
                <li key={connection.id} className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      connection.status === "connected"
                        ? "outline"
                        : connection.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {connection.status}
                  </Badge>
                  <span>{connection.cloudflareUser || "…"}</span>
                  {connection.accounts.length ? (
                    <span className="text-muted-foreground">
                      {connection.accounts.map((account) => account.name).join(", ")}
                    </span>
                  ) : null}
                  {connection.error ? (
                    <span className="text-destructive">{connection.error}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Link to="/deployments/new" className={buttonVariants({ className: "w-fit" })}>
            New deployment
          </Link>
        </CardContent>
      </Card>
    </>
  );
}
