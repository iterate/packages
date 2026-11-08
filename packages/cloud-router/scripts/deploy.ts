// scripts/deploy.ts — THE ROUTER'S DEPLOY (`pnpm run deploy --env prd`, `pnpm run plan --env prd`):
// its envs.ts entry and its Doppler config's secrets (the account's Cloudflare token and the two
// router secrets), then the Alchemy CLI on alchemy.run.ts with them in its environment.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { cloudRouterEnvs, getEnv, osEnvs } from "../../../envs.ts";
import { osIterateConfigOf } from "../../../scripts/os/iterate-config.ts";
import { resolveEnvContext } from "../../../scripts/lib/env-context.ts";

const [command = "deploy", flag, name] = process.argv.slice(2);
if (!["deploy", "plan"].includes(command) || flag !== "--env" || !name)
  throw new Error("usage: node scripts/deploy.ts deploy|plan --env <name>");
const ctx = await resolveEnvContext(getEnv(name, cloudRouterEnvs), { dopplerProject: "os" });
if (!ctx.secrets.CLOUD_ROUTER_KV_KEY)
  throw new Error(`Doppler os/${ctx.env.dopplerConfig} has no CLOUD_ROUTER_KV_KEY`);
// the operator's bearer of the Cloud's platform, as its config holds it: a key of the router's own
// later
const cloudPlatform = getEnv(ctx.env.cloudProject.config, osEnvs);
const operator = osIterateConfigOf(cloudPlatform, ctx.secrets).adminBearer.exposeSecret();
const run = spawnSync(
  process.execPath,
  [
    "node_modules/alchemy/bin/cli.js",
    command,
    "--stage",
    name,
    ...(command === "deploy" ? ["--yes"] : []),
  ],
  {
    cwd: path.join(import.meta.dirname, ".."),
    stdio: "inherit",
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: ctx.env.cloudflareAccountId,
      CLOUDFLARE_API_TOKEN: ctx.secrets.CLOUDFLARE_API_TOKEN,
      CLOUD_ROUTER_KV_KEY: ctx.secrets.CLOUD_ROUTER_KV_KEY,
      CLOUD_ROUTER_ZONE: ctx.env.zone,
      CLOUD_ROUTER_WORKER: ctx.env.workerName,
      CLOUD_API: cloudPlatform.baseUrl,
      CLOUD_API_BEARER: operator,
    },
  },
);
process.exit(run.status ?? 1);
