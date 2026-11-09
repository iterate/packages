// cloud/cloudflare.ts — WHAT THE CLOUD ASKS OF CLOUDFLARE before a deployment exists: a person's
// consent through the Cloud's OAuth client, the accounts it reaches, and whether a name is free in
// one. Each request carries the connection's token as a placeholder, which the project's egress
// fills (the person's context reaches it through a rule: worker.ts `setUpPerson`); no code reads it.
import { z } from "zod";
import {
  CloudflareAccount,
  WIZARD_SCOPES,
  Zone,
  type AccountReadiness,
  type CloudflareClient,
  type DeploymentRecord,
} from "./records.ts";
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
  ...WIZARD_SCOPES,
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

const get = (connection: string, path: string) =>
  fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${placeholderOf(connection)}` },
  });

/** Whether the account can hold a deployment: Workers Paid, R2 and Containers, each asked of
 *  Cloudflare. A Free account refuses R2 and Containers, and no API adds a card, so the page links
 *  to the dashboard and asks again. The plan itself is in the account's subscriptions
 *  (`workers_paid`), which an OAuth grant may not read (no billing scope exists): then Containers,
 *  which only Workers Paid has, answer for it.
 *  https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/ */
export async function readinessOf(
  connection: string,
  accountId: string,
): Promise<AccountReadiness> {
  const [subscriptions, r2, containers] = await Promise.all([
    get(connection, `/accounts/${accountId}/subscriptions`),
    get(connection, `/accounts/${accountId}/r2/buckets?per_page=1`),
    get(connection, `/accounts/${accountId}/containers/applications`),
  ]);
  // each subscription names its plan: `workers_paid` (seen on a paid account, 2026-11-09)
  const plans = subscriptions.ok
    ? z
        .object({
          result: z.array(z.object({ rate_plan: z.object({ id: z.string() }).nullish() })),
        })
        .safeParse(await subscriptions.json())
        .data?.result.map((plan) => plan.rate_plan?.id)
    : (await subscriptions.body?.cancel(), undefined);
  const enabled = async (response: Response) => {
    if (response.ok) return (await response.body?.cancel(), true);
    const text = await response.text();
    // 10042: R2 is not enabled on the account; a 401 or 403 alone may be a missing scope
    if (/"code":\s*10042/.test(text) || /not (enabled|entitled|subscribed)/i.test(text))
      return false;
    return response.status === 402 ? false : null;
  };
  const ready = { r2: await enabled(r2), containers: await enabled(containers) };
  const workersPaid = plans ? plans.includes("workers_paid") : ready.containers;
  const dash = `https://dash.cloudflare.com/${accountId}`;
  const message =
    workersPaid === false
      ? `Subscribe to Workers Paid: ${dash}/workers/plans`
      : ready.r2 === false
        ? `Enable R2: ${dash}/r2/overview`
        : ready.containers === false
          ? `Enable Containers: ${dash}/workers/containers`
          : workersPaid === null || ready.r2 === null || ready.containers === null
            ? "Cloudflare did not say for everything. Continue, and the install says what is missing."
            : null;
  return { workersPaid, ...ready, message };
}

/** The account's active zones: where a deployment's hostname can go. */
export async function zonesOf(connection: string, accountId: string) {
  const response = await get(
    connection,
    `/zones?account.id=${accountId}&status=active&per_page=50&order=name`,
  );
  if (!response.ok) throw new Error(`Cloudflare listed no zones: HTTP ${response.status}`);
  return z.object({ result: Zone.array() }).parse(await response.json()).result;
}

/** Whether the domain is free for a deployment: its routes take the domain and every name under
 *  it, so none of them may already serve something (an A, AAAA or CNAME record). Mail records (MX,
 *  TXT) are left alone and do not count. */
export async function hostnameInZone(connection: string, domain: DeploymentRecord["domain"]) {
  if (!domain) return { status: "free" as const, message: "" };
  const response = await get(connection, `/zones/${domain.zone.id}/dns_records?per_page=500`);
  if (!response.ok)
    return {
      status: "unknown" as const,
      message: `Cloudflare did not say whether ${domain.hostname} is free (HTTP ${response.status}). Try again.`,
    };
  const { result } = z
    .object({ result: z.array(z.object({ type: z.string(), name: z.string() })) })
    .parse(await response.json());
  const served = result
    .filter(
      (record) =>
        (record.name === domain.hostname || record.name.endsWith(`.${domain.hostname}`)) &&
        ["A", "AAAA", "CNAME"].includes(record.type),
    )
    .map((record) => record.name);
  if (served.length === 0)
    return { status: "free" as const, message: `${domain.hostname} is free for iterate.` };
  const names = [...new Set(served)];
  return {
    status: "taken" as const,
    message: `iterate takes ${domain.hostname} and every name under it, and ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""} already ${names.length === 1 ? "serves" : "serve"} something. Choose a domain you use only for iterate.`,
  };
}
