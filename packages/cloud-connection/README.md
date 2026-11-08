# @iterate-com/cloud-connection

A project of a deployment the Iterate Cloud made, connected to the Cloud. In this version it sends
the project's mail: project code asks for a message, the ask is an event on the project's
`/iterate-cloud` context, and a fan-out row delivers that event to the Cloud's router as a signed
webhook. The router sends the message from the project's address, `<slug>@iterate2.app`. Userspace:
a project installs this package, and the platform ships none of it. Mail the router receives for the
project lands on the same context as `iterate-cloud/email-received`, in the shape of the platform's
`email/received` payload (`packages/cloud-router`); project code reads it there.

## Install

Not on npm yet: the package name waits for its claim (docs/depot-ci.md "A new package on npm"), so
main publishes it nowhere and a config repo cannot depend on it until then. Until then a project's
worker does what `installIterateCloud` does with the same append (the router's `scripts/proof.ts`
shows it).

The config repo depends on the package, and its config worker installs the connection's row on
every publication (`project/worker-updated`). The install is idempotent: it appends nothing while
`router` and `hook` stay the same.

```text
package.json   { "dependencies": { "@iterate-com/cloud-connection": "https://pkg.pr.new/iterate/private/@iterate-com/cloud-connection@<sha>" } }
```

```ts
// worker.ts
import { IterateConfigEntrypoint } from "iterate/sdk";
import { installIterateCloud } from "@iterate-com/cloud-connection";

export default class extends IterateConfigEntrypoint {
  async processEvent({ event, itx }) {
    if (event.type === "events.iterate.com/project/worker-updated")
      await installIterateCloud(itx, {
        router: "https://iterate2.app",
        hook: "<the deployment's hook>",
      });
  }
}
```

`hook` names the deployment at the router: the row POSTs to `<router>/.cloud/hooks/<hook>`.

## Send

```ts
import { iterateCloud } from "@iterate-com/cloud-connection";

const { offset } = await iterateCloud(itx).email.send({
  to: ["ada@example.com"],
  subject: "Hello",
  text: "Hi Ada",
});
```

It appends `iterate-cloud/email-requested { from, to, cc?, subject, text?, html? }` on
`/iterate-cloud` (`src/contract.ts`) and answers its offset. `from` is the project's own address,
its slug at `iterate2.app` (`iterateCloud(itx, { domain })` names another hostname). The router
records what happened on the same context, through the deployment's admin API:
`iterate-cloud/email-sent { requestOffset, id }`, or `iterate-cloud/email-failed { requestOffset,
error }` for a message it will never send (a bad shape, an address that is not this project's).
A delivery the router cannot verify halts the row until an operator resumes it; the zone's sender
failing makes the platform retry.

## The webhook

The row is one fan-out subscription on `/iterate-cloud`, named `iterate-cloud`, that consumes
`iterate-cloud/email-requested` alone. Its target is
`itx.cd('/').webhooks.get({ url, signingSecret: "/secrets/iterate-cloud" }).deliverEvent`: through
the project's root, where a webhook may name a signing secret and where the project's egress is.
Each POST carries the event as JSON, `iterate-event-id: <projectId>/iterate-cloud@<offset>` (a
retry repeats it), `iterate-timestamp`, and
`iterate-signature: v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`. A 2xx acks. Any other status is
retried on the event's own ladder, for about 44 hours. A 410 halts the row until an operator resumes
it. The router checks the signature, and checks that the body's `path` is `/iterate-cloud`: a
signature vouches for the project, not for one of its contexts.

## The signing secret

`/secrets/iterate-cloud` is the project's own secret, pinned to the router's origin. It must be set
on each project: a secret the project borrows from the deployment does not sign. The webhook reads
its key with the platform's `clientSecretFor`, which answers only material a secret holds itself
(core/os `src/secret/durable-object.ts`). So the deployment's lend to every project
(`session.global.secrets.lend(path, { to: "every-project", as })`, core/os
`docs/integrations.md`, "Instance lends") reaches the path, but the row's deliveries fail and are
retried. `test/vitest/os-workers/cloud-connection.test.ts` pins both.

The Cloud sets it per project, with the deployment's operator bearer (`ITERATE__ADMIN_BEARER`), over
`/api`:

```ts
const session = await api.authenticate({ type: "admin-secret", secret: adminBearer });
using project = await session.projects.get("<slug>");
await project.secrets.set("/secrets/iterate-cloud", "<the project's signing key>", {
  urls: ["https://iterate2.app"],
});
```

By hand, from a checkout:

```sh
ITERATE_ADMIN_BEARER=… pnpm exec iterate --config <deployment> itx run --project <slug> \
  --eval 'return await itx.secrets.set("/secrets/iterate-cloud", "<key>", { urls: ["https://iterate2.app"] })'
```

The router keeps the same key for the deployment's hook to verify with.
