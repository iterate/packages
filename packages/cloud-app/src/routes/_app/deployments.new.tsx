// /deployments/new — the first deployment, or another: @iterate-com/cloud/wizard's state machine, drawn. The
// machine owns every move; this page draws its view and hands it the person's live state.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { resourcesOf } from "@iterate-com/cloud/views";
import { HOW, Wizard, type Draft, type WizardView } from "@iterate-com/cloud/wizard";
import { ErrorMessage } from "@iterate-com/ui/components/standalone-page";
import { Button } from "@iterate-com/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@iterate-com/ui/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@iterate-com/ui/components/ui/field";
import { Input } from "@iterate-com/ui/components/ui/input";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import { documentBasePath } from "@iterate-com/ui/apps/base-path";
import { callPerson, useMe, usePerson } from "../../lib/iterate.ts";

export const Route = createFileRoute("/_app/deployments/new")({
  validateSearch: z.object({ connection: z.string().optional().catch(undefined) }),
  head: () => ({ meta: [{ title: "New deployment · iterate" }] }),
  component: NewDeployment,
});

function NewDeployment() {
  const navigate = useNavigate();
  const me = useMe();
  // each call goes through the tab's current socket (lib/iterate.ts), so the wizard outlives a reconnect
  const wizard = useMemo(
    () =>
      new Wizard({
        connect: () => callPerson(me, (person) => person.connectCloudflare({ next: returnPage() })),
        settle: (connection) => callPerson(me, (person) => person.settleConnection(connection)),
        checkName: (input) => callPerson(me, (person) => person.checkName(input)),
        checkAccount: (input) => callPerson(me, (person) => person.checkAccount(input)),
        listZones: (input) => callPerson(me, (person) => person.listZones(input)),
        checkHostname: (input) => callPerson(me, (person) => person.checkHostname(input)),
        create: (input) => callPerson(me, (person) => person.createDeployment(input)),
        // the deployment's page in this app; Cloudflare's consent through the platform elsewhere
        navigate: (url) =>
          url.startsWith("/") ? void navigate({ href: url }) : location.assign(url),
        storage: draftStorage,
        search: location.search,
        newRequestId: () => crypto.randomUUID().replaceAll("-", ""),
      }),
    [me, navigate],
  );
  const view = useSyncExternalStore(
    (listener) => wizard.subscribe(listener),
    () => wizard.view(),
    () => wizard.view(),
  );
  const person = usePerson();
  useEffect(() => {
    if (person.value) wizard.update(person.value);
  }, [person.value, wizard]);
  // back from Cloudflare's consent: the wizard settles the connect before it draws a step from it
  useEffect(() => void wizard.settleReturn(), [wizard]);
  return (
    <>
      <h1 className="text-xl font-semibold">New deployment</h1>
      {person.error ? <ErrorMessage>{person.error}</ErrorMessage> : null}
      {wizard.returnError() ? <ErrorMessage>{wizard.returnError()}</ErrorMessage> : null}
      <Step view={view} wizard={wizard} />
    </>
  );
}

/** Where the platform's OAuth callback sends a connect back: this page, a page of the Cloud's
 *  project, to which the person's facet adds `connection=<id>`. Under paths ingress a project's
 *  apex has no sub-paths: the platform composes `/projects/<project>/<routingSlug><path>`, and the
 *  config worker folds the slug back into the path (@iterate-com/cloud worker.ts). */
function returnPage() {
  return documentBasePath()
    ? { routingSlug: "deployments", path: "/new" }
    : { path: "/deployments/new" };
}

function Step({ view, wizard }: { view: WizardView; wizard: Wizard }) {
  switch (view.step) {
    case "loading":
      return <Spinner />;
    case "how":
      return <HowStep wizard={wizard} />;
    case "connect":
      return <ConnectStep view={view} wizard={wizard} />;
    case "account":
      return <AccountStep view={view} wizard={wizard} />;
    case "ready":
      return <ReadyStep view={view} wizard={wizard} />;
    case "name":
      return <NameStep view={view} wizard={wizard} />;
    case "project":
      return <ProjectStep view={view} wizard={wizard} />;
    case "domain":
      return <DomainStep view={view} wizard={wizard} />;
    case "review":
      return <ReviewStep view={view} wizard={wizard} />;
  }
}

type StepOf<K extends WizardView["step"]> = {
  view: Extract<WizardView, { step: K }>;
  wizard: Wizard;
};

function HowStep({ wizard }: { wizard: Wizard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where should iterate run?</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {HOW.map((how) => (
          <Button
            key={how.id}
            variant="outline"
            className="h-auto justify-between py-2"
            disabled={!how.available}
            onClick={() => wizard.chooseHow(how.id)}
          >
            <span>{how.label}</span>
            {how.available ? null : (
              <span className="text-xs text-muted-foreground">Coming soon</span>
            )}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function ConnectStep({ view, wizard }: StepOf<"connect">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cloudflare account</CardTitle>
        <CardDescription>
          {view.again
            ? "Connect again: iterate now also adds DNS records."
            : "iterate deploys into an account you own."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 font-readme text-sm">
        {view.last?.status === "pending" ? (
          <ErrorMessage>Your last connect did not finish. Connect again.</ErrorMessage>
        ) : null}
        {view.last?.status === "failed" ? <ErrorMessage>{view.last.error}</ErrorMessage> : null}
        {view.error ? <ErrorMessage>{view.error}</ErrorMessage> : null}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={() => void wizard.connect()} disabled={view.busy}>
          {view.busy ? <Spinner data-icon="inline-start" /> : null}
          Connect Cloudflare
        </Button>
        <Button variant="ghost" onClick={() => wizard.back()} disabled={view.busy}>
          Back
        </Button>
      </CardFooter>
    </Card>
  );
}

function AccountStep({ view, wizard }: StepOf<"account">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose the account</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {view.choices.map((choice) => (
          <Button
            key={`${choice.connection}:${choice.account.id}`}
            variant="outline"
            className="h-auto justify-start py-2"
            onClick={() => wizard.choose(choice)}
          >
            <span className="flex flex-col items-start">
              <span>{choice.account.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{choice.account.id}</span>
            </span>
          </Button>
        ))}
      </CardContent>
      <CardFooter>
        <Button variant="ghost" onClick={() => wizard.connectAnother()}>
          Connect another
        </Button>
      </CardFooter>
    </Card>
  );
}

function ReadyStep({ view, wizard }: StepOf<"ready">) {
  const rows = [
    ["Workers Paid", view.readiness?.workersPaid],
    ["R2", view.readiness?.r2],
    ["Containers", view.readiness?.containers],
  ] as const;
  const blocked = rows.some(([, value]) => value === false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Is {view.choice.account.name} ready?</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 font-readme text-sm">
        <ul className="flex flex-col gap-1">
          {rows.map(([label, value]) => (
            <li key={label} className="flex gap-2">
              <span className="w-5">
                {view.checking ? <Spinner /> : value === true ? "✓" : value === false ? "✗" : "?"}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ul>
        {view.readiness?.message ? <Linked text={view.readiness.message} /> : null}
        {view.error ? <ErrorMessage>{view.error}</ErrorMessage> : null}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={() => void wizard.checkAccount()} disabled={view.checking}>
          Check again
        </Button>
        {!view.checking && view.readiness && !blocked ? (
          <Button variant="outline" onClick={() => wizard.continueReady()}>
            Continue
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => wizard.back()} disabled={view.checking}>
          Back
        </Button>
      </CardFooter>
    </Card>
  );
}

/** A message whose last word may be a link: the dashboard page that fixes it. */
function Linked({ text }: { text: string }) {
  const url = /https:\/\/\S+$/.exec(text)?.[0];
  if (!url) return <p>{text}</p>;
  return (
    <p>
      {text.slice(0, -url.length)}
      <a className="underline" href={url} target="_blank" rel="noreferrer">
        {new URL(url).host}
        {new URL(url).pathname}
      </a>
    </p>
  );
}

function NameStep({ view, wizard }: StepOf<"name">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Name it</CardTitle>
        <CardDescription>In {view.choice.account.name}.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="name"
          onSubmit={(event) => {
            event.preventDefault();
            void wizard.submitName();
          }}
        >
          <Field data-invalid={Boolean(view.error)}>
            <FieldLabel htmlFor="deployment-name">Name</FieldLabel>
            <Input
              id="deployment-name"
              value={view.value}
              disabled={view.checking}
              onChange={(event) => wizard.type(event.currentTarget.value)}
              autoFocus
              className="font-mono"
            />
            <FieldDescription>The Worker's name, and the prefix of its resources.</FieldDescription>
            {view.error ? <FieldError>{view.error}</FieldError> : null}
          </Field>
        </form>
      </CardContent>
      <CardFooter className="gap-2">
        <Button type="submit" form="name" disabled={view.checking}>
          {view.checking ? <Spinner data-icon="inline-start" /> : null}
          {view.checking ? "Checking…" : "Continue"}
        </Button>
        <Button variant="ghost" onClick={() => wizard.back()} disabled={view.checking}>
          Back
        </Button>
      </CardFooter>
    </Card>
  );
}

function ProjectStep({ view, wizard }: StepOf<"project">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your first project</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          id="project"
          onSubmit={(event) => {
            event.preventDefault();
            wizard.submitProject();
          }}
        >
          <Field data-invalid={Boolean(view.error)}>
            <FieldLabel htmlFor="project-slug">Project</FieldLabel>
            <Input
              id="project-slug"
              value={view.value}
              onChange={(event) => wizard.type(event.currentTarget.value)}
              autoFocus
              className="font-mono"
            />
            {view.error ? <FieldError>{view.error}</FieldError> : null}
          </Field>
        </form>
      </CardContent>
      <CardFooter className="gap-2">
        <Button type="submit" form="project">
          Continue
        </Button>
        <Button variant="ghost" onClick={() => wizard.back()}>
          Back
        </Button>
      </CardFooter>
    </Card>
  );
}

function DomainStep({ view, wizard }: StepOf<"domain">) {
  const zone = view.zones?.find((known) => known.id === view.zoneId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Which domain is iterate's?</CardTitle>
        <CardDescription>
          It becomes {view.project}'s site, with every name under it, and iterate answers at
          iterate.&lt;domain&gt;.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 font-readme text-sm">
        {view.zones ? null : <Spinner />}
        <form
          id="domain"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void wizard.submitDomain();
          }}
        >
          <div className="flex flex-col gap-1">
            {(view.zones || []).map((known) => (
              <label key={known.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="zone"
                  checked={view.zoneId === known.id}
                  onChange={() => wizard.chooseZone(known.id)}
                />
                <span className="font-mono">{known.name}</span>
              </label>
            ))}
            {view.zones ? (
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="zone"
                  checked={view.zoneId === ""}
                  onChange={() => wizard.chooseZone("")}
                />
                <span>workers.dev only</span>
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-muted-foreground">
              <input type="radio" name="zone" disabled />
              <span>
                <span className="font-mono">{view.project}.iterate.app</span> · Coming soon
              </span>
            </label>
          </div>
          {zone ? (
            <p className="font-mono text-xs text-muted-foreground">
              {zone.name} · iterate.{zone.name}
            </p>
          ) : null}
          {view.error ? <ErrorMessage>{view.error}</ErrorMessage> : null}
        </form>
      </CardContent>
      <CardFooter className="gap-2">
        <Button type="submit" form="domain" disabled={view.checking || !view.zones}>
          {view.checking ? <Spinner data-icon="inline-start" /> : null}
          {view.checking ? "Checking…" : "Continue"}
        </Button>
        <Button variant="ghost" onClick={() => wizard.back()} disabled={view.checking}>
          Back
        </Button>
      </CardFooter>
    </Card>
  );
}

function ReviewStep({ view, wizard }: StepOf<"review">) {
  const resources = resourcesOf(view.name);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review</CardTitle>
        <CardDescription>Install creates these in {view.choice.account.name}.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 font-readme text-sm">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
          <dt className="text-muted-foreground">Account</dt>
          <dd>
            {view.choice.account.name}{" "}
            <span className="font-mono text-xs text-muted-foreground">
              {view.choice.account.id}
            </span>
          </dd>
          <dt className="text-muted-foreground">Project</dt>
          <dd className="font-mono">{view.project}</dd>
          <dt className="text-muted-foreground">Domain</dt>
          <dd className="font-mono">
            {view.domain
              ? `${view.domain.hostname} (${view.project}'s site) · iterate.${view.domain.hostname}`
              : "workers.dev only"}
          </dd>
        </dl>
        <ul className="flex flex-col gap-1">
          {resources.map((resource) => (
            <li key={`${resource.kind}:${resource.name}`} className="flex flex-wrap gap-x-2">
              <span className="w-44 text-muted-foreground">{resource.kind}</span>
              <span className="font-mono">{resource.name}</span>
            </li>
          ))}
        </ul>
        {view.error ? <ErrorMessage>{view.error}</ErrorMessage> : null}
      </CardContent>
      <CardFooter className="gap-2">
        <Button onClick={() => void wizard.install()} disabled={view.busy}>
          {view.busy ? <Spinner data-icon="inline-start" /> : null}
          Install
        </Button>
        <Button variant="ghost" onClick={() => wizard.back()} disabled={view.busy}>
          Back
        </Button>
      </CardFooter>
    </Card>
  );
}

/** A draft as this browser stored it: anything else reads as no draft. */
const StoredDraft = z
  .object({
    how: z.enum(["cloudflare", "hosted", "machine"]),
    connection: z.string(),
    accountId: z.string(),
    name: z.string(),
    project: z.string(),
    zoneId: z.string(),
    request: z.string(),
  })
  .partial()
  .catch({});

/** The wizard's draft, in this browser: a closed tab and the round trip to Cloudflare find it. A
 *  browser that keeps nothing (a private window that refuses storage) starts each visit afresh. */
const draftStorage = {
  read(): Draft {
    try {
      return StoredDraft.parse(JSON.parse(localStorage.getItem("iterate-cloud/new") || "{}"));
    } catch {
      return {};
    }
  },
  write(draft: Draft) {
    try {
      localStorage.setItem("iterate-cloud/new", JSON.stringify(draft));
    } catch {
      // the browser keeps nothing: the wizard still works, for this visit
    }
  },
};
