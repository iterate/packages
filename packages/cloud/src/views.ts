// cloud/views.ts — HOW THE CLOUD APP READS A DEPLOYMENT'S STATE: the steps a creation goes through,
// each with its real status, from the processor's state (deployment.ts) and nothing else. The page
// never folds events. Browser-safe: records.ts and config.ts only.
import { z } from "zod";
import { MaskedConfig, platformHostOf } from "./config.ts";
import {
  DeploymentState,
  stateOf,
  type DeploymentRecord,
  type Resource,
  type Run,
  type RunStep,
  type StepStatus,
} from "./records.ts";

/** A deployment's state as its page reads it, its live state: the config's secrets masked
 *  (deployment.ts). */
export const DeploymentView = DeploymentState.extend({
  config: MaskedConfig.nullable().default(null),
});
export type DeploymentView = z.infer<typeof DeploymentView>;

/** A step as the page draws it: its label and status, where it stopped and why, the newest of its
 *  text lines (`lines` in all), and on Alchemy's step the stack's resources. */
export type InstallStep = {
  id: "sandbox" | RunStep;
  label: string;
  status: StepStatus;
  error: string | null;
  tail: string[];
  lines: number;
  /** Whether the step printed lines beyond `tail`, which "Show all" reads. */
  more: boolean;
  resources: Resource[];
};

export const STEP_LABELS: Record<InstallStep["id"], string> = {
  sandbox: "Start the installer",
  namespace: "Make storage for your projects' code",
  dns: "Point your domain at the Worker",
  image: "Copy the sandbox image into your account",
  build: "Build iterate",
  alchemy: "Deploy the Worker and its resources",
  check: "Wait for your Worker to answer",
  repos: "Delete the storage of your projects' code",
};

/** What the creation's steps read of the state: no config, which the browser has masked. */
type Creation = Pick<DeploymentState, "record" | "preparation" | "run" | "history">;

/** The creation's steps: the installer's sandbox, then the newest deploy's own (the current run
 *  when it is a deploy, else the last one in the history). An error sits on the step it stopped
 *  at. */
export function installStepsOf(state: Creation): InstallStep[] {
  const { preparation } = state;
  const sandbox: InstallStep = {
    id: "sandbox",
    label: STEP_LABELS.sandbox,
    status: preparation
      ? preparation.status === "running"
        ? "running"
        : preparation.status
      : "pending",
    error: preparation?.error || null,
    tail: [],
    lines: 0,
    more: false,
    resources: [],
  };
  // the newest deploy: a retry that succeeded is the install's outcome
  const first =
    state.run?.kind === "deploy"
      ? state.run
      : state.history.findLast((run) => run.kind === "deploy") || null;
  const steps = runStepsOf(first || { kind: "deploy", steps: [], resources: [], error: null });
  // a run refused or failed before any step began says why on its first step
  if (
    first &&
    first.status !== "open" &&
    first.status !== "succeeded" &&
    !steps.some((step) => step.error)
  )
    steps[0] = { ...steps[0]!, status: "failed", error: first.error };
  return [sandbox, ...steps];
}

/** The steps of `run`, every step its kind goes through (the image copy only once reached), with
 *  what each printed. The script's own
 *  `== ` marker lines (runs.ts) are not shown. */
export function runStepsOf(
  run: Pick<Run, "kind" | "steps" | "resources" | "error">,
): InstallStep[] {
  // the image copy is listed only once the run reached it: a toolchain with no image source copies
  // none, and its runs never show the row (deployment.ts `reach`)
  const names = STEPS_OF[run.kind].filter(
    (name) => (name !== "image" && name !== "dns") || run.steps.some((step) => step.name === name),
  );
  return names.map((name): InstallStep => {
    const step = run.steps.find((candidate) => candidate.name === name);
    const status = step?.status || "pending";
    return {
      id: name,
      label:
        (name === "alchemy" && ALCHEMY_LABELS[run.kind]) ||
        (name === "dns" && run.kind === "destroy" && "Remove your domain's records") ||
        STEP_LABELS[name],
      status,
      error: status === "failed" ? run.error : null,
      tail: (step?.tail || []).filter((line) => !line.startsWith("== ")),
      lines: step?.lines || 0,
      more: (step?.lines || 0) > (step?.tail.length || 0),
      resources: name === "alchemy" ? run.resources : [],
    };
  });
}

/** Alchemy's step says what the run does to the stack; a deploy's is `STEP_LABELS.alchemy`. */
const ALCHEMY_LABELS: Partial<Record<Run["kind"], string>> = {
  plan: "Plan the Worker and its resources",
  destroy: "Delete the Worker and its resources",
};

const STEPS_OF: Record<Run["kind"], RunStep[]> = {
  plan: ["namespace", "image", "build", "alchemy"],
  deploy: ["namespace", "dns", "image", "build", "alchemy", "check"],
  destroy: ["alchemy", "repos", "dns"],
};

/** Alchemy's status of a resource as a person reads it: its one failure is spelled `fail`. */
export const statusLabelOf = (status: string) => (status === "fail" ? "failed" : status);

/** Where the creation stands, in one word: the page's headline. Installed is a deploy that
 *  succeeded (its URL, which a destroy clears): a later run that fails is that run's own outcome,
 *  never the install's. Destroyed is no URL, with the newest run that changed the account (a
 *  deploy or a destroy that succeeded, the current run first, then back through the history) a
 *  destroy: a later plan, or a later deploy that runs or fails, leaves it destroyed. Otherwise the
 *  install's own steps say where it stands. */
export function installStatusOf(
  state: Creation & { url: string | null },
): "not-started" | "installing" | "installed" | "failed" | "destroyed" {
  if (!state.record) return "not-started";
  if (state.url) return "installed";
  const settled = [...state.history, ...(state.run ? [state.run] : [])].findLast(
    (run) => run.status === "succeeded" && run.kind !== "plan",
  );
  if (settled?.kind === "destroy") return "destroyed";
  const steps = installStepsOf(state);
  if (steps.some((step) => step.status === "failed")) return "failed";
  return steps.every((step) => step.status === "succeeded") ? "installed" : "installing";
}

/** What a deployment named `name` makes in the account, by core/os's own names
 *  (core/os/src/resource-names.ts), for the review screen. */
export function resourcesOf(name: string) {
  const { stack } = stateOf(name);
  return [
    { kind: "Worker", name },
    { kind: "D1 database", name: `${name}-db` },
    { kind: "KV namespace", name: `${name}-oauth-kv` },
    { kind: "KV namespace", name: `${name}-itx-kv` },
    { kind: "R2 bucket", name: `${name}-files` },
    { kind: "Artifacts namespace", name: `${name}-repos` },
    { kind: "Alchemy stack", name: stack },
  ];
}

/** The Dash a deployment's owner lands in when its config names none: core/os's default
 *  (core/os/src/iterate-config.ts `DEFAULT_DASH`). */
const DEFAULT_DASH = "https://dash.iterate.com";

/** What a person can do with a running deployment, as links and commands: the end of the
 *  wizard. `url` is the Worker's address (workers.dev); the project's own hostname, when chosen,
 *  serves its site. The Agents app sits beside the Dash on the platform, at the same name with
 *  `agents` for `dash` (dash.iterate.com, agents.iterate.com; cloud-dev-dash…, cloud-dev-agents…). */
export function nextStepsOf(
  record: Pick<DeploymentRecord, "name" | "accountId" | "project" | "domain">,
  url: string,
  dash: string | undefined,
) {
  // on a domain, the platform is `iterate.<domain>` and the domain the first project's site
  const domain = record.domain;
  const origin = domain ? `https://${platformHostOf(domain)}` : new URL(url).origin;
  const dashOrigin = new URL(dash || DEFAULT_DASH).origin;
  const agentsOrigin = dashOrigin.replace(/\/\/([a-z0-9-]*?)dash\b/, "//$1agents");
  const project = record.project;
  const mcp = `${origin}/mcp`;
  return {
    project,
    /** The new iterate, through its own sign-in: the platform's identity card the first time,
     *  then its Dash with no page between (iterate/private#272, iterate/private#274, iterate/private#278; proven on prd 2026-11-07). The
     *  Dash's own connect for an issuer it has not bound asks the person first, a page more. */
    dash: `${origin}/.auth/sign-in/iterate?next=/`,
    agents: `${agentsOrigin}/.auth/connect?${new URLSearchParams({ issuer: origin, next: project ? `/projects/${project}` : "/" })}`,
    site: !project
      ? null
      : domain
        ? `https://${domain.hostname}/`
        : `${origin}/projects/${project}/`,
    mcp,
    mcpCommands: [`claude mcp add --transport http iterate ${mcp}`],
    cliCommands: [
      `npx iterate config set --name ${record.name} --os-base-url ${origin}${project ? ` --default-project ${project}` : ""}`,
      `npx iterate --config ${record.name} login`,
      `npx iterate --config ${record.name} use-my-computer`,
    ],
    // a deployment on a domain answers there alone (core/os answers 421 to another host)
    worker: origin,
    cloudflare: `https://dash.cloudflare.com/${record.accountId}/workers/services/view/${record.name}/production`,
  };
}
export type NextSteps = ReturnType<typeof nextStepsOf>;
