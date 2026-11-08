// scripts/registry.ts — WRITE THE ROUTER'S REGISTRY (src/registry.ts), through the Cloudflare API
// with the env's Doppler config, each value sealed with its `CLOUD_ROUTER_KV_KEY`:
//
//   pnpm run deployment <deployment id> [--env prd]   the deployment's origin and admin bearer, read
//                                                     from the Cloud's state, and a new hook secret
//   pnpm run route <slug> <deployment id> [--env prd] <slug>.iterate2.app and <slug>@iterate2.app to
//                                                     the deployment's project <slug>, whose
//                                                     `/secrets/iterate-cloud` gets the hook
//                                                     secret, pinned to the router
//   pnpm run lend <deployment id> <name> <doppler project>/<config>/<SECRET> [--env prd]
//                                                     the Cloud lends the deployment that Doppler
//                                                     secret under `name`: `cloudSecret("<name>")`
//                                                     in a header of a request through
//                                                     /.cloud/egress/ is filled with it
//
// The Cloud's state is read with the caller's own CLI login to the Cloud's platform (a member of its
// project), never printed. Each command writes one row: Workers KV Instant, which the registry is
// meant for, takes one write per namespace per second.
import { execFileSync } from "node:child_process";
import { newHttpBatchRpcSession } from "capnweb";
import { z } from "zod";
import type { IterateApi } from "iterate/api";
import { cloudRouterEnvs, getEnv } from "../../../envs.ts";
import { resolveEnvContext } from "../../../scripts/lib/env-context.ts";
import { Registry, type Store } from "../src/registry.ts";
import { cloudDeployment } from "./cloud-state.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--env");
const name = at === -1 ? "prd" : args[at + 1]!;
const [command, ...rest] =
  at === -1 ? args : args.filter((_, index) => index !== at && index !== at + 1);
const env = getEnv(name, cloudRouterEnvs);
const ctx = await resolveEnvContext(env, { dopplerProject: "os" });
const registry = new Registry(
  await storeOf(`${env.workerName}-kv`),
  ctx.secrets.CLOUD_ROUTER_KV_KEY!,
);

const [first, second, third] = rest;

if (command === "deployment" && first && rest.length === 1) {
  const id = first;
  const { origin, bearer, owner } = cloudDeployment(env.cloudProject, id);
  const hookSecret = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  await registry.setDeployment(id, { origin, bearer, hookSecret, owner });
  console.log(`deployment ${id}: ${origin}`);
} else if (command === "route" && first && second && rest.length === 2) {
  const [slug, id] = [first, second];
  const deployment = await registry.deployment(id);
  if (!deployment)
    throw new Error(`No deployment ${id} in the registry: pnpm run deployment ${id}`);
  // the bearer rides the request too: an HTTP batch without one meets the API's 401 before it runs
  // oxlint-disable-next-line iterate/no-capnweb-http-batch -- one bounded call, the secret's write, with no live capability
  using api = newHttpBatchRpcSession<IterateApi>(
    new Request(`${deployment.origin}/api`, {
      headers: { authorization: `Bearer ${deployment.bearer}` },
    }),
  );
  const project = api
    .authenticate({ type: "admin-secret", secret: deployment.bearer })
    .projects.get(slug);
  const [{ projectId }] = await Promise.all([
    project.whoami(),
    project.secrets.set("/secrets/iterate-cloud", deployment.hookSecret, { urls: [env.baseUrl] }),
  ]);
  await registry.setRoute(slug, { deployment: id, projectId });
  console.log(`route ${slug}.${env.zone} → ${deployment.origin}/projects/${slug}/`);
} else if (command === "lend" && first && second && third && rest.length === 3) {
  const [id, lent, source] = [first, second, third];
  const [project, config, secret] = source.split("/");
  if (!project || !config || !secret)
    throw new Error("the source is <doppler project>/<config>/<SECRET>");
  if (!(await registry.deployment(id)))
    throw new Error(`No deployment ${id} in the registry: pnpm run deployment ${id}`);
  // the value stays in-process: Doppler prints it to this pipe and nowhere else
  const value = execFileSync(
    "doppler",
    ["secrets", "get", secret, "--project", project, "--config", config, "--plain"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
  if (!value) throw new Error(`Doppler ${project}/${config} has no ${secret}`);
  await registry.setLends(id, { ...((await registry.lends(id)) || {}), [lent]: value });
  console.log(`lend ${lent} → deployment ${id}, from Doppler ${project}/${config}/${secret}`);
} else {
  throw new Error(
    "usage: registry.ts deployment <id> | route <slug> <id> | lend <id> <name> <project>/<config>/<SECRET> [--env <name>]",
  );
}

/** The namespace titled `title`, as the registry's store, through the Cloudflare API. */
async function storeOf(title: string): Promise<Store> {
  const listed = z
    .array(z.object({ id: z.string(), title: z.string() }))
    .parse(await ctx.cf("/storage/kv/namespaces?per_page=100"));
  const namespace = listed.find((known) => known.title === title);
  if (!namespace) throw new Error(`No KV namespace ${title}: deploy the router first`);
  const values = `/storage/kv/namespaces/${namespace.id}/values`;
  const token = ctx.secrets.CLOUDFLARE_API_TOKEN!;
  const url = (key: string) =>
    `https://api.cloudflare.com/client/v4/accounts/${env.cloudflareAccountId}${values}/${encodeURIComponent(key)}`;
  return {
    async get(key) {
      const answer = await fetch(url(key), { headers: { authorization: `Bearer ${token}` } });
      if (answer.status === 404) return null;
      if (!answer.ok) throw new Error(`KV read ${key}: HTTP ${answer.status}`);
      return await answer.text();
    },
    async put(key, value) {
      const answer = await fetch(url(key), {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
        body: value,
      });
      if (!answer.ok)
        throw new Error(`KV write ${key}: HTTP ${answer.status} ${await answer.text()}`);
    },
    async list(prefix) {
      const answer = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.cloudflareAccountId}/storage/kv/namespaces/${namespace.id}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!answer.ok) throw new Error(`KV list ${prefix}: HTTP ${answer.status}`);
      return z
        .object({ result: z.array(z.object({ name: z.string() })) })
        .parse(await answer.json())
        .result.map((key) => key.name);
    },
    async delete(key) {
      const answer = await fetch(url(key), {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!answer.ok && answer.status !== 404)
        throw new Error(`KV delete ${key}: HTTP ${answer.status} ${await answer.text()}`);
    },
  };
}
