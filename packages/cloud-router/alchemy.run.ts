// alchemy.run.ts — THE CLOUD'S ROUTER AS AN ALCHEMY STACK (README.md): the Worker and its KV
// namespace, its `send_email` binding, the zone's routes and DNS (the apex and `*`, proxied to
// nowhere: the Worker answers both), Email Routing on the zone with the catch-all to the Worker,
// and the zone enabled for sending. scripts/deploy.ts runs it with the env's Doppler secrets:
//
//   pnpm --dir packages/cloud-router run deploy --env prd
//
// `CLOUD_ROUTER_ZONE` names the zone, `CLOUD_ROUTER_WORKER` the Worker, `CLOUD_API` the Cloud's
// platform; `CLOUD_ROUTER_KV_KEY`, the registry's sealing key, and `CLOUD_API_BEARER`, the bearer
// the router reaches the Cloud's project with, are the variables of those names. State: the
// account's Cloudflare state store.
import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { COMPATIBILITY_DATE } from "iterate/compatibility-date";

const zone = process.env.CLOUD_ROUTER_ZONE!;
const workerName = process.env.CLOUD_ROUTER_WORKER!;
if (!zone || !workerName || !process.env.CLOUD_API)
  throw new Error(
    "CLOUD_ROUTER_ZONE, CLOUD_ROUTER_WORKER and CLOUD_API name the zone, the Worker and the Cloud's platform",
  );

export default Alchemy.Stack(
  "cloud-router",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
    secrets: [Alchemy.Secrets.ProcessEnv()],
  },
  Effect.gen(function* () {
    // Email Routing first: the zone's MX and SPF records, and the zone id everything else names
    const routing = yield* Cloudflare.Email.Routing("Routing", { zone });
    // Classic Workers KV for now. The registry is meant for Workers KV Instant (Quicksilver: reads
    // under 2 ms, writes everywhere in ~250 ms, one write per namespace per second, which a route
    // written by hand never meets), `Cloudflare.KV.InstantNamespace`, but production's account is
    // not in its private beta yet ("this account is not allowed to create Instant namespaces")
    const registry = yield* Cloudflare.KV.Namespace("Registry", { title: `${workerName}-kv` });
    const worker = yield* Cloudflare.Worker("Worker", {
      name: workerName,
      main: `${import.meta.dirname}/src/worker.ts`,
      compatibility: { date: COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
      observability: { enabled: true, headSamplingRate: 1 },
      workersDev: { enabled: false, previewsEnabled: false },
      routes: [
        { pattern: `${zone}/*`, zone },
        { pattern: `*.${zone}/*`, zone },
      ],
      // every minute: what reached @iterate from connected people, to their deployments
      crons: ["* * * * *"],
      env: {
        REGISTRY: registry,
        EMAIL: Cloudflare.Email.SendEmail("EMAIL"),
        ZONE: zone,
        CLOUD_ROUTER_KV_KEY: Config.Redacted("CLOUD_ROUTER_KV_KEY"),
        CLOUD_API: process.env.CLOUD_API!,
        CLOUD_API_BEARER: Config.Redacted("CLOUD_API_BEARER"),
      },
    });
    // the apex and every first-level name resolve to Cloudflare's edge, where the routes take them
    for (const [id, name] of [
      ["Apex", zone],
      ["Wildcard", `*.${zone}`],
    ] as const)
      yield* Cloudflare.DNS.Record(id, {
        zoneId: routing.zoneId,
        name,
        type: "AAAA",
        content: "100::",
        proxied: true,
        comment: "the Cloud's router (packages/cloud-router)",
      });
    // every address of the zone goes to the Worker's `email` handler
    yield* Cloudflare.Email.CatchAll("CatchAll", {
      zone: routing.zoneId,
      name: "the Cloud's router",
      actions: [{ type: "worker", value: [workerName] }],
    });
    // the zone may send: DKIM, SPF and the return path, on Cloudflare's DNS
    const sending = yield* Cloudflare.Email.SendingSubdomain("Sending", {
      zoneId: routing.zoneId,
      name: zone,
      previewEnabled: false,
    });
    return { url: `https://${zone}`, worker: worker.workerName, sending: sending.enabled };
  }),
);
