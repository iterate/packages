// cloud/contract.ts — THE CLOUD'S THREE KINDS OF CONTEXT, as processor contracts (records.ts has the
// shapes). Every fact the Cloud knows is an event on one of them, and each one's processor reduces
// its state, which the Cloud app shows live (durable-object.ts):
//
//   /people/<sub>       — a person: who they are, their Cloudflare connections, their deployments
//   /deployments/<id>   — a deployment: its record, the creation saga, every run as a saga
//   /toolchain          — iterate/core installed and built once, saved as the snapshot every
//                         deployment's sandbox starts from
//
// The types are this package's own, unprefixed like Docs' (`docs/comment-added`): the platform's
// `events.iterate.com/` namespaces are core's (core/lib/README.md#event-types), whose grammar they
// follow: a fact is past tense, `-requested` asks, `-settled` answers with `requestOffset`.
import { z } from "zod";
import { defineProcessorContract } from "iterate/stream/processor";
import { DeploymentConfig } from "./config.ts";
import {
  ConnectionId,
  CloudflareAccount,
  CloudflareClient,
  DeploymentRecord,
  DeploymentState,
  ImageSource,
  PersonId,
  PersonState,
  RunKind,
  RunAlchemyEvent,
  RunOutput,
  RunSettled,
  ToolchainState,
} from "./records.ts";

const Offset = z.number().int().positive();

export const PersonContract = defineProcessorContract({
  slug: "cloud-person",
  version: "1",
  description:
    "An Iterate Cloud person: their sign-ins, their Cloudflare connections and the deployments they made.",
  stateSchema: PersonState,
  events: {
    "cloud/person-signed-in": {
      description:
        "The Cloud served the person for the first time, as the platform's stamp names them (worker.ts): once per person, and once more for each platform admin signed in as them, whom `impersonatedBy` names.",
      payloadSchema: z.object({
        sub: PersonId,
        email: z.email(),
        impersonatedBy: z.object({ actor: z.string(), email: z.string() }).optional(),
      }),
    },
    "cloud/cloudflare-client-configured": {
      description:
        "The Cloudflare OAuth client the person's connects go through, as the installing project's config names it (worker.ts): once, and once more each time the config names another.",
      payloadSchema: CloudflareClient,
    },
    "cloud/connection-requested": {
      description:
        "The person left for Cloudflare's consent: the platform's OAuth attempt for the connection's secret, by its nonce. Its offset is the connection's request.",
      payloadSchema: z.object({ connection: ConnectionId, nonce: z.string() }),
    },
    "cloud/connection-settled": {
      description:
        "How the consent ended: connected, with the Cloudflare login and the accounts its token reaches, or failed, and why.",
      payloadSchema: z.object({
        requestOffset: Offset,
        connection: ConnectionId,
        status: z.enum(["connected", "failed"]),
        cloudflareUser: z.string().optional(),
        accounts: z.array(CloudflareAccount).optional(),
        scopes: z.array(z.string()).optional(),
        error: z.string().optional(),
      }),
    },
    "cloud/deployment-added": {
      description:
        "The person requested a deployment. Appended before the deployment's own `cloud/deployment-requested`, with the whole record, so a creation that stopped between the two is listed and can be requested again from here (durable-object.ts `finishCreation`).",
      payloadSchema: DeploymentRecord,
    },
  },
  consumes: [
    "cloud/person-signed-in",
    "cloud/cloudflare-client-configured",
    "cloud/connection-requested",
    "cloud/connection-settled",
    "cloud/deployment-added",
  ],
  emits: [],
});

export const DeploymentContract = defineProcessorContract({
  slug: "cloud-deployment",
  version: "1",
  description:
    "A deployment of iterate's platform into a person's Cloudflare account: its record, its sandbox, and each run (a plan, a deploy or a destroy) of Alchemy's CLI in that sandbox.",
  stateSchema: DeploymentState,
  events: {
    // THE CONFIG IS ON THE LOG, its secrets included, on purpose for now: one fact holds every input
    // a run needs. A durable event's payload is also copied to the platform's telemetry warehouse
    // (core/os/src/platform-hook.ts), so the secrets are there too: to be reworked.
    "cloud/deployment-requested": {
      description:
        "A person asked for the deployment: its record and its config, minted once with the request. The processor prepares its sandbox, then requests its first deploy.",
      payloadSchema: z.object({ record: DeploymentRecord, config: DeploymentConfig }),
    },
    "cloud/preparation-requested": {
      description:
        "A person asked to prepare the sandbox again after a preparation failed. Its offset is the new preparation's request.",
      payloadSchema: z.object({}),
    },
    "cloud/preparation-started": {
      description:
        "An attempt to prepare the deployment's sandbox started: from the toolchain's snapshot, with its config and its own secrets minted inside it.",
      payloadSchema: z.object({ requestOffset: Offset, attempt: z.number().int().positive() }),
    },
    "cloud/preparation-settled": {
      description: "The sandbox is ready, or the preparation failed, and why.",
      payloadSchema: z.object({
        requestOffset: Offset,
        status: z.enum(["succeeded", "failed"]),
        attempts: z.number().int().nonnegative(),
        error: z.string().optional(),
      }),
    },
    "cloud/run-requested": {
      description:
        "A run was asked for. Its offset is the run's id. One run at a time: a request while one is open, or before the sandbox is ready, is settled `refused` at once.",
      payloadSchema: z.object({ kind: RunKind }),
    },
    "cloud/attempt-started": {
      description:
        "The run started an attempt. `retrying` names the attempt before it, which ended before it settled the run. An attempt adopts the run's script when it already runs (runs.ts).",
      payloadSchema: z.object({
        requestOffset: Offset,
        attempt: z.number().int().positive(),
        retrying: z.string().optional(),
      }),
    },
    "cloud/output-printed": {
      description:
        "Text lines one step of the run printed, as the attempt read them from the sandbox.",
      payloadSchema: RunOutput,
    },
    "cloud/alchemy-reported": {
      description:
        "One event of Alchemy's engine, from the JSON its CLI printed in the run's alchemy step (alchemy.ts): a resource planned, its status changed, or a note on it. Kept whole as Alchemy wrote it.",
      payloadSchema: RunAlchemyEvent,
    },
    "cloud/run-settled": {
      description:
        "The run's one terminal fact: succeeded (with the Worker's URL after a deploy, and the sandbox image a plan or deploy pinned), refused (an expected outcome) or failed (the script exited nonzero, or the attempts ran out), and why.",
      payloadSchema: RunSettled,
    },
  },
  consumes: [
    "cloud/deployment-requested",
    "cloud/preparation-requested",
    "cloud/preparation-started",
    "cloud/preparation-settled",
    "cloud/run-requested",
    "cloud/attempt-started",
    "cloud/output-printed",
    "cloud/alchemy-reported",
    "cloud/run-settled",
  ],
  emits: [
    "cloud/preparation-started",
    "cloud/preparation-settled",
    "cloud/run-requested",
    "cloud/attempt-started",
    "cloud/output-printed",
    "cloud/alchemy-reported",
    "cloud/run-settled",
  ],
});

export const ToolchainContract = defineProcessorContract({
  slug: "cloud-toolchain",
  version: "1",
  description:
    "The Cloud's toolchain: iterate/core at main, installed and built in one sandbox, saved as the snapshot every deployment's sandbox starts from.",
  stateSchema: ToolchainState,
  events: {
    "cloud/toolchain-requested": {
      description:
        "An operator asked for the toolchain to be prepared again, with where the sandbox image comes from (image.ts), or with no image: its runs then copy none.",
      payloadSchema: z.object({ image: ImageSource.nullish() }),
    },
    "cloud/toolchain-settled": {
      description:
        "The toolchain is prepared and saved (its snapshot and core commit), or the preparation failed, and why.",
      payloadSchema: z.object({
        requestOffset: Offset,
        status: z.enum(["succeeded", "failed"]),
        snapshot: z.string().optional(),
        core: z.string().optional(),
        error: z.string().optional(),
      }),
    },
  },
  consumes: ["cloud/toolchain-requested", "cloud/toolchain-settled"],
  emits: ["cloud/toolchain-settled"],
});
