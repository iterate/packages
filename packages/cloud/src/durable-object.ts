// cloud/durable-object.ts — THE FACETS a project's config loads (its `cloud.ts` re-exports this
// package's index): each processor, and what the Cloud app's page may call on it. THE CLOUD HAS NO
// API OF ITS OWN. The project lends a person their own facets (core/os README.md, "A project lends
// a facet to a person"): the config worker lends `cloud-person` on `/people/<sub>` (worker.ts
// `setUpPerson`), and the person's facet lends each of their deployments' `cloud-deployment`. The
// page then reaches them through the platform's `/api`, as the Dash reaches a member's facets:
//
//   const project = api.projects.get("cloud");
//   useFacetLiveState(project.cd(`/people/${me}`), "cloud-person");
//   await project.cd(`/people/${me}`).facets.get("cloud-person").createDeployment(input);
//
// A lend gives the live state and the methods a class lists in `lentMethods`, never `snapshot`,
// which holds the connections' nonces and the deployment's secrets. A lent method's own calls run
// as the facet's, and it learns no caller: the person a facet serves is the one its context is for
// (`sub` on the person's state, the record's owner on a deployment's). Every input is the page's,
// so each is checked here.
import { z } from "zod";
import { StreamProcessorDurableObject } from "iterate/sdk";
import {
  DeploymentRecord,
  RunKind,
  RunOutput,
  RunStep,
  errorCodeOf,
  stateOf,
  type DeploymentState,
  type PersonState,
  type ToolchainState,
} from "./records.ts";
import { accountsOf, connectOptionsOf, nameInAccount } from "./cloudflare.ts";
import {
  createDeployment as createDeploymentIn,
  finishCreation as finishCreationIn,
  reachDeployment,
  refused,
} from "./creation.ts";
import { DeploymentProcessor } from "./deployment.ts";
import { PersonProcessor } from "./person.ts";
import { connectionSecretOf, prepareDeployment, prepareToolchain, runAttempt } from "./runs.ts";
import { TOOLCHAIN_PATH } from "./specs.ts";
import { ToolchainProcessor } from "./toolchain.ts";

export class CloudPersonFacet extends StreamProcessorDurableObject<PersonState> {
  static override lentMethods = [
    "connectCloudflare",
    "settleConnection",
    "checkName",
    "createDeployment",
    "finishCreation",
  ] as const;
  processor = new PersonProcessor();

  /** The live state's seed read, the first call a page makes: before this incarnation first
   *  answers it, every deployment the person has is reachable (its processor) and lent to them, so a deployment made before
   *  the Cloud lent anything opens like a new one. Each lend is idempotent. */
  override async liveSnapshot() {
    this.#lentDeployments ||= this.#lendDeployments().catch((error: unknown) => {
      this.#lentDeployments = null;
      throw error;
    });
    await this.#lentDeployments;
    return await super.liveSnapshot();
  }
  #lentDeployments: Promise<void> | null = null;
  async #lendDeployments() {
    const state = await this.#state();
    using itx = this.getItx();
    for (const record of state.deployments) await reachDeployment(itx, record);
  }

  /** Begin a Cloudflare connect: the platform's start link, which the browser opens to reach
   *  Cloudflare's consent. Cloudflare returns to the platform's callback, which stores the tokens in
   *  the connection's secret and sends the browser to `next` (a page of this project's) with
   *  `connection=<id>` added to its query; the page then calls `settleConnection`. */
  async connectCloudflare(input: { next: { routingSlug?: string; path: string } }) {
    const asked = ConnectInput.safeParse(input);
    if (!asked.success) throw refused("A connect needs the page to come back to.");
    const { sub, platform } = await this.#state();
    if (!platform) throw new Error("This Cloud's config names no platform.");
    const connection = hex(6);
    const { routingSlug, path } = asked.data.next;
    const query = new URLSearchParams({ connection });
    const next = { routingSlug, path: `${path}${path.includes("?") ? "&" : "?"}${query}` };
    using itx = this.getItx();
    const { authorizationUrl, nonce } = await itx
      .cd("/")
      .secrets.beginOAuth(
        connectionSecretOf(connection),
        connectOptionsOf(platform.cloudflare, sub, next),
      );
    await itx.append({
      type: "cloud/connection-requested",
      idempotencyKey: `connection-requested:${connection}`,
      payload: { connection, nonce },
    });
    return { url: authorizationUrl };
  }

  /** The platform's callback stored a connect's tokens (or did not) and sent the browser back:
   *  what became of the attempt, settled here. A connection that is not this person's, or not
   *  pending, is left as it is: the page shows its state. */
  async settleConnection(connection: string) {
    const pending = (await this.#state()).connections.find(
      (known) => known.id === connection && known.status === "pending",
    );
    if (!pending) return;
    using itx = this.getItx();
    const result = await itx
      .cd("/")
      .secrets.oauthResult(connectionSecretOf(connection), { nonce: pending.nonce });
    // still in flight: the browser came back before the platform finished, and the page says so
    if (result.status === "pending") return;
    const settled = { requestOffset: pending.requestOffset, connection };
    await itx.append({
      type: "cloud/connection-settled",
      idempotencyKey: `connection-settled:${connection}`,
      payload:
        result.status === "complete"
          ? {
              ...settled,
              status: "connected",
              cloudflareUser: result.account?.name || result.account?.id || "",
              accounts: await accountsOf(connection),
              scopes: result.scopes,
            }
          : {
              ...settled,
              status: "failed",
              error:
                "This connect ended before Cloudflare's tokens were stored, or a newer one replaced it. Connect again.",
            },
    });
  }

  /** Whether `name` is free for a new deployment in the account, as `createDeployment` checks it:
   *  no deployment of the person's has it there, and the account has no Worker of that name. A name
   *  in use is never taken over: a deploy of an existing stack would replace that deployment's
   *  encryption key and orphan every secret it sealed. */
  async checkName(input: { connection: string; accountId: string; name: string }) {
    const state = await this.#state();
    try {
      return await nameInAccount(recordOf(state, "dep_0000000000000000", input));
    } catch (error) {
      // a refusal of the choice itself (recordOf) is an answer; anything else is a defect
      if (errorCodeOf(error) !== "INVALID_INPUT" || !(error instanceof Error)) throw error;
      return { status: "taken" as const, message: error.message };
    }
  }

  /** Request a deployment into one of the accounts a connected connection reaches. `request` is
   *  the page's own random id for this creation: the deployment's id is derived from it, so a
   *  retried request (a reload, a lost answer) is the same deployment. The steps and their order
   *  are creation.ts's: wherever it stops, the person's page reaches the deployment, and
   *  `finishCreation` finishes it. Of two that overlap with one name, only the first this log
   *  lists goes on. */
  async createDeployment(input: {
    request: string;
    connection: string;
    accountId: string;
    name: string;
  }) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(input?.request || ""))
      throw refused("A creation needs the page's request id.");
    const state = await this.#state();
    const id = `dep_${(await sha256Hex(`${state.sub}:${input.request}`)).slice(0, 16)}`;
    // a creation this Cloud already recorded is finished as it is: its Worker may by now be its own
    let record = state.deployments.find((known) => known.id === id);
    if (!record) {
      record = recordOf(state, id, input);
      const name = await nameInAccount(record);
      if (name.status !== "free") throw refused(name.message);
    }
    using itx = this.getItx();
    // the state once this facet has processed the listing: a creation the log refused is not
    // listed. A snapshot alone may answer before the facet has reduced its own append.
    await createDeploymentIn(itx, record, issuerOf(state), async (offset) => {
      await this.waitUntilProcessed({ offset });
      return (await this.#state()).deployments.some((known) => known.id === id);
    });
    return { id };
  }

  /** Finish a creation that stopped before the deployment's own request (`createDeployment`). */
  async finishCreation(id: string) {
    const state = await this.#state();
    const record = state.deployments.find((known) => known.id === id);
    if (!record) throw refused("No such deployment.");
    using itx = this.getItx();
    await finishCreationIn(itx, record, issuerOf(state));
  }

  /** The person's state, caught up through the log: who they are is the first fact on it
   *  (worker.ts `setUpPerson` records it before it lends this facet). */
  async #state(): Promise<KnownPerson> {
    const { state } = await this.snapshot();
    if (!state.sub || !state.email)
      throw new Error("This person's context has no person-signed-in record yet.");
    return { ...state, sub: state.sub, email: state.email };
  }
}

export class CloudDeploymentFacet extends StreamProcessorDurableObject<DeploymentState> {
  static override lentMethods = [
    "prepareAgain",
    "requestRun",
    "readOutput",
    "signInPassword",
  ] as const;
  processor = new DeploymentProcessor({
    prepare: async (record) => {
      using itx = this.getItx();
      return await prepareDeployment(itx, record);
    },
    attempt: async (run, report) => {
      using itx = this.getItx();
      // the sandboxes and secrets are the project's, reached through the root, whose table has them
      const root = itx.cd("/");
      const toolchain = (
        await root.cd(TOOLCHAIN_PATH).facets.get<ToolchainSnapshot>("cloud-toolchain").snapshot()
      ).state;
      return await runAttempt(root, toolchain.ready?.image || null, run, report);
    },
  });

  /** Prepare the sandbox again after a preparation failed. */
  async prepareAgain() {
    using itx = this.getItx();
    await itx.append({ type: "cloud/preparation-requested", payload: {} });
  }

  /** Ask for a run. Its answer is on the deployment's state: open, or refused while another runs. */
  async requestRun(kind: string) {
    const parsed = RunKind.safeParse(kind);
    if (!parsed.success) throw refused("A run is a plan, a deploy or a destroy.");
    using itx = this.getItx();
    const [requested] = await itx.append({
      type: "cloud/run-requested",
      payload: { kind: parsed.data },
    });
    return { requestOffset: requested!.offset };
  }

  /** The text lines one step of a run printed, at most its first 1,000, from the run's
   *  `cloud/output-printed` events; the state keeps only each step's newest. */
  async readOutput(requestOffset: number, step: RunStep) {
    const asked = z
      .object({ requestOffset: z.number().int().nonnegative(), step: RunStep })
      .safeParse({ requestOffset, step });
    if (!asked.success) throw refused("Name a run by its offset and one of its steps.");
    const lines: string[] = [];
    using itx = this.getItx();
    let after = asked.data.requestOffset;
    for (let page = 0; page < 20 && lines.length < 1000; page++) {
      const read = await itx.readEvents(after, 200);
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

  /** The password minted for the owner's sign-in to the deployed Worker (config.ts), from the full
   *  state: the one secret the Cloud shows, to the person the deployment is lent to alone. Only a
   *  deployment made before the Cloud signed owners in through its platform has one; null for the
   *  rest. */
  async signInPassword() {
    const methods = (await this.snapshot()).state.config?.login.methods;
    return methods && "password" in methods ? methods.password.password : null;
  }
}

export class CloudToolchainFacet extends StreamProcessorDurableObject<ToolchainState> {
  processor = new ToolchainProcessor({
    prepare: async (requestOffset) => {
      using itx = this.getItx();
      return await prepareToolchain(itx, requestOffset);
    },
  });
}

/** What a person's page may call on their facets: each class's `lentMethods`. */
export type CloudPersonMethods = Pick<
  CloudPersonFacet,
  (typeof CloudPersonFacet.lentMethods)[number]
>;
export type CloudDeploymentMethods = Pick<
  CloudDeploymentFacet,
  (typeof CloudDeploymentFacet.lentMethods)[number]
>;

/** The issuer a new deployment signs its owner in through: the platform the Cloud runs on. */
function issuerOf(state: PersonState) {
  const issuer = state.platform?.issuer;
  if (!issuer)
    throw new Error(
      "This Cloud does not know the platform it runs on: its config names no issuer (serveCloud's `issuer`).",
    );
  return issuer;
}

/** A person's state once the Cloud has recorded who they are. */
type KnownPerson = PersonState & { sub: string; email: string };

type ToolchainSnapshot = { snapshot(): Promise<{ state: ToolchainState }> };

const ConnectInput = z.object({
  next: z.object({
    routingSlug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    path: z.string().startsWith("/"),
  }),
});

/** A new record, from the person's choices, checked against what they own. */
function recordOf(
  state: KnownPerson,
  id: string,
  input: { connection: string; accountId: string; name: string },
): DeploymentRecord {
  const connection = state.connections.find((known) => known.id === input?.connection);
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
    owner: { sub: state.sub, email: state.email },
    createdAt: new Date().toISOString(),
  });
  if (!parsed.success) throw refused(parsed.error.issues.map((issue) => issue.message).join("; "));
  return parsed.data;
}

const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
