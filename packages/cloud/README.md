# @iterate-com/cloud

Iterate Cloud as a package a project installs: a person signed in to the platform connects a
Cloudflare account, and gets a deployment of iterate's platform (`core/os`) in that account, which
the Cloud deploys and updates. The project that installs it is the Cloud's origin and its backend;
its pages are [packages/cloud-app](../cloud-app/README.md), a Worker with no state.

Everything the Cloud knows is a context with a processor ([src/contract.ts](src/contract.ts)):

- **`/people/<sub>`** ([src/person.ts](src/person.ts)): who the person is, their Cloudflare
  connections and their deployments.
- **`/deployments/<id>`** ([src/deployment.ts](src/deployment.ts)): the record and the config, the
  creation (the deployment's own sandbox, then its first deploy), and each run as a saga: its named
  steps with each one's newest text lines, and Alchemy's resources as its typed events report them
  ([src/alchemy.ts](src/alchemy.ts)).
- **`/toolchain`** ([src/toolchain.ts](src/toolchain.ts)): iterate/core installed and built once,
  saved as the snapshot every deployment's sandbox starts from.

The sandbox work is [src/runs.ts](src/runs.ts) and [src/image.ts](src/image.ts): the same deploy
program a laptop runs, as two steps (`pnpm build`, then `pnpm alchemy deploy --yes --log-format
json`, whose JSON records the run reads), with the Cloudflare grant as an egress placeholder that no
code reads. A deployment's three inputs are its config ([src/config.ts](src/config.ts)), its account,
and the grant.

THE CLOUD HAS NO API OF ITS OWN. The project lends each person their own facets (core/os
README.md, "A project lends a facet to a person"), and the person's page reaches them through the
platform's `/api`, as the Dash reaches a member's ([src/durable-object.ts](src/durable-object.ts)):
`cloud-person` on `/people/<sub>`, and `cloud-deployment` on each of their deployments. A lend gives
the facet's live state and the methods its class lists in `lentMethods`:

- **`cloud-person`**: `connectCloudflare({ next })` (the platform's OAuth start link, back to the
  page `next` names), `settleConnection(connection)` (what became of it, read with `oauthResult`),
  `checkName`, `createDeployment` (the deployment's processor and its lend, then the person's
  listing, then the deployment's request, so the page reaches it wherever the creation stops:
  [src/creation.ts](src/creation.ts)) and `finishCreation(id)` (a creation that stopped before
  its request, which the deployment's page offers as Start again).
- **`cloud-person`, X**: `connectX({ next })` and `settleX()` do the same for the person's X
  account through the Cloud's own X client ([src/x.ts](src/x.ts)). A connect also appends the
  platform's schedule of an ask, `cloud/x-settle-asked` after 20 s; each ask writes the next, after
  twice the wait up to ten minutes, and then the facet settles ([src/person.ts](src/person.ts)), so
  a consent settles when the page's own ask failed or the tab is gone. An attempt still pending
  after two hours of asks is given up as failed.
- **`cloud-deployment`**: `prepareAgain`, `requestRun(kind)`, `readOutput(requestOffset, step)` and
  `signInPassword` (only a deployment made before the next paragraph's sign-in has one; null for
  the rest).

`snapshot`, which holds the connections' nonces and the deployment's secrets, is never lent; nor is
anything of `/toolchain`. A lent method's own calls run as the facet's: the project's secrets through
`itx.cd("/").secrets`, Cloudflare's API through a rule on the person's context that sends its
`itx.fetch` to the root's, the project's egress ([src/cloudflare.ts](src/cloudflare.ts)).

A DEPLOYMENT SIGNS ITS OWNER IN THROUGH THE PLATFORM ITS CLOUD RUNS ON. Its config's one sign-in
method is log in with iterate, `login.methods.iterate = { issuer }`, the issuer the installing
project's config names (`https://os.iterate.com` on prd), so a signed-out page load goes straight
there ([src/config.ts](src/config.ts)). The page's Open is the deployment's deep link,
`<deployment>/.auth/sign-in/iterate?next=/`: the issuer shows the identity card the first time, and
the chain ends in the Dash, bound to the deployment (core/os docs/credentials.md). A password is
history: a deployment made before this holds one, which its page still shows.

The project's config worker serves the pages, fetched through to the Cloud app
([src/worker.ts](src/worker.ts)). The Cloud has no sign-in of its own either: who is signed in is
who the platform's stamp says (iterate/sdk `auth.person`). A signed-in document load sets the person
up, once per isolate and each step idempotent: their processor, the egress rule, the Cloudflare
platform the config names (`cloud/platform-configured`: the issuer and the Cloudflare client), a
`cloud/person-signed-in` record, and the lend of their facet. The person's facet lends every
deployment it lists the first time it serves them, so a deployment made before the Cloud lent
anything opens like a new one. The pages' button links to `/.auth/login?scope=identity`, and their
sign-out posts to `/.auth/logout`: under subdomains these are the project host's own (a consent with
the identity card, once per person), and the page's `/api` session is that host's identity grant;
under paths they are the platform's, whose origin the page shares (a person signed in to the
platform is signed in to the Cloud, with no consent), and the session is the issuer's. The page's
wizard is a state machine here ([src/wizard.ts](src/wizard.ts)), and what it shows of a deployment
is [src/views.ts](src/views.ts).

```ts
// the installing project's config: cloud.ts re-exports the facets, worker.ts serves the Cloud
export { CloudDeploymentFacet, CloudPersonFacet, CloudToolchainFacet } from "@iterate-com/cloud";
```

## What the installing project needs

- **Its config's `issuer` and `cloudflare`** in `serveCloud`'s options: the platform the Cloud runs
  on, through which every deployment signs its owner in, and the Cloud's Cloudflare OAuth client.
  `dash`, when the platform's Dash is not iterate's, is the Dash a deployment's `/` sends its owner
  to (the playground's; prd names none).
- **`/secrets/cloud-cloudflare-client`**, `{ clientSecret }` pinned to `https://dash.cloudflare.com`:
  the secret of the Cloud's Cloudflare OAuth client, whose id the config passes in. Only the
  platform reads it, at a connect's code exchange and at each refresh. The client lists the
  platform's callback, `<platform origin>/.secrets/oauth/callback`, as a redirect URI.
- **`/secrets/cloud-image-source`**, `{ username, password }` pinned to
  `https://registry.cloudflare.com`, `username` public: a pull credential of the registry that holds
  `iterate-dev-image`, which that account's API mints
  (`POST /accounts/<account>/containers/registries/registry.cloudflare.com/credentials`,
  `{"permissions":["pull"],"expiration_minutes":…}`). It expires; a run that must copy the image
  then fails and names it. A Cloud whose toolchain names no image needs none.
- **The toolchain**, prepared once and again for each new core, with one event:
  `itx.cd("/toolchain").append({ type: "cloud/toolchain-requested", payload: {} })`.
  Its deployments get no sandbox image: a run has no image step, and their sandboxes start
  Cloudflare's managed image.
- **The sandbox image, optional**: the same event with
  `payload: { image: { account, secret, digest } }` makes each plan and deploy put
  `iterate-dev-image` into the customer's account first ([src/image.ts](src/image.ts)). The digest
  is `iterate-dev-image`'s under the source account in iterate's `scripts/os/images.lock.json`, at
  the commit core's main was copied from (its `GitOrigin-RevId`). The project needs no GitHub
  connection: the image step reads no repository. **The copy does not work yet for an account that
  lacks the image**: crane uploads each layer through the project's egress, which gives a request
  50 seconds, and the image's large layers take longer (`504 … sent no answer within 50 s`).
- Nothing by hand for the sandboxes: each preparation writes two rules on its own context,
  `itx.fetch` and `itx.sandboxes` to the root's ([src/runs.ts](src/runs.ts) `withProjectRoots`). A
  sandbox's requests are answered by its context's `itx.fetch`, and its start from the toolchain
  finds that sandbox through its context's `itx.sandboxes`; a context beneath the root has neither.

The Cloud runs at the root of a host (prd: `cloud.iterate.app`) or under a base path, as a
project is served under paths ingress (`<platform>/projects/cloud`): the config worker reads the
path from `x-iterate-base-path` and every address it names carries it, and the pages follow
`@iterate-com/ui/apps/base-path`.

## A release

A release is the pages Worker deployed to prd, then prd's `cloud` project's config repo pinned to
pkg.pr.new's build of the same commit (its `package.json`), the publish's outcome event
(`project/worker-updated`, or `project/worker-update-failed` with its error), and the origin
answering signed out. CI does it on every push to main that changes the Cloud
(`.depot/workflows/deploy-cloud.yml`, `scripts/cloud/release.ts`):

- It pins only when `packages/cloud` changed since the build prd pins: a publish resets the Cloud's
  facets, so a push that changes only the pages leaves the pin.
- An install in flight survives a pin: the deployment's next attempt adopts its running script, from
  the line it reported last. A page open across a publish redraws the live state within 150 s: it redials
  when it hears nothing, not even the facet's minute probe.
- By hand: `node scripts/cloud/release.ts [--commit <sha>] [--dry-run]`, under Doppler os/prd, or
  with `CLOUD_RELEASE_BEARER` set to a member's own prd session.

Not in a release: the playground (below), pinned by hand, and the toolchain's core: new installs keep
the core of the last `cloud/toolchain-requested`, which an operator appends.

## The playground

`cloud-dev` (`osEnvs["cloud-dev"]` in iterate/private's `envs.ts`) is a standing core/os on the dev
account, at https://cloud-dev-os.iterate-dev-preview.workers.dev, whose `cloud` project serves the
Cloud at `/projects/cloud`, with the dev account's pages Worker (`cloudAppEnvs.preview`). A core
change goes there with one command, and the same deployment keeps its data:
`doppler run --project os --config preview -- pnpm os deploy --env cloud-dev`.
It has a Dash and an Agents app of its own (`cloud-dev-dash` and `cloud-dev-agents` on
`iterate-dev-preview.workers.dev`), which sign in against it and which it names as its own apps, so
a deployment's owner goes from the Cloud to that Dash as on prd. They deploy after it:
`doppler run --project os --config preview -- pnpm preview deploy-playground-apps`.

## The spec

`test/playwright/cloud/install.spec.ts` walks a new person through the whole Cloud, from the first
page to an agent's answer in a project of the iterate it deployed into the dev account, and always
destroys that deployment again, checking that the Worker and the Artifacts namespace are gone. Cloudflare's consent is the one step a robot cannot take: it stores what the
consent would have stored. Against the playground:

```sh
caffeinate -dimu doppler run --project os --config preview -- env WORKER_BASE_URL=https://cloud-dev-os.iterate-dev-preview.workers.dev CLOUD_BASE_URL=https://cloud-dev-os.iterate-dev-preview.workers.dev/projects/cloud pnpm spec --project cloud
caffeinate -dimu doppler run --project os --config preview -- env VIDEO_MODE=1 WORKER_BASE_URL=https://cloud-dev-os.iterate-dev-preview.workers.dev CLOUD_BASE_URL=https://cloud-dev-os.iterate-dev-preview.workers.dev/projects/cloud pnpm spec --project cloud
```

Without `CLOUD_BASE_URL` it skips.

Published per commit on pkg.pr.new (`.github/workflows/pkg-pr-new.yml`). `pnpm test` runs the
processors over an in-memory stream and the wizard over fakes.
