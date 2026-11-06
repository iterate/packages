// cloud/cloudflare.ts — WHAT THE CLOUD ASKS OF CLOUDFLARE before a deployment exists: a person's
// consent through the Cloud's OAuth client, the accounts it reaches, and whether a name is free in
// one. Each request carries the connection's token as a placeholder, which the project's egress
// fills (the person's context reaches it through a rule: worker.ts `setUpPerson`); no code reads it.
import { z } from "zod";
import { CloudflareAccount, type CloudflareClient, type DeploymentRecord } from "./records.ts";
import { placeholderOf } from "./runs.ts";

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

/** The platform's OAuth attempt for one connection's secret: Cloudflare's consent through
 *  `client`, completed only in a browser signed in as `person` (whether or not they are a member of
 *  the project), then back to `next`, a page of the project's own. */
export const connectOptionsOf = (
  client: CloudflareClient,
  person: string,
  next: { routingSlug?: string; path: string },
) => ({
  authorizationEndpoint: "https://dash.cloudflare.com/oauth2/auth",
  tokenEndpoint: "https://dash.cloudflare.com/oauth2/token",
  clientId: client.clientId,
  clientSecret: `getSecret("${client.secret}", { field: "clientSecret" })`,
  next,
  completedByUserId: person,
  clientAuth: "client_secret_post" as const,
  scope: CLOUDFLARE_SCOPES.join(" "),
  urls: ["https://dash.cloudflare.com", "https://api.cloudflare.com"],
  // Cloudflare's token response names no one: `/user` does, called once with the new token
  account: {
    url: "https://api.cloudflare.com/client/v4/user",
    id: "result.id",
    name: "result.email",
  },
});

/** The Cloudflare accounts a connection's token reaches, as Cloudflare's API lists them. */
export async function accountsOf(connection: string) {
  const response = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", {
    headers: { authorization: `Bearer ${placeholderOf(connection)}` },
  });
  if (!response.ok) throw new Error(`Cloudflare listed no accounts: HTTP ${response.status}`);
  return z.object({ result: CloudflareAccount.array() }).parse(await response.json()).result;
}

/** Whether the account has a Worker named as the deployment: 404 is free, 200 is taken, anything
 *  else is a failure, said as Cloudflare answered it.
 *  https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/get/ */
export async function nameInAccount(record: DeploymentRecord) {
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
