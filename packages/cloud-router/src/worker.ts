// cloud-router/worker.ts — THE CLOUD'S ROUTER on iterate2.app, a proof of concept (README.md): it
// gives a deployment the Cloud made hosts and addresses under the zone, through the deployment's
// paths ingress and its admin API, with no change to the deployment, and keeps nothing of what
// passes through it.
//
//   <slug>.iterate2.app/<path>          → <origin>/projects/<slug>/<path>
//   <app>--<slug>.iterate2.app/<path>   → <origin>/projects/<slug>/<app>/<path>
//   <slug>[+tag]@iterate2.app           → `iterate-cloud/email-received` on the project's /iterate-cloud
//   POST https://iterate2.app/.cloud/hooks/<deployment id>
//                                       a signed `itx.webhooks` delivery: mail out from
//                                       `<slug>@iterate2.app`
//   https://iterate2.app/.cloud/egress/<host>/<path>
//                                       egress through the Cloud with a secret the Cloud lends the
//                                       deployment: `cloudSecret("<name>")` in a header is filled
//                                       here and the request forwarded to https://<host>/<path>
//
// What is routed where is the registry (registry.ts), written by scripts/registry.ts.
import { newHttpBatchRpcSession } from "capnweb";
import type { IterateApi } from "iterate/api";
import { projectAddressOf } from "iterate/project-ingress";
import PostalMime from "postal-mime";
import { z } from "zod";
import { Registry, sha256Hex, type Deployment } from "./registry.ts";

export type Env = {
  REGISTRY: KVNamespace;
  EMAIL: SendEmail;
  /** The zone the router answers: `iterate2.app`. */
  ZONE: string;
  /** The key the registry's values are sealed with: 32 bytes, base64. */
  CLOUD_ROUTER_KV_KEY: string;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const registry = new Registry(env.REGISTRY, env.CLOUD_ROUTER_KV_KEY);
    const hook = /^\/\.cloud\/hooks\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (url.hostname === env.ZONE) {
      if (hook && request.method === "POST") return await mailOut(request, hook[1]!, env, registry);
      if (url.pathname.startsWith("/.cloud/egress/")) return await egress(request, url, registry);
      return text(404, "Not found.");
    }
    return await forward(request, url, env, registry);
  },
  async email(message, env) {
    await mailIn(message, env, new Registry(env.REGISTRY, env.CLOUD_ROUTER_KV_KEY));
  },
} satisfies ExportedHandler<Env>;

// ── forwarding ──────────────────────────────────────────────────────────────────────────────────

async function forward(request: Request, url: URL, env: Env, registry: Registry) {
  const address = projectAddressOf({ type: "subdomains", hostname: env.ZONE }, url, "");
  const deployment = address && (await registry.routed(address.project));
  if (!address || !deployment) return text(421, `No iterate deployment holds ${url.hostname}.`);
  // the deployment's paths ingress: the project's apex, or one of its routing slugs. A path that
  // already names the project (a page's own link under its base path) goes as it is.
  const base = `/projects/${address.project}${address.routingSlug ? `/${address.routingSlug}` : ""}`;
  const own = url.pathname.startsWith(`/projects/${address.project}/`);
  const target = new URL(`${own ? "" : base}${url.pathname}${url.search}`, deployment.origin);
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.startsWith("x-itx-")) headers.delete(name);
  const answer = await fetch(
    new Request(target, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
      // safe: `duplex` is the Fetch standard's field for a streamed body, which Node asks for and
      // workers-types' RequestInit does not name
      ...({ duplex: "half" } as RequestInit),
    }),
  );
  // a WebSocket's 101 goes back as it is; a redirect into the project comes back to its host
  const location = answer.headers.get("location");
  if (answer.status === 101 || !location) return answer;
  const moved = new URL(location, target);
  const inside = moved.pathname === base || moved.pathname.startsWith(`${base}/`);
  if (moved.origin !== deployment.origin || !inside) return answer;
  const rewritten = new Response(answer.body, answer);
  rewritten.headers.set(
    "location",
    `${url.origin}${moved.pathname.slice(base.length) || "/"}${moved.search}`,
  );
  return rewritten;
}

// ── mail in ─────────────────────────────────────────────────────────────────────────────────────

/** A message to `<slug>[+tag]@<zone>`, recorded as `iterate-cloud/email-received` on the project's
 *  `/iterate-cloud` context through the deployment's admin API: the platform's own `email/received`
 *  is its alone to append, so the Cloud's mail is the Cloud's fact, on the context a project keeps
 *  for its Cloud (packages/cloud-connection). A failure throws, and the sender's server tries
 *  again. Nothing of it is kept here. */
async function mailIn(message: ForwardableEmailMessage, env: Env, registry: Registry) {
  const slug = slugOfAddress(message.to, env.ZONE);
  const deployment = slug && (await registry.routed(slug));
  if (!slug || !deployment) return message.setReject("No such address.");
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  const payload = await receivedOf({ ...message, raw });
  // keyed by the message itself when it carries no id, so a redelivery after a lost answer lands
  // nothing new (the platform's own receiveEmail keys the same way)
  const key = payload.messageId || (await sha256Hex(new TextDecoder().decode(raw))).slice(0, 16);
  await appendAsAdmin(deployment, deployment.projectId, {
    type: "iterate-cloud/email-received", // a package's own type, unprefixed (core/lib README.md)
    idempotencyKey: `iterate-cloud/email-received:${key}:${message.to}`,
    payload,
  });
}

/** The message as it arrived, in the shape of the platform's `email/received` payload (core/lib
 *  email.ts `EmailContract`) so a reader knows it: no attachments (the platform keeps them as
 *  project files, which the router does not write) and no raw file, and nothing vouched for (the
 *  router has none of Cloudflare's verdicts). */
export async function receivedOf(
  message: Pick<ForwardableEmailMessage, "from" | "to" | "headers"> & {
    raw: Uint8Array | ReadableStream<Uint8Array>;
  },
) {
  const mail = await PostalMime.parse(message.raw);
  const addresses = (list: { address?: string }[] | undefined) =>
    (list || []).flatMap((entry) => (entry.address ? [entry.address] : []));
  const bare = (id: string | undefined) => id?.trim().replace(/^<|>$/g, "") || null;
  const automated = Boolean(
    /^auto-/i.test(message.headers.get("auto-submitted") || "") ||
    /bulk|list|junk/i.test(message.headers.get("precedence") || "") ||
    message.headers.get("list-id"),
  );
  return {
    messageId: bare(mail.messageId),
    from: mail.from?.address || message.from,
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    subject: mail.subject || "",
    text: mail.text?.slice(0, 100_000) || null,
    html: mail.html?.slice(0, 100_000) || null,
    inReplyTo: bare(mail.inReplyTo),
    references: (mail.references || "").split(/\s+/).flatMap((id) => (bare(id) ? [bare(id)!] : [])),
    attachments: [],
    ...(mail.replyTo?.[0]?.address && { replyTo: mail.replyTo[0].address }),
    envelope: { from: message.from, to: message.to },
    sender: { verified: false, member: false, direct: false },
    automated,
    authentication: { spf: null, dkim: null, dmarc: null },
  };
}

// ── mail out ────────────────────────────────────────────────────────────────────────────────────

/** A delivery of the platform's `itx.webhooks` (core/lib api.ts): the event as JSON, signed
 *  `v1=<hex HMAC-SHA256 of "<timestamp>.<body>">` with the deployment's hook secret, its
 *  `iterate-event-id` naming the project. The event asks for a message from `<slug>@<zone>`, which
 *  must be the delivering project's own address: a secret vouches for the deployment, the route
 *  for the project. What happens is recorded back on the project's `/iterate-cloud`:
 *  `iterate-cloud/email-sent { requestOffset, id }`, or `iterate-cloud/email-failed
 *  { requestOffset, error }` for a message that can never go (a bad shape, an address not the
 *  project's), acked with a 200 so the platform does not retry it. A signature that does not
 *  verify answers 410: the row's secret is wrong, and the platform halts the row until an operator
 *  resumes it. The zone's sender failing answers 500, and the platform retries. */
async function mailOut(request: Request, id: string, env: Env, registry: Registry) {
  const deployment = await registry.deployment(id);
  const body = await request.text();
  const timestamp = request.headers.get("iterate-timestamp") || "";
  const signature = /^v1=([0-9a-f]{64})$/.exec(request.headers.get("iterate-signature") || "")?.[1];
  const expected = deployment && (await hmacHex(deployment.hookSecret, `${timestamp}.${body}`));
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
  if (!expected || !signature || !fresh || !sameText(signature, expected))
    return text(410, "The delivery is not signed with this deployment's hook secret, now.");
  const delivered = Delivery.safeParse(JSON.parse(body));
  if (!delivered.success) return text(400, z.prettifyError(delivered.error));
  const event = delivered.data;
  const projectId = /^(prj_[a-z0-9]+)/.exec(request.headers.get("iterate-event-id") || "")?.[1];
  // The outcome goes on the project, then the delivery is acked. A sent message is acked even when
  // its record cannot be written (the record is lost, the message is not sent twice); a refusal
  // whose record cannot be written is not acked, so the platform brings it back (nothing was sent).
  const outcome = async (fact: { id: string } | { error: string }) => {
    try {
      if (projectId)
        await appendAsAdmin(deployment, projectId, {
          type: "error" in fact ? "iterate-cloud/email-failed" : "iterate-cloud/email-sent",
          idempotencyKey: `iterate-cloud/email-outcome:${event.offset}`,
          payload: { requestOffset: event.offset, ...fact },
        });
    } catch (failure) {
      if ("error" in fact)
        return text(500, `The refusal could not be recorded on the project: ${String(failure)}`);
      console.error(
        `mail out ${event.offset}: sent as ${fact.id}, its record not written: ${String(failure)}`,
      );
    }
    return Response.json(fact);
  };
  const message = Outbound.safeParse(event.payload);
  if (!message.success) return await outcome({ error: z.prettifyError(message.error) });
  const { from, ...rest } = message.data;
  const slug = slugOfAddress(from, env.ZONE);
  const route = slug && (await registry.route(slug));
  if (!route || route.deployment !== id || route.projectId !== projectId)
    return await outcome({ error: `${from} is not this project's address.` });
  // safe: `Outbound` is the builder's shape, its body text or html (workers-types names the two as
  // alternatives, which a parsed object with both optional does not narrow to)
  const sent = await env.EMAIL.send({ from, ...rest } as EmailMessageBuilder);
  return await outcome({ id: sent.messageId });
}

/** The delivered event, as far as the router reads it. */
const Delivery = z.object({ offset: z.number().int(), path: z.string(), payload: z.unknown() });

const Addresses = z.union([z.email(), z.array(z.email()).min(1).max(50)]);
const Outbound = z
  .object({
    from: z.email(),
    to: Addresses,
    cc: Addresses.optional(),
    subject: z.string().min(1).max(998),
    text: z.string().optional(),
    html: z.string().optional(),
  })
  .refine((mail) => mail.text || mail.html, "A message has a text or an html body.");

/** One append on a project of the deployment, through its admin API, as the router's own fact. */
async function appendAsAdmin(
  deployment: Deployment,
  projectId: string,
  event: { type: string; idempotencyKey: string; payload: Record<string, unknown> },
) {
  // the bearer rides the request too: an HTTP batch without one meets the API's 401 before it runs
  // oxlint-disable-next-line iterate/no-capnweb-http-batch -- one bounded call, the append, with no live capability
  using api = newHttpBatchRpcSession<IterateApi>(
    new Request(`${deployment.origin}/api`, {
      headers: { authorization: `Bearer ${deployment.bearer}` },
    }),
  );
  await api
    .authenticate({ type: "admin-secret", secret: deployment.bearer })
    .projects.get(projectId)
    .cd("/iterate-cloud")
    .append(event);
}

// ── egress through the Cloud ────────────────────────────────────────────────────────────────────

/** `cloudSecret("<name>")` in a header's value: the secret the Cloud lends the deployment under
 *  that name, filled here and nowhere the deployment can read it. */
const CLOUD_SECRET = /cloudSecret\("([a-zA-Z0-9._-]+)"\)/g;

/** A request from a deployment's project, through the Cloud, to `https://<host>/<path>`: the
 *  deployment proves itself with its hook secret (`x-itx-cloud`, which the project's egress fills
 *  from `/secrets/iterate-cloud`), every `cloudSecret("<name>")` in a header is replaced with the
 *  secret the Cloud lends that deployment under `name` (registry.ts `lends`), and the answer streams
 *  back as it comes. A name the Cloud does not lend the deployment is refused, and no request goes
 *  out. The deployment never holds the key; the Cloud sees every use. */
async function egress(request: Request, url: URL, registry: Registry) {
  const secret = request.headers.get("x-itx-cloud") || "";
  const deployment = secret && (await registry.deploymentByHookSecret(secret));
  if (!deployment) return text(401, "Not a deployment's hook secret.");
  const target = url.pathname.slice("/.cloud/egress/".length);
  const slash = target.indexOf("/");
  const host = slash === -1 ? target : target.slice(0, slash);
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes("."))
    return text(400, "The path names the host, then the path: /.cloud/egress/<host>/<path>.");
  const lends = (await registry.lends(deployment.id)) || {};
  const headers = new Headers(request.headers);
  for (const name of [
    "x-itx-cloud",
    "host",
    "cf-connecting-ip",
    "cf-ray",
    "cf-visitor",
    "x-forwarded-proto",
    "x-real-ip",
  ])
    headers.delete(name);
  let missing: string | null = null;
  for (const [name, value] of [...headers]) {
    if (!value.includes("cloudSecret(")) continue;
    const filled = value.replace(CLOUD_SECRET, (_match, lent: string) => {
      if (lends[lent] === undefined) missing = lent;
      return lends[lent] ?? "";
    });
    headers.set(name, filled);
  }
  if (missing) return text(403, `The Cloud lends this deployment no secret named ${missing}.`);
  const upstream = new URL(
    `https://${host}${slash === -1 ? "/" : target.slice(slash)}${url.search}`,
  );
  return await fetch(
    new Request(upstream, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
      // safe: `duplex` is the Fetch standard's field for a streamed body, which Node asks for and
      // workers-types' RequestInit does not name
      ...({ duplex: "half" } as RequestInit),
    }),
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────

/** The slug of `<slug>[+tag]@<zone>`, lowercase, or null for an address elsewhere. */
export function slugOfAddress(address: string, zone: string) {
  const match = /^([^@+\s]+)(?:\+[^@\s]*)?@([^@\s]+)$/.exec(address.trim().toLowerCase());
  return match && match[2] === zone ? match[1]! : null;
}

async function hmacHex(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether two strings of one length are equal, compared in constant time. */
function sameText(a: string, b: string) {
  let differ = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index++)
    differ |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return differ === 0;
}

const text = (status: number, line: string) =>
  new Response(`${line}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
