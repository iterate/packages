// The deployment page's body (routes/_app/deployments.$id.tsx): its record, the config its runs use
// (secrets masked), the Worker's URL, the current or last run with its named steps, their lines and
// Alchemy's resources, and the runs a person may ask for. Pure: state and actions come in as props.
import { useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { isMasked, signInOf } from "@iterate-com/cloud/config";
import type { RunKind, RunStep } from "@iterate-com/cloud/records";
import {
  installStatusOf,
  installStepsOf,
  runStepsOf,
  type DeploymentView,
} from "@iterate-com/cloud/views";
import { ErrorMessage } from "@iterate-com/ui/components/standalone-page";
import { Badge } from "@iterate-com/ui/components/ui/badge";
import { Button, buttonVariants } from "@iterate-com/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iterate-com/ui/components/ui/card";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import { Steps } from "./steps.tsx";

/** What the page asks of the deployment: the facets lent to the person
 *  (routes/_app/deployments.$id.tsx), or a stand-in where there is no backend (preview/). */
export type DeploymentActions = {
  requestCreation(): Promise<unknown>;
  prepareAgain(): Promise<unknown>;
  requestRun(kind: RunKind): Promise<unknown>;
  readOutput(requestOffset: number, step: RunStep): Promise<{ lines: string[] }>;
  signInPassword(): Promise<string | null>;
};

type Run = NonNullable<DeploymentView["run"]>;
type Act = (work: Promise<unknown>) => void;
type ReadAllOf = (requestOffset: number | undefined) => (step: RunStep) => Promise<string[]>;

/** One deployment's page from its state: the route draws it live, the preview from a recorded
 *  run. `connection` is the live socket's badge. */
export function DeploymentBody({
  id,
  state,
  connection,
  actions,
}: {
  id: string;
  state: DeploymentView;
  connection: ReactNode;
  actions: DeploymentActions;
}) {
  const [error, setError] = useState<string | null>(null);
  const { record, run } = state;
  const act: Act = (work) =>
    void work.then(
      () => setError(null),
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
    );
  // a step's every line, of the run a card shows
  const readAllOf: ReadAllOf = (requestOffset) => (step) =>
    requestOffset === undefined
      ? Promise.resolve([])
      : actions.readOutput(requestOffset, step).then((read) => read.lines);
  const status = installStatusOf(state);
  // installed, or destroyed since: the page shows the newest run, and the runs a person may ask for
  const hasRun = status === "installed" || status === "destroyed";
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-semibold">{record?.name || id}</h1>
        {status === "destroyed" ? (
          <span className="text-sm text-muted-foreground">destroyed</span>
        ) : null}
        {connection}
        {hasRun ? <RunButtons open={run?.status === "open"} actions={actions} act={act} /> : null}
      </div>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {hasRun ? (
        <>
          {state.url && record ? (
            <RunningCard
              url={state.url}
              email={record.owner.email}
              config={state.config}
              actions={actions}
              act={act}
            />
          ) : null}
          {run ? <RunCard run={run} readAllOf={readAllOf} /> : null}
        </>
      ) : (
        <InstallCard
          state={state}
          status={status}
          actions={actions}
          act={act}
          readAllOf={readAllOf}
        />
      )}
      {record ? <DetailsCard state={state} /> : null}
      {state.history.length ? <HistoryCard history={state.history} /> : null}
    </>
  );
}

function RunButtons({
  open,
  actions,
  act,
}: {
  open: boolean;
  actions: DeploymentActions;
  act: Act;
}) {
  return (
    <div className="ml-auto flex gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={open}
        onClick={() => act(actions.requestRun("plan"))}
      >
        Plan
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={open}
        onClick={() => act(actions.requestRun("deploy"))}
      >
        Deploy again
      </Button>
    </div>
  );
}

/** The running deployment: Open, and how its owner signs in there. One made since the Cloud signs
 *  owners in through its platform opens through the deployment's sign-in, a chain that ends in the
 *  Dash; one made before has a password the Cloud shows. */
function RunningCard({
  url,
  email,
  config,
  actions,
  act,
}: {
  url: string;
  email: string;
  config: DeploymentView["config"];
  actions: DeploymentActions;
  act: Act;
}) {
  const signIn = config ? signInOf(config) : "password";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your iterate is running</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <a
          href={signIn === "iterate" ? new URL("/.auth/sign-in/iterate?next=/", url).href : url}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ size: "lg", className: "w-fit max-w-full" })}
        >
          {/* a deployment's host is long: it truncates on a narrow screen, the link keeps it whole */}
          <span className="truncate">Open {new URL(url).host}</span>
          <ArrowUpRight data-icon="inline-end" />
        </a>
        {signIn === "password" ? <PasswordRow email={email} actions={actions} act={act} /> : null}
      </CardContent>
    </Card>
  );
}

/** A deployment made before the Cloud signed owners in through its platform: its password, shown
 *  on a click. */
function PasswordRow({
  email,
  actions,
  act,
}: {
  email: string;
  actions: DeploymentActions;
  act: Act;
}) {
  const [password, setPassword] = useState<string | null>(null);
  return (
    <p className="flex flex-wrap items-center gap-2 font-readme text-sm">
      Sign in there as {email} with the password
      {password ? (
        <code className="rounded bg-muted px-1.5 py-0.5">{password}</code>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            act(
              actions.signInPassword().then((value) => {
                if (!value) throw new Error("No password for this deployment.");
                setPassword(value);
              }),
            )
          }
        >
          Show
        </Button>
      )}
    </p>
  );
}

/** The install as it goes: the installer's sandbox, then the newest deploy's steps (views.ts
 *  `installStepsOf`), and what a person may do when it stopped. */
function InstallCard({
  state,
  status,
  actions,
  act,
  readAllOf,
}: {
  state: DeploymentView;
  status: Exclude<ReturnType<typeof installStatusOf>, "installed" | "destroyed">;
  actions: DeploymentActions;
  act: Act;
  readAllOf: ReadAllOf;
}) {
  const { run } = state;
  const install =
    run?.kind === "deploy" ? run : state.history.findLast((known) => known.kind === "deploy");
  const prepared = state.preparation?.status;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {INSTALL_TITLES[status]}
          {status === "installing" ? <Spinner /> : null}
        </CardTitle>
        {status === "installing" ? (
          <CardDescription>You can close this page.</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Steps steps={installStepsOf(state)} readAll={readAllOf(install?.requestOffset)} />
        <div className="flex gap-2">
          {status === "not-started" ? (
            <Button onClick={() => act(actions.requestCreation())}>Start again</Button>
          ) : null}
          {status === "failed" && prepared === "failed" ? (
            <Button onClick={() => act(actions.prepareAgain())}>Try again</Button>
          ) : null}
          {status === "failed" && prepared === "succeeded" ? (
            <Button onClick={() => act(actions.requestRun("deploy"))}>Deploy again</Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function RunCard({ run, readAllOf }: { run: Run; readAllOf: ReadAllOf }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <CardTitle className="capitalize">{run.kind}</CardTitle>
        <RunBadge run={run} />
        <When iso={run.requestedAt} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Steps steps={runStepsOf(run)} readAll={readAllOf(run.requestOffset)} />
        {run.error && !run.steps.some((step) => step.status === "failed") ? (
          <ErrorMessage>{run.error}</ErrorMessage>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DetailsCard({ state }: { state: DeploymentView }) {
  const record = state.record!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deployment</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)] [&_dd]:mb-1 [&_dd]:break-words sm:[&_dd]:mb-0">
          <dt className="text-muted-foreground">Cloudflare account</dt>
          <dd>
            {record.accountName}{" "}
            <span className="font-mono text-xs text-muted-foreground">{record.accountId}</span>
          </dd>
          <dt className="text-muted-foreground">Who signs in</dt>
          <dd>{record.owner.email}</dd>
          <dt className="text-muted-foreground">Alchemy state</dt>
          <dd className="font-mono">
            {record.stack} in {record.store}
          </dd>
          <dt className="text-muted-foreground">Sandbox image</dt>
          <dd className="font-mono break-all">{state.image || "none"}</dd>
        </dl>
        {state.config ? <ConfigRow config={state.config} /> : null}
      </CardContent>
    </Card>
  );
}

/** The config the runs use, secrets masked: closed under its label until a click, as a step's
 *  lines are. */
function ConfigRow({ config }: { config: NonNullable<DeploymentView["config"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 self-start text-left text-muted-foreground hover:text-foreground"
      >
        Config
        <ChevronRight
          aria-hidden
          className={`size-3.5 text-muted-foreground/60 transition-transform${open ? " rotate-90" : ""}`}
        />
      </button>
      {open ? (
        <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
          {configText(config)}
        </pre>
      ) : null}
    </div>
  );
}

function HistoryCard({ history }: { history: Run[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Earlier runs</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 text-sm">
          {[...history].reverse().map((earlier) => (
            <li key={earlier.requestOffset} className="flex flex-wrap items-center gap-2">
              <span className="w-16 capitalize">{earlier.kind}</span>
              <RunBadge run={earlier} />
              <When iso={earlier.requestedAt} />
              {earlier.error ? <span className="text-destructive">{earlier.error}</span> : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RunBadge({ run }: { run: Run }) {
  if (run.status === "open")
    return <Badge variant="secondary">running, attempt {run.attempt}</Badge>;
  if (run.status === "succeeded") return <Badge variant="outline">succeeded</Badge>;
  return <Badge variant="destructive">{run.status}</Badge>;
}

/** When a run was asked for, in UTC: the same text on the server and in every browser. */
function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} className="text-sm text-muted-foreground">
      {iso.slice(0, 16).replace("T", " ")} UTC
    </time>
  );
}

/** The config as JSON, a masked value shown as hidden. */
const configText = (config: NonNullable<DeploymentView["config"]>) =>
  JSON.stringify(config, (_key, value: unknown) => (isMasked(value) ? "••••••••" : value), 2);

const INSTALL_TITLES = {
  "not-started": "Not started",
  installing: "Installing",
  failed: "The install stopped",
} as const;
