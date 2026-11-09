// examples/bun-box/enrol.ts — ENROL THE BOX WITH THE CLOUD'S ROUTER, and claim project slugs:
//
//   bun enrol.ts <slug> [<slug> …]
//
// Run once the box has dialled (server.ts writes where its stub is provided into `.box.json`).
// Writes the router's registry (src/registry.ts) through the Cloudflare API, with Doppler os/prd's
// CLOUDFLARE_API_TOKEN and CLOUD_ROUTER_KV_KEY: the deployment row (`provided`: the project, its
// host, the stub's expression; and the box's hook secret), then one route per slug, refused when
// the slug is another deployment's. An operator's script for now: the real enrolment is the
// deployment's own call to the Cloud.
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { Registry, type Store } from "../../src/registry.ts";
import { cloudRouterEnvs } from "../../../../envs.ts";
import { readBoxFile, writeBoxFile } from "./box-file.ts";

const slugs = process.argv.slice(2);
if (!slugs.length) throw new Error("usage: bun enrol.ts <slug> [<slug> …]");

const box = readBoxFile();
if (!box.provided) throw new Error("The box has not dialled yet: start server.ts first");

const env = cloudRouterEnvs.prd;
const secret = (name: string) =>
  execFileSync(
    "doppler",
    ["secrets", "get", name, "--project", "os", "--config", env.dopplerConfig, "--plain"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
const token = secret("CLOUDFLARE_API_TOKEN");
const registry = new Registry(await kvStore(`${env.workerName}-kv`), secret("CLOUD_ROUTER_KV_KEY"));
const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

await registry.setDeployment(box.deployment, {
  provided: box.provided,
  hookSecret: box.hookSecret,
});
console.log(`deployment ${box.deployment}: ${box.provided.at} on ${box.provided.host}`);

for (const slug of slugs) {
  const held = await registry.route(slug);
  if (held && held.deployment !== box.deployment)
    throw new Error(`${slug} is deployment ${held.deployment}'s: pick another slug`);
  const projectId = box.projects[slug] || `prj_box${hex(8)}`;
  // the box knows its project before the router routes to it (re-read: the box may have written)
  const now = readBoxFile();
  writeBoxFile({ ...now, projects: { ...now.projects, [slug]: projectId } });
  await new Promise((resolve) => setTimeout(resolve, 1_100)); // one KV write per key per second
  await registry.setRoute(slug, { deployment: box.deployment, projectId });
  console.log(`route https://${slug}.${env.zone}/ and ${slug}@${env.zone} → ${projectId}`);
}

/** The Cloudflare API's answers, as far as this reads them. */
const Listed = z.object({ result: z.array(z.object({ id: z.string(), title: z.string() })) });
const Keys = z.object({ result: z.array(z.object({ name: z.string() })) });

/** The router's KV namespace through the Cloudflare API. */
async function kvStore(title: string): Promise<Store> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.cloudflareAccountId}/storage/kv/namespaces`;
  const auth = { authorization: `Bearer ${token}` };
  const listed = Listed.parse(
    await (await fetch(`${base}?per_page=100`, { headers: auth })).json(),
  );
  const id = listed.result.find((namespace) => namespace.title === title)?.id;
  if (!id) throw new Error(`No KV namespace ${title}`);
  const value = (key: string) => `${base}/${id}/values/${encodeURIComponent(key)}`;
  return {
    async get(key) {
      const answer = await fetch(value(key), { headers: auth });
      if (answer.status === 404) return null;
      if (!answer.ok) throw new Error(`KV read ${key}: HTTP ${answer.status}`);
      return await answer.text();
    },
    async put(key, body) {
      const answer = await fetch(value(key), { method: "PUT", headers: auth, body });
      if (!answer.ok)
        throw new Error(`KV write ${key}: HTTP ${answer.status} ${await answer.text()}`);
    },
    async delete(key) {
      const answer = await fetch(value(key), { method: "DELETE", headers: auth });
      if (!answer.ok && answer.status !== 404)
        throw new Error(`KV delete ${key}: HTTP ${answer.status}`);
    },
    async list(prefix) {
      const answer = await fetch(
        `${base}/${id}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000`,
        { headers: auth },
      );
      return Keys.parse(await answer.json()).result.map((key) => key.name);
    },
  };
}
