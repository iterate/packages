// cloud/api.ts — THE CLOUD'S ONE DATA PATH: a capnweb API at `/rpc` on the Cloud's origin, served by
// the project's config worker (worker.ts) to a person with a Cloud session (sign-in.ts) and no
// platform session, the shape of core/os/examples/mini-app.ts. The root is built for that person at
// the handshake and holds only their things: every handle it returns names a context they own, and
// a page can do nothing the person could not. Its nouns mirror the platform's `/api` (a root for the
// person, `deployments.get(id)` answering a handle), so it can later fold into it.
//
//   const api = newWebSocketRpcSession<CloudApi>("wss://<cloud>/rpc");
//   const { email } = await api.whoami();
//   useLiveState(api.person, { key: "cloud-person", readSeed: () => api.person.liveSnapshot() });
//   const { id } = await api.deployments.create({ request, connection, accountId, name });
//   await api.deployments.get(id).requestRun("deploy");
//
// Reads are processor state, pushed as live state: a handle's `liveSnapshot()` seeds and its
// `subscribe` (iterate/client `LiveStateItx`) follows (durable-object.ts says how the deltas get
// here). A mutation is an append on the person's or the deployment's context; the processors do the
// work. The API holds no itx scope but a live subscription's: each method opens its own `using`
// block (core/lib/src/sdk/itx-scope.ts).
import { RpcTarget } from "cloudflare:workers";
import type { IterateContextApi } from "iterate/api";
import { z } from "zod";
import { DeploymentContract } from "./contract.ts";
import type { WatchTarget } from "./durable-object.ts";
import {
  CloudflareAccount,
  DeploymentRecord,
  RunKind,
  RunOutput,
  RunStep,
  errorCodeOf,
  stateOf,
  type DeploymentState,
  type PersonState,
} from "./records.ts";
import { mintConfig } from "./config.ts";
import { connectionSecretOf, placeholderOf } from "./runs.ts";
import type { Person } from "./sign-in.ts";

/** What a Cloud API serves from: the person the session names, the config worker's scope, its
 *  `waitUntil`, and the Cloud's Cloudflare OAuth client. */
export type ApiDeps = {
  person: Person;
  /** The path the Cloud is served under on its origin, "" at a host's root (worker.ts). */
  basePath: string;
  getItx: () => IterateContextApi & Disposable;
  waitUntil: (work: Promise<unknown>) => void;
  cloudflare: CloudflareClient;
};

/** The Cloud's own Cloudflare OAuth client: its id, public, and the project secret that holds its
 *  secret, `{ clientSecret }`, which only the platform reads, at the code exchange and each refresh. */
export type CloudflareClient = { clientId: string; secret: string };

export class CloudApi extends RpcTarget {
  readonly #deps: ApiDeps;
  constructor(deps: ApiDeps) {
    super();
    this.#deps = deps;
  }

  whoami() {
    return { sub: this.#deps.person.sub, email: this.#deps.person.email };
  }

  /** The person's own context, live: their connections and deployments. */
  get person() {
    return new LiveContext(this.#deps, personPathOf(this.#deps.person.sub), "cloud-person");
  }

  get deployments() {
    return new Deployments(this.#deps);
  }

  /** Begin a Cloudflare connect: the platform's start link, which the browser opens to reach
   *  Cloudflare's consent. Cloudflare returns to the platform's callback, which stores the tokens in
   *  the connection's secret and sends the browser to `/connected` here (worker.ts). The attempt is
   *  this person's alone (`completedByUserId`): the callback completes it only in a browser signed
   *  in at the OS as them, whether or not they are a member of this project. */
  async connectCloudflare() {
    const { person, cloudflare } = this.#deps;
    const connection = hex(6);
    using itx = this.#deps.getItx();
    const { authorizationUrl, nonce } = await itx.secrets.beginOAuth(
      connectionSecretOf(connection),
      {
        authorizationEndpoint: "https://dash.cloudflare.com/oauth2/auth",
        tokenEndpoint: "https://dash.cloudflare.com/oauth2/token",
        clientId: cloudflare.clientId,
        clientSecret: `getSecret("${cloudflare.secret}", { field: "clientSecret" })`,
        next: returnOf(this.#deps.basePath, new URLSearchParams({ connection })),
        completedByUserId: person.sub,
        clientAuth: "client_secret_post",
        scope: CLOUDFLARE_SCOPES.join(" "),
        urls: ["https://dash.cloudflare.com", "https://api.cloudflare.com"],
        // Cloudflare's token response names no one: `/user` does, called once with the new token
        account: {
          url: "https://api.cloudflare.com/client/v4/user",
          id: "result.id",
          name: "result.email",
        },
      },
    );
    await itx.cd(personPathOf(person.sub)).append({
      type: "cloud/connection-requested",
      idempotencyKey: `connection-requested:${connection}`,
      payload: { connection, nonce },
    });
    return { url: authorizationUrl };
  }
}

/** A context the person owns, live: the seed (`liveSnapshot`) and the deltas (`subscribe`) of its
 *  processor, as iterate/client `connectLiveState` reads them. */
class LiveContext extends RpcTarget {
  protected readonly deps: ApiDeps;
  protected readonly path: string;
  readonly #slug: string;
  constructor(deps: ApiDeps, path: string, slug: string) {
    super();
    this.deps = deps;
    this.path = path;
    this.#slug = slug;
  }

  async liveSnapshot() {
    using itx = this.deps.getItx();
    return (await itx
      .cd(this.path)
      .facets.get<{ liveSnapshot(): Promise<{ rev: number; state: unknown }> }>(this.#slug)
      // safe: the facet's live state is its processor's `projectLiveState` (person.ts,
      // deployment.ts), the reduced state as its contract types it with the nonces dropped or the
      // config masked; the facet boundary types it unknown, and the projection is no schema of its
      // own to parse with
      .liveSnapshot()) as { rev: number; state: PersonState | DeploymentState };
  }

  /** Follow the processor's live state: `target` gets every batch of its deltas until the handle
   *  is disposed or the socket closes. Only the live-state type: `name` and `consumes` are ignored
   *  (the facet names its watch). */
  async subscribe(input: { target: WatchTarget; name?: string; consumes?: string[] }) {
    // capnweb disposes a stub passed as an argument when the call returns: keep it
    const target = (input.target as WatchTarget & { dup(): WatchTarget & Disposable }).dup();
    // oxlint-disable-next-line iterate/no-raw-itx-get -- held for the subscription's life: the facet calls back over this scope's session, which a `using` block would end at once
    const scope = this.deps.getItx();
    const facet = () =>
      scope.cd(this.path).facets.get<{
        watch(target: WatchTarget): Promise<string>;
        unwatch(name: string): Promise<void>;
      }>(this.#slug);
    const name = await facet().watch((events, range) => target(events, range));
    return new Subscription(() =>
      this.deps.waitUntil(
        facet()
          .unwatch(name)
          .finally(() => {
            target[Symbol.dispose]();
            scope[Symbol.dispose]();
          }),
      ),
    );
  }
}

/** What `subscribe` answers: disposing it, or the socket closing, ends the facet's watch. */
class Subscription extends RpcTarget {
  #end: (() => void) | null;
  constructor(end: () => void) {
    super();
    this.#end = end;
  }
  [Symbol.dispose]() {
    const end = this.#end;
    this.#end = null;
    end?.();
  }
}

class Deployments extends RpcTarget {
  readonly #deps: ApiDeps;
  constructor(deps: ApiDeps) {
    super();
    this.#deps = deps;
  }

  /** Request a deployment into one of the accounts a connected connection reaches. `request` is
   *  the page's own random id for this creation: the deployment's id is derived from it, so a
   *  retried request (a reload, a lost answer) is the same deployment. The person's listing is
   *  appended first, then the deployment's own request, both keyed by the id: a creation that
   *  stops between the two is listed, its context empty, and `requestCreation` finishes it. Of
   *  two that overlap with one name, only the first the person's log lists goes on. */
  async create(input: { request: string; connection: string; accountId: string; name: string }) {
    const { person } = this.#deps;
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.request))
      throw refused("A creation needs the page's request id.");
    const id = `dep_${(await sha256Hex(`${person.sub}:${input.request}`)).slice(0, 16)}`;
    const state = await personStateOf(this.#deps);
    // a creation this Cloud already recorded is finished as it is: its Worker may by now be its own
    let record = state.deployments.find((known) => known.id === id);
    if (!record) {
      record = recordOf(state, person, id, input);
      const name = await nameInAccount(record);
      if (name.status !== "free") throw refused(name.message);
    }
    using itx = this.#deps.getItx();
    await itx.cd(personPathOf(person.sub)).append({
      type: "cloud/deployment-added",
      idempotencyKey: `deployment-added:${id}`,
      payload: record,
    });
    // the person's log orders overlapping creations of one name (person.ts): the snapshot is
    // caught up through it, and a creation the log refused is not listed by its id
    if (!(await personStateOf(this.#deps)).deployments.some((known) => known.id === id))
      throw refused(`You already have a deployment named ${record.name} in ${record.accountName}.`);
    await requestCreation(itx, record);
    return { id };
  }

  /** Whether `name` is free for a new deployment in the account, as `create` checks it: no
   *  deployment of the person's has it there, and the account has no Worker of that name. A name in
   *  use is never taken over: a deploy of an existing stack would replace that deployment's
   *  encryption key and orphan every secret it sealed. */
  async checkName(input: { connection: string; accountId: string; name: string }) {
    const state = await personStateOf(this.#deps);
    try {
      return await nameInAccount(recordOf(state, this.#deps.person, "dep_0000000000000000", input));
    } catch (error) {
      // a refusal of the choice itself (recordOf) is an answer; anything else is a defect
      if (errorCodeOf(error) !== "INVALID_INPUT" || !(error instanceof Error)) throw error;
      return { status: "taken" as const, message: error.message };
    }
  }

  /** One of the person's deployments; any other id is refused. */
  async get(id: string) {
    const record = (await personStateOf(this.#deps)).deployments.find((known) => known.id === id);
    if (!record) throw refused("No such deployment.");
    return new Deployment(this.#deps, record);
  }
}

class Deployment extends LiveContext {
  readonly #record: DeploymentRecord;
  constructor(deps: ApiDeps, record: DeploymentRecord) {
    super(deps, deploymentPathOf(record.id), "cloud-deployment");
    this.#record = record;
  }

  /** Finish a creation that stopped before the deployment's own request (`create` says when). */
  async requestCreation() {
    using itx = this.deps.getItx();
    await requestCreation(itx, this.#record);
  }

  /** Prepare the sandbox again after a preparation failed. */
  async prepareAgain() {
    using itx = this.deps.getItx();
    await itx.cd(this.path).append({ type: "cloud/preparation-requested", payload: {} });
  }

  /** Ask for a run. Its answer is on the deployment's state: open, or refused while another runs. */
  async requestRun(kind: string) {
    const parsed = RunKind.safeParse(kind);
    if (!parsed.success) throw refused("A run is a plan, a deploy or a destroy.");
    using itx = this.deps.getItx();
    const [requested] = await itx
      .cd(this.path)
      .append({ type: "cloud/run-requested", payload: { kind: parsed.data } });
    return { requestOffset: requested!.offset };
  }

  /** The text lines one step of a run printed, at most its first 1,000, from the run's
   *  `cloud/output-printed` events; the state keeps only each step's newest. */
  async readOutput(requestOffset: number, step: RunStep) {
    const asked = z
      .object({ requestOffset: z.number().int().nonnegative(), step: RunStep })
      .safeParse({
        requestOffset,
        step,
      });
    if (!asked.success) throw refused("Name a run by its offset and one of its steps.");
    const lines: string[] = [];
    using itx = this.deps.getItx();
    const context = itx.cd(this.path);
    let after = asked.data.requestOffset;
    for (let page = 0; page < 20 && lines.length < 1000; page++) {
      const read = await context.readEvents(after, 200);
      for (const event of read.events) {
        if (event.type !== "cloud/output-printed") continue;
        const printed = RunOutput.parse(event.payload);
        if (printed.requestOffset !== asked.data.requestOffset || printed.step !== asked.data.step)
          continue;
        lines.push(...printed.lines.filter((line) => !line.startsWith("== ")));
      }
      if (read.atHead || read.events.length === 0) break;
      after = read.scannedThroughOffset;
    }
    return { lines: lines.slice(0, 1000) };
  }

  /** The password minted for the owner's sign-in to the deployed Worker (config.ts), from the
   *  deployment's full state: the one secret the Cloud shows, to the owner alone. */
  async signInPassword() {
    using itx = this.deps.getItx();
    const { state } = await itx
      .cd(this.path)
      .facets.get<{ snapshot(): Promise<{ state: DeploymentState }> }>("cloud-deployment")
      .snapshot();
    return state.config?.login.methods.password.password || null;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────

/** Where the platform's OAuth callback sends a connect back: the Cloud's `/connected`. At a host's
 *  root that is a path of the apex. Under paths ingress a project's apex has no sub-paths: the
 *  platform composes `/projects/<project>/<routingSlug><path>` and refuses a `next` whose first
 *  segment it would read back as another routing slug (core/os context/built-ins.ts
 *  `projectPageUrlOf`), so there `connected` is the routing slug, which worker.ts folds back into
 *  the path. */
function returnOf(basePath: string, query: URLSearchParams) {
  return basePath
    ? { routingSlug: "connected", path: `/?${query}` }
    : { path: `/connected?${query}` };
}

/** The scopes a deploy of core/os into the account needs (its Alchemy stack: the Worker and its
 *  routes, D1, KV, R2, the container application and its images, the Artifacts namespace, the state
 *  store's Secrets Store), with `user-details.read`, which names the person, and `offline_access`,
 *  which brings a refresh token. Cloudflare's list:
 *  https://developers.cloudflare.com/fundamentals/api/reference/permissions/ */
const CLOUDFLARE_SCOPES = [
  "user-details.read",
  "offline_access",
  "account-settings.read",
  "memberships.read",
  "workers-scripts.write",
  "workers-kv-storage.write",
  "workers-r2.write",
  "d1.write",
  "artifacts.write",
  "containers.write",
  "cloudchamber.write",
  "workers-routes.write",
  "zone.read",
  "workers-tail.read",
  "workers-observability.read",
  "pipelines.read",
  "ai.write",
  "browser-rendering.write",
  "email-sending.write",
  "images.write",
  "secrets-store.write",
];

/** The Cloudflare accounts a connection's token reaches, as Cloudflare's API lists them. The
 *  placeholder rides in the header; egress swaps the token in. */
export async function accountsOf(connection: string) {
  const response = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", {
    headers: { authorization: `Bearer ${placeholderOf(connection)}` },
  });
  if (!response.ok) throw new Error(`Cloudflare listed no accounts: HTTP ${response.status}`);
  return z.object({ result: CloudflareAccount.array() }).parse(await response.json()).result;
}

/** Whether the account has a Worker named as the deployment, asked of Cloudflare with the
 *  connection's token: 404 is free, 200 is taken, anything else is a failure, said as Cloudflare
 *  answered it. https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/get/ */
async function nameInAccount(record: DeploymentRecord) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${record.accountId}/workers/scripts/${record.name}`,
    { headers: { authorization: `Bearer ${placeholderOf(record.connection)}` } },
  );
  await response.body?.cancel();
  if (response.status === 404)
    return { status: "free" as const, message: `${record.name} is free in ${record.accountName}.` };
  if (response.ok)
    return {
      status: "taken" as const,
      message: `${record.accountName} already has a Worker named ${record.name}.`,
    };
  return {
    status: "unknown" as const,
    message: `Cloudflare did not say whether ${record.name} is free (HTTP ${response.status}). Try again.`,
  };
}

/** The deployment's request, on its own context, with its processor, and the config minted for
 *  it. Keyed on the deployment's id: once one request landed, a later one, whose config is another,
 *  is refused as a conflict, and the config that landed stays the only one. */
async function requestCreation(itx: IterateContextApi, record: DeploymentRecord) {
  const context = itx.cd(deploymentPathOf(record.id));
  await context.processors.enable("cloud-deployment", deploymentProcessorSpec);
  await context
    .append({
      type: "cloud/deployment-requested",
      idempotencyKey: `deployment-requested:${record.id}`,
      payload: { record, config: mintConfig(record) },
    })
    .catch((error: unknown) => {
      if (errorCodeOf(error) !== "IDEMPOTENCY_CONFLICT") throw error;
    });
}

/** A new record, from the person's choices, checked against what they own. */
function recordOf(
  state: PersonState,
  person: Person,
  id: string,
  input: { connection: string; accountId: string; name: string },
): DeploymentRecord {
  const connection = state.connections.find((known) => known.id === input.connection);
  if (connection?.status !== "connected") throw refused("Connect that Cloudflare account first.");
  const account = connection.accounts.find((known) => known.id === input.accountId);
  if (!account) throw refused("That Cloudflare account is not one this connection reaches.");
  if (
    state.deployments.some((known) => known.accountId === account.id && known.name === input.name)
  )
    throw refused(`You already have a deployment named ${input.name} in ${account.name}.`);
  const parsed = DeploymentRecord.safeParse({
    id,
    name: input.name,
    accountId: account.id,
    accountName: account.name,
    connection: connection.id,
    ...stateOf(input.name),
    owner: { sub: person.sub, email: person.email },
    createdAt: new Date().toISOString(),
  });
  if (!parsed.success) throw refused(parsed.error.issues.map((issue) => issue.message).join("; "));
  return parsed.data;
}

async function personStateOf(deps: ApiDeps) {
  using itx = deps.getItx();
  return (
    await itx
      .cd(personPathOf(deps.person.sub))
      .facets.get<{ snapshot(): Promise<{ state: PersonState }> }>("cloud-person")
      .snapshot()
  ).state;
}

/** The facet spec of one of the package's processors, loaded from the project's published config,
 *  whose top-level `cloud.ts` re-exports the package (a processor row names a top-level module).
 *  `consumes` is its contract's: the platform delivers the processor no other type. */
export const facetSpecOf = (className: string, consumes: readonly string[]) => ({
  className,
  mainModule: "cloud.ts",
  source: CONFIG_SOURCE,
  consumes: [...consumes],
});

/** The project's published config, as a facet spec names its source (a path, not a string). */
const CONFIG_SOURCE: ["itx", ["cd", string], "config"] = ["itx", ["cd", "/"], "config"];

export const personPathOf = (sub: string) => `/people/${sub}`;
const deploymentPathOf = (id: string) => `/deployments/${id}`;

const deploymentProcessorSpec = facetSpecOf("CloudDeploymentFacet", DeploymentContract.consumes);

/** A refusal the page shows as it stands: an expected outcome, coded like the platform's. */
const refused = (message: string) => Object.assign(new Error(message), { code: "INVALID_INPUT" });
const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
