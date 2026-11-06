// cloud/records.ts — WHAT ITERATE CLOUD KNOWS, as schemas: a person, their Cloudflare connections,
// and each deployment of iterate's platform into a Cloudflare account they connected, with its runs.
// The processors (contract.ts) reduce these from the contexts' logs; the Cloud app reads them back
// through the config worker's endpoints (views.ts). Browser-safe: zod only.
//
// A connection's tokens are a project secret pinned to Cloudflare's API that no code reads (cloudflare.ts).
// A deployment's own secrets are in its config (config.ts), on its log and in its state, masked in
// the live state the browser reads.
import { z } from "zod";
import { DeploymentConfig } from "./config.ts";

const Offset = z.number().int().positive();

/** The platform's user id of a person: the stamp's `userId` (iterate/sdk `auth.person`), the
 *  `sub` the OS's userinfo answers, and what the platform takes for an OAuth attempt's
 *  `completedByUserId` (core/os control-plane/catalog.ts `newId`). */
export const PersonId = z.string().regex(/^user_[0-9a-f]{32}$/);
/** A connection to Cloudflare, one consent: twelve hex digits. Its secret is `secretOf(id)`. */
export const ConnectionId = z.string().regex(/^[0-9a-f]{12}$/);
/** A deployment's id: its context is `/deployments/<id>`, its sandbox `/deployments/<id>/sandbox`. */
export const DeploymentId = z.string().regex(/^dep_[0-9a-f]{16}$/);
export const AccountId = z.string().regex(/^[0-9a-f]{32}$/);
/** The Worker's name on the account and Alchemy's stage: 3 to 32 characters, so that the stack's
 *  name, `iterate-<name>`, and every resource named after it stay within Cloudflare's limits. */
export const DeploymentName = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/,
    "3 to 32 characters: lowercase letters, digits and hyphens, starting with a letter",
  );
/** A Worker name on the account: the Alchemy state store's. */
export const WorkerName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

export const CloudflareAccount = z.object({ id: AccountId, name: z.string() });
export type CloudflareAccount = z.infer<typeof CloudflareAccount>;

// ── the person ──────────────────────────────────────────────────────────────────────────────────

export const Connection = z.object({
  id: ConnectionId,
  /** The offset of its `cloud/connection-requested` on the person's context. */
  requestOffset: Offset,
  /** pending: the person left for Cloudflare's consent; connected: the platform holds the tokens;
   *  failed: the consent did not end in tokens, and `error` says why. */
  status: z.enum(["pending", "connected", "failed"]),
  startedAt: z.string(),
  /** The platform's nonce for the attempt (`itx.secrets.beginOAuth`): what `oauthResult` asks
   *  about. It names the attempt; it grants nothing. Never sent to a browser: the person's live state drops it (person.ts). */
  nonce: z.string(),
  /** The Cloudflare login that consented, as `/user` names it. */
  cloudflareUser: z.string().nullable().default(null),
  /** The accounts the token reaches: the ones the person picked at consent. */
  accounts: z.array(CloudflareAccount).default([]),
  scopes: z.array(z.string()).default([]),
  error: z.string().nullable().default(null),
  settledAt: z.string().nullable().default(null),
});
export type Connection = z.infer<typeof Connection>;

// ── the deployment ──────────────────────────────────────────────────────────────────────────────

/** The deployment: where it goes, which connection's token takes it there, its names and its
 *  owner. Fixed at creation. */
export const DeploymentRecord = z.object({
  id: DeploymentId,
  name: DeploymentName,
  accountId: AccountId,
  accountName: z.string(),
  connection: ConnectionId,
  /** The Alchemy state store Worker on that account, and the stack's name in it. */
  store: WorkerName,
  stack: z.string().regex(/^iterate-[a-z][a-z0-9-]{1,30}[a-z0-9]$/),
  /** The OS user who owns it, and who may sign in to it (`login.allow`). */
  owner: z.object({ sub: PersonId, email: z.email() }),
  createdAt: z.string(),
});
export type DeploymentRecord = z.infer<typeof DeploymentRecord>;

/** Where a deployment named `name` keeps its Alchemy state: the account's shared state store
 *  Worker, where a laptop deploy of core/os keeps its stacks too, and a stack of its own. */
export const stateOf = (name: string) => ({
  store: "alchemy-state-store",
  stack: `iterate-${name}`,
});

/** A Cloudflare OAuth client: its id, public, and the project secret that holds its secret,
 *  `{ clientSecret }`, which only the platform reads, at the code exchange and each refresh. */
export const CloudflareClient = z.object({ clientId: z.string().min(1), secret: z.string() });
export type CloudflareClient = z.infer<typeof CloudflareClient>;

export const PersonState = z.object({
  sub: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  /** The client the person's next connect goes through: the installing project's (worker.ts). */
  cloudflareClient: CloudflareClient.nullable().default(null),
  connections: z.array(Connection).default([]),
  /** Every deployment the person requested, as they requested it. */
  deployments: z.array(DeploymentRecord).default([]),
});
export type PersonState = z.infer<typeof PersonState>;

/** The person's state as their page reads it, their live state: no connection's nonce (person.ts). */
export const PersonView = PersonState.extend({
  connections: z.array(Connection.omit({ nonce: true })).default([]),
});
export type PersonView = z.infer<typeof PersonView>;

export const RunKind = z.enum(["plan", "deploy", "destroy"]);
export type RunKind = z.infer<typeof RunKind>;

/** The named steps a run goes through, in order: the run's script prints `== step <name>` as it
 *  reaches each (runs.ts), and every line it prints after that is that step's. A deploy is the
 *  Artifacts namespace, the image, core/os's build, Alchemy's deploy and the check that the new
 *  Worker answers; a plan stops after Alchemy's plan; a destroy is Alchemy's destroy, then `repos`,
 *  the Artifacts namespace the install made outside Alchemy, with every repo in it. */
export const RunStep = z.enum(["namespace", "image", "build", "alchemy", "check", "repos"]);
export type RunStep = z.infer<typeof RunStep>;

export const StepStatus = z.enum(["pending", "running", "succeeded", "failed"]);
export type StepStatus = z.infer<typeof StepStatus>;

/** A step: its real status, and the newest of the text lines it printed (`lines` of them in all:
 *  the page reads the rest from the log). Alchemy's step prints JSON records: its events fold into
 *  the run's `resources` (alchemy.ts), and only its other records land here as text. */
export const Step = z.object({
  name: RunStep,
  status: StepStatus,
  lines: z.number().int().nonnegative().default(0),
  tail: z.array(z.string()).default([]),
});
export type Step = z.infer<typeof Step>;

/** One resource of Alchemy's stack, as its events left it: its type (`Cloudflare.Worker`), its
 *  logical id, the action its plan decided (null when the run never planned it), its newest apply
 *  status (null before Alchemy touched it), and the newest note its provider attached. */
export const Resource = z.object({
  fqn: z.string(),
  id: z.string(),
  type: z.string(),
  action: z.string().nullable(),
  status: z.string().nullable(),
  note: z.string().nullable(),
});
export type Resource = z.infer<typeof Resource>;

/** A run: open while `status` is `open`, then its one outcome. `steps` is each named step's real
 *  state, moved by the run's output and closed by its settlement; `resources` is Alchemy's stack as
 *  the run's events report it. The page shows the run as it goes without reading the log. */
export const Run = z.object({
  requestOffset: Offset,
  kind: RunKind,
  requestedAt: z.string(),
  status: z.enum(["open", "succeeded", "refused", "failed"]),
  attempt: z.number().int().nonnegative(),
  /** Records of the run's output landed so far, text lines and Alchemy's events alike, across
   *  attempts: the next one's index. */
  lines: z.number().int().nonnegative(),
  steps: z.array(Step),
  resources: z.array(Resource).default([]),
  error: z.string().nullable(),
  settledAt: z.string().nullable(),
});
export type Run = z.infer<typeof Run>;

export const RunSettled = z.object({
  requestOffset: Offset,
  status: z.enum(["succeeded", "refused", "failed"]),
  attempts: z.number().int().nonnegative(),
  url: z.string().optional(),
  /** The sandbox image a plan or deploy pinned: its reference in the account's registry (image.ts). */
  image: z.string().optional(),
  error: z.string().optional(),
});
export type RunSettled = z.infer<typeof RunSettled>;

export const Preparation = z.object({
  requestOffset: Offset,
  /** running: the sandbox is being started from the toolchain and the deployment's files written. */
  status: z.enum(["running", "succeeded", "failed"]),
  attempt: z.number().int().nonnegative(),
  error: z.string().nullable().default(null),
});
export type Preparation = z.infer<typeof Preparation>;

export const DeploymentState = z.object({
  record: DeploymentRecord.nullable().default(null),
  /** The config every run uses (config.ts), secrets included: the live state masks them. */
  config: DeploymentConfig.nullable().default(null),
  /** The creation's first half: the deployment's own sandbox. Null before the request. */
  preparation: Preparation.nullable().default(null),
  /** The open run, else the last one: what the page shows. */
  run: Run.nullable().default(null),
  /** Every run before `run`, newest last: at most `RUNS_KEPT`, without their tails. */
  history: z.array(Run).default([]),
  /** The Worker's URL after the last deploy that succeeded; null after a destroy that did. */
  url: z.string().nullable().default(null),
  /** The sandbox image the last deploy that succeeded pinned: null when it pinned none (the
   *  toolchain has no image source), and after a destroy that succeeded. */
  image: z.string().nullable().default(null),
});
export type DeploymentState = z.infer<typeof DeploymentState>;

// ── the toolchain ───────────────────────────────────────────────────────────────────────────────

/** Where the sandbox image comes from (image.ts): the account whose registry holds iterate's
 *  `iterate-dev-image`, a pull credential of that registry (a project secret, `{ username,
 *  password }`), and the digest of the image the toolchain's core runs, which whoever asks for the
 *  toolchain names (its commit's pin in iterate's images.lock.json). A toolchain asked for with
 *  none has no source (`null`): its runs copy no image, and a deployment's sandboxes start
 *  Cloudflare's managed image. */
export const ImageSource = z.object({
  account: AccountId,
  secret: z.string().regex(/^\/secrets\/[a-zA-Z0-9._-]+$/),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type ImageSource = z.infer<typeof ImageSource>;

export const ToolchainState = z.object({
  /** The open preparation, else the last one. */
  request: z
    .object({
      requestOffset: Offset,
      status: z.enum(["running", "succeeded", "failed"]),
      image: ImageSource.nullable(),
      error: z.string().nullable(),
    })
    .nullable()
    .default(null),
  /** What every deployment's sandbox starts from: the snapshot of the last preparation that
   *  succeeded, the core commit it holds, and the image source its runs use, if it has one. */
  ready: z
    .object({
      snapshot: z.string(),
      core: z.string(),
      image: ImageSource.nullable(),
      at: z.string(),
    })
    .nullable()
    .default(null),
});
export type ToolchainState = z.infer<typeof ToolchainState>;

export const RUNS_KEPT = 20;

/** What `cloud/output-printed` carries: text lines of one step, `from` on, `from` being the index of
 *  the first one in the run's whole output, so a retried append is the same event and an adopted
 *  log does not repeat lines (runs.ts). */
export const RunOutput = z.object({
  requestOffset: Offset,
  attempt: z.number().int().positive(),
  from: z.number().int().nonnegative(),
  step: RunStep,
  lines: z.array(z.string()).min(1).max(200),
});
export type RunOutput = z.infer<typeof RunOutput>;

/** One event of Alchemy's engine, as its CLI printed it (`--log-format json`: the `data` of a record
 *  of `kind: "event"`). Kept whole: alchemy.ts parses the few types the run folds, and the rest of
 *  Alchemy's union passes through without a copy of it here. */
export const AlchemyEvent = z.looseObject({ type: z.string() });
export type AlchemyEvent = z.infer<typeof AlchemyEvent>;

/** What `cloud/alchemy-reported` carries: one event of Alchemy's, at index `at` of the run's whole
 *  output (the same count as `RunOutput.from`). */
export const RunAlchemyEvent = z.object({
  requestOffset: Offset,
  attempt: z.number().int().positive(),
  at: z.number().int().nonnegative(),
  event: AlchemyEvent,
});
export type RunAlchemyEvent = z.infer<typeof RunAlchemyEvent>;

/** The step a run's output line names, or null: `== step <name>` (runs.ts prints it). */
export function stepOfLine(line: string): RunStep | null {
  const named = /^== step (\S+)$/.exec(line)?.[1];
  const step = RunStep.safeParse(named);
  return step.success ? step.data : null;
}

/** The code a platform failure carries (`INVALID_INPUT`, `IDEMPOTENCY_CONFLICT`, a file's
 *  `ENOENT`), or undefined for any other value thrown. */
export const errorCodeOf = (error: unknown): string | undefined =>
  z.object({ code: z.string() }).safeParse(error).data?.code;
