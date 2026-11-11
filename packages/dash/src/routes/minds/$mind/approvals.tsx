// The requests that wait for a member's signed yes, across the mind's secrets. The Dash cannot
// sign: a passkey is bound to the mind's own address, so each request links to the platform's
// `/secrets/approvals` page in a new tab.
import { useEffect, type ReactNode } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { platformOriginOf } from "iterate/mind-api";
import { Badge } from "@iterate-com/ui/components/ui/badge";
import { Button } from "@iterate-com/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iterate-com/ui/components/ui/table";
import { Identifier } from "../../../components/identifier.tsx";
import { NotServedYet } from "../../../components/not-served-yet.tsx";
import { mindApprovalsOf, type HeldRequest } from "../../../lib/approvals.ts";
import { askWaitingApprovals, readMindApprovals } from "../../../lib/approvals-read.ts";
import type { HeldAct } from "../../../lib/held-acts.ts";

export const Route = createFileRoute("/minds/$mind/approvals")({
  loader: async ({ context }) => {
    const approvals = await readMindApprovals(context.read);
    // the shell's count follows what this page just read
    askWaitingApprovals(context.mind);
    return approvals;
  },
  staticData: { page: "Approvals" },
  head: ({ params }) => ({ meta: [{ title: `Approvals · ${params.mind} · Dash` }] }),
  component: MindApprovals,
});

/** In UTC, so the server and the browser render the same text. */
const TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const timeOf = (at: string) => `${TIME.format(Date.parse(at))} UTC`;

function MindApprovals() {
  const data = Route.useLoaderData();
  if (!data.served) return <NotServedYet title="Approvals" what="secrets" />;
  return <Approvals {...data} />;
}

function Approvals({
  waiting,
  approved,
  decided,
  rules,
  acts,
}: ReturnType<typeof mindApprovalsOf> & { acts: HeldAct[] }) {
  const { mind } = Route.useRouteContext();
  const router = useRouter();
  const approvalsPage = `${platformOriginOf(mind)}/secrets/approvals`;
  const live = waiting.length > 0 || approved.length > 0 || acts.length > 0;

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void router.invalidate(), 5000);
    return () => clearInterval(timer);
  }, [live, router]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="font-readme text-sm text-muted-foreground">
          A request with a secret that has a rule waits here until a member approves it. You approve
          on the mind's own address, because your passkey or security key only signs there.
        </p>
      </div>

      {/* a mail or a call of a verb that a rule holds: shown only while one waits */}
      {acts.length > 0 ? (
        <Part
          id="approvals-acts"
          title="Mail and calls that wait"
          headings={["What", "Kind", "Since", "From", "Action"]}
          empty={false}
        >
          {acts.map((act) => (
            <TableRow key={act.digest} data-held-act={act.digest}>
              <TableCell className="max-w-md align-top whitespace-normal">
                {act.summary}
                <p className="mt-1 font-mono text-2xs text-muted-foreground">
                  Act {act.digest.slice(0, 12)}
                </p>
              </TableCell>
              <TableCell className="align-top">
                <Identifier value={act.act} />
              </TableCell>
              <TableCell className="align-top text-muted-foreground">
                {timeOf(act.heldAt)}
              </TableCell>
              <TableCell className="align-top">
                {act.from ? (
                  <>
                    <span className="font-mono text-xs wrap-anywhere">{act.from}</span>
                    <p className="text-2xs text-muted-foreground">as the platform claims</p>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="align-top">
                <Button
                  size="sm"
                  render={
                    <a
                      // the mind's page ticks the one row that its link names
                      href={`${approvalsPage}?digest=${encodeURIComponent(act.digest)}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Review and approve: ${act.summary}`}
                    />
                  }
                  nativeButton={false}
                >
                  Review and approve
                  <ExternalLink data-icon="inline-end" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </Part>
      ) : null}

      <Part
        id="approvals-waiting"
        title="Waiting"
        headings={["Request", "Secret", "Since", "From", "Action"]}
        empty={waiting.length === 0 && "Nothing waits for approval."}
      >
        {waiting.map((request) => (
          <TableRow key={request.digest}>
            <TableCell className="max-w-md align-top whitespace-normal">
              <RequestLine request={request} />
              {request.bodyStart ? (
                <pre className="mt-1 max-h-24 overflow-hidden font-mono text-xs whitespace-pre-wrap text-muted-foreground wrap-anywhere">
                  {request.bodyStart}
                </pre>
              ) : null}
              <p className="mt-1 font-mono text-2xs text-muted-foreground">
                Request {request.digest.slice(0, 12)}
              </p>
            </TableCell>
            <TableCell className="align-top">
              <Identifier value={request.secret} />
            </TableCell>
            <TableCell className="align-top text-muted-foreground">
              {timeOf(request.requestedAt)}
            </TableCell>
            <TableCell className="align-top">
              {request.from ? (
                <>
                  <span className="font-mono text-xs wrap-anywhere">{request.from}</span>
                  <p className="text-2xs text-muted-foreground">as the platform claims</p>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="align-top">
              <Button
                size="sm"
                render={
                  <a
                    href={`${approvalsPage}?digest=${encodeURIComponent(request.digest)}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Review and approve ${request.method} ${request.url}`}
                  />
                }
                nativeButton={false}
              >
                Review and approve
                <ExternalLink data-icon="inline-end" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </Part>

      <Part
        id="approvals-rules"
        title="Rules"
        action={
          <Button
            variant="outline"
            size="sm"
            render={
              <a
                href={approvalsPage}
                target="_blank"
                rel="noreferrer"
                aria-label="Set or change a rule"
              />
            }
            nativeButton={false}
          >
            Set or change a rule
            <ExternalLink data-icon="inline-end" />
          </Button>
        }
        headings={["Secret", "Methods", "Hosts"]}
        empty={
          rules.length === 0 &&
          "No secret has a rule. A rule names the methods and hosts whose requests with a secret wait for a member's approval; set one on the mind's approvals page."
        }
      >
        {rules.map(({ secret, rule }) => (
          <TableRow key={secret}>
            <TableCell>
              <Identifier value={secret} />
            </TableCell>
            <TableCell className="font-mono text-xs">{rule.methods.join(", ")}</TableCell>
            <TableCell className="font-mono text-xs">{rule.hosts.join(", ")}</TableCell>
          </TableRow>
        ))}
      </Part>

      <Part
        id="approvals-decided"
        title="Recently decided"
        headings={["Request", "Decision", "By", "Sent"]}
        empty={decided.length === 0 && "No decisions yet."}
      >
        {decided.slice(0, 20).map((decision) => (
          <TableRow key={`${decision.digest}-${decision.decidedAt}`}>
            <TableCell className="max-w-md align-top whitespace-normal">
              <RequestLine request={decision} />
              <p className="mt-1 font-mono text-xs text-muted-foreground">{decision.secret}</p>
            </TableCell>
            <TableCell className="align-top">
              <Badge variant={decision.decision === "approved" ? "secondary" : "destructive"}>
                {decision.decision === "approved" ? "Approved" : "Rejected"}
              </Badge>
              <p className="mt-1 text-xs text-muted-foreground">{timeOf(decision.decidedAt)}</p>
              {decision.reason ? (
                <p className="mt-1 font-readme text-xs wrap-anywhere">{decision.reason}</p>
              ) : null}
            </TableCell>
            <TableCell className="align-top">
              <span className="wrap-anywhere">{decision.signer}</span>
              <p className="text-xs text-muted-foreground">{decision.keyLabel}</p>
            </TableCell>
            <TableCell className="align-top text-muted-foreground">
              {decision.sent
                ? `Sent, ${decision.sent.status}`
                : decision.decision === "approved"
                  ? "Not sent yet"
                  : "—"}
            </TableCell>
          </TableRow>
        ))}
      </Part>
    </div>
  );
}

function Part({
  id,
  title,
  action,
  headings,
  empty,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  headings: string[];
  empty: string | false;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${id}-title`}>
      <div className="flex items-center justify-between gap-4">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {empty ? (
        <p className="font-readme text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid={id}>
            <TableHeader>
              <TableRow>
                {headings.map((heading) => (
                  <TableHead key={heading}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>{children}</TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function RequestLine({ request }: { request: HeldRequest }) {
  return (
    <p className="font-mono text-xs wrap-anywhere">
      <span className="font-semibold">{request.method}</span> {request.url}
    </p>
  );
}
