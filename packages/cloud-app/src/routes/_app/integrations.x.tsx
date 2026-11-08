// /integrations/x — the person's X account at the Cloud: connected, with its handle, or the button
// that starts X's consent through the Cloud's own X client. `?x=1` is the consent coming back
// through the platform's callback: the person's facet settles it, asked by the page at once and by
// its own schedule after, and the page shows the account.
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { documentBasePath } from "@iterate-com/ui/apps/base-path";
import { ErrorMessage } from "@iterate-com/ui/components/standalone-page";
import { Button } from "@iterate-com/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iterate-com/ui/components/ui/card";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import { callPerson, useMe, usePerson } from "../../lib/iterate.ts";

export const Route = createFileRoute("/_app/integrations/x")({
  validateSearch: z.object({ x: z.string().optional().catch(undefined) }),
  head: () => ({ meta: [{ title: "X · iterate" }] }),
  component: XIntegration,
});

function XIntegration() {
  const me = useMe();
  const person = usePerson();
  const navigate = useNavigate();
  const { x: returned } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  // back from X's consent: settle it. The platform's callback may still be storing the tokens
  // when the browser arrives, so a pending answer is asked again, a few times, and a call that
  // failed counts as one. The facet's own schedule asks on after that (@iterate-com/cloud
  // durable-object.ts `connectX`), and the live state shows the outcome; the query is dropped once
  // the page has asked.
  useEffect(() => {
    if (!returned) return;
    let stopped = false;
    const settle = async () => {
      for (let attempt = 0; attempt < 10 && !stopped; attempt++) {
        const { status } = await callPerson(me, (facet) => facet.settleX()).catch(() => ({
          status: "pending" as const,
        }));
        if (status !== "pending") break;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      if (!stopped) void navigate({ to: "/integrations/x", search: {}, replace: true });
    };
    void settle();
    return () => {
      stopped = true;
    };
  }, [returned, me, navigate]);
  const x = person.value?.x || null;
  const connect = () =>
    void callPerson(me, (facet) => facet.connectX({ next: returnPage() })).then(
      ({ url }) => location.assign(url),
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
    );
  return (
    <>
      <h1 className="text-xl font-semibold">X</h1>
      {person.error ? <ErrorMessage>{person.error}</ErrorMessage> : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      <Card>
        <CardHeader>
          <CardTitle>Your X account</CardTitle>
          <CardDescription>
            Your deployments read your posts, likes, bookmarks and direct messages through the
            Cloud, and hear what you write to @iterate.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!person.value ? (
            <Spinner />
          ) : x?.status === "connected" ? (
            <p className="text-sm">
              Connected as <span className="font-mono">@{x.username}</span>
            </p>
          ) : (
            <>
              {x?.status === "pending" ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner /> Waiting for X
                </p>
              ) : null}
              {x?.status === "failed" ? <ErrorMessage>{x.error}</ErrorMessage> : null}
              <Button className="w-fit" onClick={connect}>
                Connect X
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** This page, as the platform's callback sends the browser back to it. Under paths ingress the
 *  platform composes `/projects/<project>/<routingSlug><path>`. */
function returnPage() {
  return documentBasePath()
    ? { routingSlug: "integrations", path: "/x" }
    : { path: "/integrations/x" };
}
