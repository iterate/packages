# @iterate-com/cloud

Iterate Cloud as a package a project installs: a person signs in through the OS, connects a
Cloudflare account, and gets a deployment of iterate's platform (`core/os`) in that account, which
the Cloud deploys and updates. The project that installs it is the Cloud's origin and its backend;
its pages are [packages/cloud-app](../cloud-app/README.md), a Worker with no state.

Everything the Cloud knows is a context with a processor ([src/contract.ts](src/contract.ts)):

- **`/people/<sub>`** ([src/person.ts](src/person.ts)): a person's sign-ins, their Cloudflare
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

The project's config worker serves the Cloud ([src/worker.ts](src/worker.ts)): its own sign-in
through the OS ([src/sign-in.ts](src/sign-in.ts)), a capnweb API at `/rpc` for the signed-in
person ([src/api.ts](src/api.ts)), the return of a Cloudflare connect, and the pages, fetched
through to the Cloud app. The page's wizard is a state machine here ([src/wizard.ts](src/wizard.ts)),
and what it shows of a deployment is [src/views.ts](src/views.ts).

```ts
// the installing project's config: cloud.ts re-exports the facets, worker.ts serves the Cloud
export { CloudDeploymentFacet, CloudPersonFacet, CloudToolchainFacet } from "@iterate-com/cloud";
```

## What the installing project needs

- **`/secrets/cloud-cloudflare-client`**, `{ clientSecret }` pinned to `https://dash.cloudflare.com`:
  the secret of the Cloud's Cloudflare OAuth client, whose id the config passes in. Only the
  platform reads it, at a connect's code exchange and at each refresh. The client lists the
  platform's callback, `<platform origin>/.secrets/oauth/callback`, as a redirect URI.
- **`/secrets/cloud-image-source`**, `{ username, password }` pinned to
  `https://registry.cloudflare.com`, `username` public: a pull credential of the registry that holds
  `iterate-dev-image`, which that account's API mints
  (`POST /accounts/<account>/containers/registries/registry.cloudflare.com/credentials`,
  `{"permissions":["pull"],"expiration_minutes":…}`). It expires; a run that must copy the image
  then fails and names it.
- **The toolchain**, prepared once and again for each new core, with one event that names the
  sandbox image by its digest:
  `itx.cd("/toolchain").append({ type: "cloud/toolchain-requested", payload: { image: { account, secret, digest } } })`.
  The digest is `iterate-dev-image`'s under the source account in iterate's
  `scripts/os/images.lock.json`, at the commit core's main was copied from (its `GitOrigin-RevId`).
  The project needs no GitHub connection: the image step reads no repository.
- Nothing by hand for the sandboxes: each preparation writes two rules on its own context,
  `itx.fetch` and `itx.sandboxes` to the root's ([src/runs.ts](src/runs.ts) `withProjectRoots`). A
  sandbox's requests are answered by its context's `itx.fetch`, and its start from the toolchain
  finds that sandbox through its context's `itx.sandboxes`; a context beneath the root has neither.

The Cloud runs at the root of a host (prd: `cloud.iterate.app`) or under a base path, as a
project is served under paths ingress (`<platform>/projects/cloud`): the config worker reads the
path from `x-iterate-base-path` and every address it names carries it, and the pages follow
`@iterate-com/ui/apps/base-path`.

## The playground

`cloud-dev` (`osEnvs["cloud-dev"]` in iterate/private's `envs.ts`) is a standing core/os on the dev
account, at https://cloud-dev-os.iterate-dev-preview.workers.dev, whose `cloud` project serves the
Cloud at `/projects/cloud`, with the dev account's pages Worker (`cloudAppEnvs.preview`). A core
change goes there with one command, and the same deployment keeps its data:
`doppler run --project os --config preview -- pnpm os deploy --env cloud-dev`.

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
