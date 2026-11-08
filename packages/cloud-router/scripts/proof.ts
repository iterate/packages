// scripts/proof.ts — THE PROOF ON A DEPLOYMENT THE CLOUD MADE (README.md "The proof"), through its
// admin API, the bearer read from the Cloud's state with the caller's own CLI login and never printed:
//
//   pnpm run proof project <deployment id>            a project with a random slug, owned by the
//                                                     deployment's owner; prints the slug
//   pnpm run proof worker <id> <slug>                 the project's worker: proof-worker.txt (its
//                                                     home page names the routing slug; its `ask`
//                                                     app asks a model through the Cloud)
//   pnpm run proof webhook <id> <slug> <to>           the connection's row on /iterate-cloud (what
//                                                     @iterate-com/cloud-connection installs) and
//                                                     one iterate-cloud/email-requested to `to`
//   pnpm run proof inbox <id> <slug>                  the project's /iterate-cloud log: what the
//                                                     router appended, and the row's cursor
//
// Before `worker` and `webhook`: `pnpm run route <slug> <id>`, which also sets the project's
// `/secrets/iterate-cloud`; before `ask` answers: `pnpm run lend <id> openai …`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connectIterate } from "iterate/node";
import { cloudRouterEnvs, getEnv } from "../../../envs.ts";
import { cloudDeployment } from "./cloud-state.ts";

const [command, id, slug, to] = process.argv.slice(2);
const env = getEnv("prd", cloudRouterEnvs);
if (!command || !id)
  throw new Error("usage: proof.ts project|worker|webhook|inbox <id> [<slug>] [<to>]");
const { origin, bearer, owner } = cloudDeployment(env.cloudProject, id);
using connection = await connectIterate({
  baseUrl: origin,
  auth: { type: "admin-secret", secret: bearer },
});
const { session } = connection;

if (command === "project") {
  const made = `r${[...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  using asOwner = await connectIterate({
    baseUrl: origin,
    auth: { type: "admin-secret", secret: bearer, as: { email: owner } },
  });
  await asOwner.session.projects.create({ project: made });
  console.log(made);
} else if (command === "worker" && slug) {
  const repo = session.projects.get(slug).repos.get("/repos/config");
  const tip = await repo.tip();
  const { commitOid } = await repo.commitFiles({
    message: "The Cloud router's proof: a home page that names the routing slug, and an ask app",
    parent: tip,
    changes: [
      {
        path: "worker.ts",
        content: readFileSync(path.join(import.meta.dirname, "proof-worker.txt"), "utf8"),
      },
    ],
  });
  if (!commitOid) throw new Error("The worker is already what proof-worker.txt says");
  const outcome = await session.projects
    .get(slug)
    .cd("/")
    .waitForEvent({
      type: [
        "events.iterate.com/project/worker-updated",
        "events.iterate.com/project/worker-update-failed",
      ],
      payload: { commitOid },
      afterOffset: 0,
      timeoutMs: 180_000,
    });
  console.log(`${commitOid.slice(0, 9)} ${outcome.type.replace("events.iterate.com/", "")}`);
} else if (command === "webhook" && slug && to) {
  const context = session.projects.get(slug).cd("/iterate-cloud");
  const url = `${env.baseUrl}/.cloud/hooks/${id}`;
  await context.append({
    type: "events.iterate.com/itx/subscription-configured",
    idempotencyKey: `iterate-cloud/hook:${url}`,
    payload: {
      name: "iterate-cloud",
      target: [
        "itx",
        ["cd", "/"],
        "webhooks",
        ["get", { url, signingSecret: "/secrets/iterate-cloud" }],
        "deliverEvent",
      ],
      consumes: ["iterate-cloud/email-requested"],
      ordered: false,
    },
  });
  const [requested] = await context.append({
    type: "iterate-cloud/email-requested",
    payload: {
      from: `${slug}@${env.zone}`,
      to: [to],
      subject: `Hello from ${slug} through the Cloud`,
      text: `Sent by the project ${slug} at ${new Date().toISOString()}: an event on /iterate-cloud, delivered to the router as a signed webhook, sent from the zone.`,
    },
  });
  console.log(`requested at offset ${requested!.offset}`);
} else if (command === "inbox" && slug) {
  const context = session.projects.get(slug).cd("/iterate-cloud");
  const page = await context.readEvents(0, 200);
  for (const event of page.events)
    if (!String(event.type).startsWith("events.iterate.com/itx/"))
      console.log(event.offset, event.type, JSON.stringify(event.payload).slice(0, 160));
  for (const row of await context.subscriptions.list())
    if (row.name === "iterate-cloud") console.log("row", JSON.stringify(row.cursor));
} else {
  throw new Error("usage: proof.ts project|worker|webhook|inbox <id> [<slug>] [<to>]");
}
