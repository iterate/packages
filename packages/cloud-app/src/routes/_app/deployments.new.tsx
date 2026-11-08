// /deployments/new — the first deployment, or another: @iterate-com/cloud/wizard's state machine, drawn. The
// machine owns every move; this page draws its view and hands it the person's live state.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { resourcesOf } from "@iterate-com/cloud/views";
import { Wizard, type Draft, type WizardView } from "@iterate-com/cloud/wizard";
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
    case "connect":
      return <ConnectStep view={view} wizard={wizard} />;
    case "account":
      return <AccountStep view={view} wizard={wizard} />;
    case "name":
      return <NameStep view={view} wizard={wizard} />;
    case "review":
      return <ReviewStep view={view} wizard={wizard} />;
  }
}

type StepOf<K extends WizardView["step"]> = {
  view: Extract<WizardView, { step: K }>;
  wizard: Wizard;
};

function ConnectStep({ view, wizard }: StepOf<"connect">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cloudflare account</CardTitle>
        <CardDescription>iterate deploys into an account you own.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 font-readme text-sm">
        {view.last?.status === "pending" ? (
          <ErrorMessage>Your last connect did not finish. Connect again.</ErrorMessage>
        ) : null}
        {view.last?.status === "failed" ? <ErrorMessage>{view.last.error}</ErrorMessage> : null}
        {view.error ? <ErrorMessage>{view.error}</ErrorMessage> : null}
      </CardContent>
      <CardFooter>
        <Button onClick={() => void wizard.connect()} disabled={view.busy}>
          {view.busy ? <Spinner data-icon="inline-start" /> : null}
          Connect Cloudflare
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
    connection: z.string(),
    accountId: z.string(),
    name: z.string(),
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
