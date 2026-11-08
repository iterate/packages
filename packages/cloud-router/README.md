# @iterate-com/cloud-router

The Cloud's router on iterate2.app, a proof of concept: hosts, mail in both directions, and egress
with a secret the Cloud lends, for a deployment the Iterate Cloud made, with no change to the
deployment and nothing of what passes through kept here. One Worker in production's account with
`fetch` and `email` handlers, a KV registry whose every value is sealed, and the zone's routes,
DNS, Email Routing and sending, all from `alchemy.run.ts`.

What it does for a deployment registered with it, and a project `<slug>` routed to that
deployment:

| Direction                            | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<slug>.iterate2.app/<path>`         | forwarded to `<origin>/projects/<slug>/<path>`, the deployment's paths ingress                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `<app>--<slug>.iterate2.app/<path>`  | forwarded to `<origin>/projects/<slug>/<app>/<path>`: the routing slug reaches the project as `x-iterate-routing-slug`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `<slug>[+tag]@iterate2.app`          | the zone's catch-all delivers to the Worker, which appends `iterate-cloud/email-received` on the project's `/iterate-cloud` context through the deployment's admin API, the message parsed in the shape of the platform's `email/received` and nothing stored here                                                                                                                                                                                                                                                                                                    |
| `POST /.cloud/hooks/<deployment id>` | a delivery of the platform's `itx.webhooks` (`@iterate-com/cloud-connection` configures it): the deployment's hook secret verifies the signature, the route binds the `from` address to the delivering project, and the message goes out from `<slug>@iterate2.app` with the zone's `send_email` binding. What happened is recorded back on the project's `/iterate-cloud`: `iterate-cloud/email-sent`, or `email-failed` for a message that can never go, both acked; a signature that does not verify answers 410, which halts the row until an operator resumes it |
| `/.cloud/egress/<host>/<path>`       | egress through the Cloud: the deployment proves itself with its hook secret in `x-itx-cloud` (filled by its own egress from the project's `/secrets/iterate-cloud`), every `cloudSecret("<name>")` in a header is replaced with the secret the Cloud lends that deployment under `name`, and the request goes to `https://<host>/<path>`. The deployment never holds the key, and the Cloud sees every use. A name not lent is refused before anything goes out.                                                                                                      |

Under paths ingress the first segment after the project is a routing slug, so `<slug>.iterate2.app/ask`
reaches the project as the `ask` app at `/`, the same as `ask--<slug>.iterate2.app/`. A project
whose home page has sub-paths needs the deployment to serve iterate2.app as its own ingress hostname,
which takes a core change (a forwarded host the deployment trusts from its Cloud); the design is in
`tasks/iterate-cloud.md`.

## X

A person connects their X account at the Cloud (`packages/cloud`, the Cloud's own X client), and:

- a deployment of theirs reads the account through `/.cloud/egress/api.x.com/2/…` with
  `authorization: Bearer cloudSecret("x")`: the router asks the Cloud's person facet (`xFetch`, a
  member's call) to make the request through its own egress, and hands X's answer back;
- what the account writes to `@iterate` reaches their deployments: the Worker's minute schedule
  asks the Cloud's X facet for the inbox (`@iterate`'s direct messages and mentions since the last
  read, each with whose it is), and lands each message as `x/message-received` on
  `/iterate-cloud/integrations/x/<account>` of every routed project of the person's registered
  deployments, installing there the row that brings `x/reply-requested` back to the hook;
- a reply asked for goes out as `@iterate` through the Cloud's X facet, and `x/reply-sent` or
  `x/reply-failed` is recorded on the context.

`@iterate`'s own tokens are the Cloud's secret (`/secrets/cloud-x-iterate`), which a member
connects once (`connectIterateAccount`); the router reaches the Cloud's facets with the operator's
bearer for now (`CLOUD_API_BEARER`), a key of its own later.

## The registry

`src/registry.ts`: Workers KV, every value sealed with AES-GCM under `CLOUD_ROUTER_KV_KEY` (Doppler
os/prd), so the namespace alone gives no origin and no credential away. Meant for Workers KV
Instant (reads under 2 ms, writes everywhere in about 250 ms, one write per namespace per second,
which a registry written by a script never meets); production's account is not in that beta yet,
so it is a classic namespace until it is.

| Row                          | Holds                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `deployment:<id>`            | the deployment's origin, admin bearer, and the hook secret it signs with             |
| `hook:<sha256(hook secret)>` | which deployment a hook secret belongs to (egress); a new secret retires the old row |
| `route:<slug>`               | which deployment serves `<slug>`, and which project of it that is                    |
| `lends:<id>`                 | the secrets the Cloud lends the deployment, by name                                  |

Written by `scripts/registry.ts` through the Cloudflare API, the Cloud's state read with the
caller's own CLI login:

```sh
pnpm run deployment <deployment id>                 # origin and bearer from the Cloud; a new hook secret
pnpm run route <slug> <deployment id>               # the project's hosts and address; its /secrets/iterate-cloud gets the hook secret, pinned to the router
pnpm run lend <deployment id> openai os/preview/OPENAI_API_KEY   # the Cloud lends that Doppler secret under `openai`
```

## Deploy

```sh
pnpm --dir packages/cloud-router run deploy --env prd    # Doppler os/prd: the account's token and CLOUD_ROUTER_KV_KEY
```

Alchemy, state in the account's Cloudflare state store: the Worker (`cloud-router`), the KV
namespace, the `send_email` binding, routes `iterate2.app/*` and `*.iterate2.app/*`, the apex and
`*` as proxied `100::` records, Email Routing on the zone with the catch-all to the Worker, and the
zone enabled for sending (DKIM, SPF, the return path). The zone's universal certificate covers
`*.iterate2.app`, one level.

## The proof

On 2026-11-07, against Jonas's deployment `iterate-nov7` (his personal account, paths ingress, no
core change), with `scripts/proof.ts`:

- `https://r5f56e4e0.iterate2.app/`, `https://blog--r5f56e4e0.iterate2.app/` and
  `https://docs--r5f56e4e0.iterate2.app/x/y?z=1` answered the project's worker with its routing slug
  and path.
- A message from production's iterate project to `r5f56e4e0@iterate2.app` landed on the project's
  `/iterate-cloud` within seconds. The platform's own `email/received` is its alone to append, so
  the Cloud's mail is the Cloud's fact.
- `iterate-cloud/email-requested` on `/iterate-cloud`, delivered by the platform's webhook row and
  signed with the project's secret, arrived at a fresh iterate.com address from
  `r5f56e4e0@iterate2.app`.
- `https://ask--r5f56e4e0.iterate2.app/?q=…` asked a model: the project's worker fetched
  `https://iterate2.app/.cloud/egress/api.openai.com/v1/chat/completions` with
  `authorization: Bearer cloudSecret("openai")`, the router filled the key the Cloud lends the
  deployment (the dev OpenAI key, from Doppler), and the answer came back in about three seconds.
  Without the hook secret, 401; a name not lent, 403, nothing sent.

```sh
pnpm run proof project <id>            # a project with a random slug
pnpm run route <slug> <id>
pnpm run proof worker <id> <slug>      # proof-worker.txt: the home page, and the `ask` app
pnpm run proof webhook <id> <slug> <to>
pnpm run proof inbox <id> <slug>
```

## What the real thing changes

- The registry and the deployment's token come from the Cloud when it makes the deployment, not
  from a script; the Cloud's API lives here, one capnweb target at the root, backed by D1 with the
  KV rows as its projection.
- A deployment trusts a forwarded host from its Cloud and serves iterate2.app as its ingress
  hostname, so a project's apex has paths and cookies of its own (core).
- Inbound mail becomes the platform's `email/received` on the project, received by the deployment
  itself from the raw message, attachments included (core).
- A deployment proves itself with a short-lived token rather than a secret that lives in two places.
