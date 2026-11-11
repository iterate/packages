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
import { DEPLOYMENT_HEADER, Registry, sha256Hex, type Deployment } from "./registry.ts";

export type Env = {
  REGISTRY: KVNamespace;
  EMAIL: SendEmail;
  /** The zone the router answers: `iterate2.app`. */
  ZONE: string;
  /** The key the registry's values are sealed with: 32 bytes, base64. */
  CLOUD_ROUTER_KV_KEY: string;
  /** The Cloud's platform (`https://os.iterate.com`) and a bearer that reaches the Cloud's project
   *  there as a member: how the router asks the Cloud for what a person connected (X). The
   *  operator's bearer for now; a key of the router's own later. */
  CLOUD_API: string;
  CLOUD_API_BEARER: string;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const registry = registryOf(env);
    const hook = /^\/\.cloud\/hooks\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (url.hostname === env.ZONE) {
      if (hook && request.method === "POST") return await hooked(request, hook[1]!, env, registry);
      if (url.pathname.startsWith("/.cloud/egress/"))
        return await egress(request, url, env, registry);
      return text(404, "Not found.");
    }
    return await forward(request, url, env, registry);
  },
  async email(message, env) {
    await mailIn(message, env, registryOf(env));
  },
  // every minute: what reached @iterate from connected people, to their deployments. Until a
  // member connects @iterate the Cloud refuses the read, which is no failure of the schedule.
  async scheduled(_controller, env) {
    try {
      await deliverInbox(env, registryOf(env));
    } catch (failure) {
      const why = failure instanceof Error ? failure.message : String(failure);
      if (!why.includes("no @iterate account connected")) throw failure;
      console.warn(`inbox: ${why}`);
    }
  },
} satisfies ExportedHandler<Env>;

/** The registry over the Worker's namespace. */
export const registryOf = (env: Env) =>
  new Registry(
    {
      get: (key) => env.REGISTRY.get(key),
      put: (key, value) => env.REGISTRY.put(key, value),
      delete: (key) => env.REGISTRY.delete(key),
      list: async (prefix) => (await env.REGISTRY.list({ prefix })).keys.map((key) => key.name),
    },
    env.CLOUD_ROUTER_KV_KEY,
  );

// ── the Cloud on X ──────────────────────────────────────────────────────────────────────────────

/** The Cloud's X facet (`CloudXFacet`, a member's calls), through the Cloud's
 *  platform: the inbox, and a reply as @iterate. */
function cloudX(env: Env) {
  const call = async <T>(
    name: "inbox" | "inboxRead" | "reply",
    schema: z.ZodType<T>,
    ...args: unknown[]
  ) => {
    // the bearer rides the request too: an HTTP batch without one meets the API's 401 before it runs
    // oxlint-disable-next-line iterate/no-capnweb-http-batch -- one bounded call, with no live capability
    using api = newHttpBatchRpcSession<IterateApi>(
      new Request(`${env.CLOUD_API}/api`, {
        headers: { authorization: `Bearer ${env.CLOUD_API_BEARER}` },
      }),
    );
    const handle = api
      .authenticate({ type: "admin-secret", secret: env.CLOUD_API_BEARER })
      .projects.get("cloud")
      .cd("/x")
      .facets.get("cloud-x");
    // safe: a capnweb stub of `facets.get` erases the facet's methods; these are the X facet's
    const facet = handle as unknown as Record<string, (...input: unknown[]) => Promise<unknown>>;
    return schema.parse(await facet[name]!(...args));
  };
  return {
    inbox: () => call("inbox", Inbox),
    inboxRead: (cursor: z.infer<typeof Inbox>["cursor"] & { delivered: number }) =>
      call("inboxRead", z.unknown(), cursor),
    reply: (ask: z.infer<typeof ReplyAsk>) => call("reply", z.object({ id: z.string() }), ask),
  };
}

const Inbox = z.object({
  /** where the next read starts once these are landed (`inboxRead`) */
  cursor: z.object({ dmSince: z.string().nullable(), mentionSince: z.string().nullable() }),
  messages: z.array(
    z.object({
      kind: z.enum(["dm", "mention"]),
      id: z.string(),
      text: z.string(),
      at: z.string(),
      from: z.object({ xUserId: z.string() }),
      conversationId: z.string().nullable(),
      person: z.object({ sub: z.string(), username: z.string(), deployments: z.array(z.string()) }),
    }),
  ),
});

/** What reached @iterate from connected people since the last read, delivered to every routed
 *  project of each person's registered deployments as `x/message-received` on the project's
 *  `/iterate-cloud/integrations/x/<account>` context, where a reply may be asked for: the first
 *  delivery there installs the row that brings `x/reply-requested` back to this hook. Each message
 *  is keyed by X's id, so a second read of the same message lands nothing new, and the Cloud's
 *  cursor advances only once every message of a read has landed. */
export async function deliverInbox(env: Env, registry: Registry) {
  const cloud = cloudX(env);
  const { messages, cursor } = await cloud.inbox();
  for (const message of messages) {
    const account = message.person.username.toLowerCase();
    for (const id of message.person.deployments) {
      const deployment = await registry.deployment(id);
      if (!deployment) continue;
      for (const route of await registry.routesOf(id)) {
        const path = `/iterate-cloud/integrations/x/${account}`;
        await appendAsAdmin(
          env,
          deployment,
          route.projectId,
          {
            type: "events.iterate.com/itx/subscription-configured",
            idempotencyKey: `x/hook:${env.ZONE}/.cloud/hooks/${id}`,
            payload: {
              name: "iterate-cloud",
              target: [
                "itx",
                ["cd", "/"],
                "webhooks",
                [
                  "get",
                  {
                    url: `https://${env.ZONE}/.cloud/hooks/${id}`,
                    signingSecret: "/secrets/iterate-cloud",
                  },
                ],
                "deliverEvent",
              ],
              consumes: ["x/reply-requested"],
              ordered: false,
            },
          },
          path,
        );
        await appendAsAdmin(
          env,
          deployment,
          route.projectId,
          {
            type: "x/message-received",
            idempotencyKey: `x/message:${message.kind}:${message.id}`,
            payload: {
              kind: message.kind,
              id: message.id,
              text: message.text,
              at: message.at,
              from: { xUserId: message.from.xUserId, username: message.person.username },
              conversationId: message.conversationId,
            },
          },
          path,
        );
      }
    }
  }
  // every message landed (a throw above leaves the cursor, and the next read brings them back):
  // the Cloud's cursor advances past what was read
  await cloud.inboxRead({ ...cursor, delivered: messages.length });
  return messages.length;
}

// ── forwarding ──────────────────────────────────────────────────────────────────────────────────

async function forward(request: Request, url: URL, env: Env, registry: Registry) {
  const address = projectAddressOf({ type: "subdomains", hostname: env.ZONE }, url, "");
  const deployment = address && (await registry.routed(address.project));
  if (!address || !deployment) return text(421, `No iterate deployment holds ${url.hostname}.`);
  // the deployment's paths ingress: the project's apex, or one of its routing slugs. A path that
  // already names the project (a page's own link under its base path) goes as it is.
  const base = `/projects/${address.project}${address.routingSlug ? `/${address.routingSlug}` : ""}`;
  const own = url.pathname.startsWith(`/projects/${address.project}/`);
  // A provided deployment answers on the project host that holds its stub, through the fetch
  // route its `provide` set, which matches the header naming it: the same paths as an origin's.
  const origin = "provided" in deployment ? deployment.provided.host : deployment.origin;
  const target = new URL(`${own ? "" : base}${url.pathname}${url.search}`, origin);
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.startsWith("x-itx-")) headers.delete(name);
  headers.delete(DEPLOYMENT_HEADER);
  if ("provided" in deployment) {
    headers.set(DEPLOYMENT_HEADER, deployment.id);
    // the platform's edge reads a bearer on its project hosts and refuses one it did not mint
    headers.delete("authorization");
  }
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
  if (moved.origin !== origin || !inside) return answer;
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
 *  for its Cloud. A failure throws, and the sender's server tries
 *  again. Nothing of it is kept here. */
async function mailIn(message: ForwardableEmailMessage, env: Env, registry: Registry) {
  const slug = slugOfAddress(message.to, env.ZONE);
  const deployment = slug && (await registry.routed(slug));
  if (!slug || !deployment) return message.setReject("No such address.");
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  // named one by one: the message's fields are getters, which a spread does not copy
  const payload = await receivedOf({
    from: message.from,
    to: message.to,
    headers: message.headers,
    raw,
  });
  // keyed by the message itself when it carries no id, so a redelivery after a lost answer lands
  // nothing new (the platform's own receiveEmail keys the same way)
  const key = payload.messageId || (await sha256Hex(new TextDecoder().decode(raw))).slice(0, 16);
  await appendAsAdmin(env, deployment, deployment.projectId, {
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
async function hooked(request: Request, id: string, env: Env, registry: Registry) {
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
  if (event.type === "x/reply-requested") return await replyOut(deployment, event, projectId, env);
  return await mailOut(id, deployment, event, projectId, env, registry);
}

/** A project's ask to answer a message to @iterate (`x/reply-requested` on its X context): the
 *  Cloud sends it as @iterate, and what happened is recorded on that context, `x/reply-sent
 *  { requestOffset, id }` or `x/reply-failed { requestOffset, error }`, both acked. */
async function replyOut(
  deployment: Deployment,
  event: z.infer<typeof Delivery>,
  projectId: string | undefined,
  env: Env,
) {
  // As a mail's outcome (`mailOut`): a sent reply is acked even when its record cannot be
  // written, so @iterate never says it twice; a refusal whose record cannot be written is not
  // acked, so the platform brings it back.
  const outcome = async (fact: { id: string } | { error: string }) => {
    try {
      if (projectId)
        await appendAsAdmin(
          env,
          deployment,
          projectId,
          {
            type: "error" in fact ? "x/reply-failed" : "x/reply-sent",
            idempotencyKey: `x/reply-outcome:${event.offset}`,
            payload: { requestOffset: event.offset, ...fact },
          },
          event.path,
        );
    } catch (failure) {
      if ("error" in fact)
        return text(500, `The refusal could not be recorded on the project: ${String(failure)}`);
      console.error(
        `reply ${event.offset}: sent as ${fact.id}, its record not written: ${String(failure)}`,
      );
    }
    return Response.json(fact);
  };
  const asked = ReplyAsk.safeParse(event.payload);
  if (!asked.success) return await outcome({ error: z.prettifyError(asked.error) });
  try {
    return await outcome(await cloudX(env).reply(asked.data));
  } catch (failure) {
    return await outcome({ error: failure instanceof Error ? failure.message : String(failure) });
  }
}

const ReplyAsk = z.union([
  z.object({ kind: z.literal("dm"), to: z.string(), text: z.string().min(1) }),
  z.object({ kind: z.literal("mention"), inReplyTo: z.string(), text: z.string().min(1) }),
]);

/** A project's ask to send mail from its address (`iterate-cloud/email-requested`). */
async function mailOut(
  id: string,
  deployment: Deployment,
  event: z.infer<typeof Delivery>,
  projectId: string | undefined,
  env: Env,
  registry: Registry,
) {
  // The outcome goes on the project, then the delivery is acked. A sent message is acked even when
  // its record cannot be written (the record is lost, the message is not sent twice); a refusal
  // whose record cannot be written is not acked, so the platform brings it back (nothing was sent).
  const outcome = async (fact: { id: string } | { error: string }) => {
    try {
      if (projectId)
        await appendAsAdmin(env, deployment, projectId, {
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
const Delivery = z.object({
  type: z.string(),
  offset: z.number().int(),
  path: z.string(),
  payload: z.unknown(),
});

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

/** One append on a project of the deployment, as the router's own fact: through its admin API, or,
 *  for a provided deployment, through the stub it provided, which the Cloud's platform pages
 *  (`invoke` on the project that holds it, as the Cloud's operator). */
async function appendAsAdmin(
  env: Env,
  deployment: Deployment,
  projectId: string,
  event: { type: string; idempotencyKey: string; payload: Record<string, unknown> },
  path = "/iterate-cloud",
) {
  if ("provided" in deployment) {
    const { project, at } = deployment.provided;
    // the bearer rides the request too: an HTTP batch without one meets the API's 401 before it runs
    // oxlint-disable-next-line iterate/no-capnweb-http-batch -- one bounded call, the append, with no live capability
    using api = newHttpBatchRpcSession<IterateApi>(
      new Request(`${env.CLOUD_API}/api`, {
        headers: { authorization: `Bearer ${env.CLOUD_API_BEARER}` },
      }),
    );
    await api
      .authenticate({ type: "admin-secret", secret: env.CLOUD_API_BEARER })
      .projects.get(project)
      .invoke([...at.split("."), "projects", ["get", projectId], ["cd", path], ["append", event]]);
    return;
  }
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
    .cd(path)
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
async function egress(request: Request, url: URL, env: Env, registry: Registry) {
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
  // the person's X account, connected at the Cloud: the Cloud makes the request on their behalf,
  // through its own egress, and the token never leaves the platform
  if (missing === "x" && host === xApiHost && deployment.owner)
    return await viaCloud(request, `${target.slice(slash)}${url.search}`, deployment.owner, env);
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

const xApiHost = "api.x.com";

/** A request to X's API on the deployment owner's behalf, made by the Cloud
 *  (`CloudPersonFacet.xFetch`, a member's call): the owner's connected account, its token in the
 *  Cloud's egress alone. The answer is X's, status and body. */
async function viaCloud(request: Request, path: string, owner: string, env: Env) {
  const method = request.method;
  if (method !== "GET" && method !== "POST" && method !== "DELETE")
    return text(405, "X is asked with GET, POST or DELETE.");
  const body = method === "GET" ? "" : await request.text();
  // the bearer rides the request too: an HTTP batch without one meets the API's 401 before it runs
  // oxlint-disable-next-line iterate/no-capnweb-http-batch -- one bounded call, the fetch, with no live capability
  using api = newHttpBatchRpcSession<IterateApi>(
    new Request(`${env.CLOUD_API}/api`, {
      headers: { authorization: `Bearer ${env.CLOUD_API_BEARER}` },
    }),
  );
  const handle = api
    .authenticate({ type: "admin-secret", secret: env.CLOUD_API_BEARER })
    .projects.get("cloud")
    .cd(`/people/${owner}`)
    .facets.get("cloud-person");
  // safe: a capnweb stub of `facets.get` erases the facet's methods; `xFetch` is the person facet's
  // (`CloudPersonFacet`), a member's call
  const person = handle as unknown as { xFetch(input: XRequest): Promise<unknown> };
  try {
    const answer = XAnswer.parse(
      await person.xFetch({ method, path: path || "/2/users/me", body }),
    );
    return new Response(answer.body, {
      status: answer.status,
      headers: { "content-type": answer.contentType },
    });
  } catch (failure) {
    // the Cloud refused (no X account connected, a path X's API has not) or did not answer
    const why = failure instanceof Error ? failure.message : String(failure);
    return text(409, `The Cloud did not ask X: ${why}`);
  }
}

type XRequest = { method: "GET" | "POST" | "DELETE"; path: string; body?: string };
const XAnswer = z.object({ status: z.number().int(), contentType: z.string(), body: z.string() });

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
