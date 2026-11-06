# Iterate Cloud

Iterate Cloud's pages: the way in to the platform's sign-in, the wizard that makes a deployment, the list of a person's
deployments and each one's page. A TanStack Start Worker with no session, no secret and no state:
the `cloud` project's config worker ([@iterate-com/cloud](../cloud/README.md) `serveCloud`) fetches
every page through to it, keeping the visitor's cookies to itself. The Cloud has no API of its own:
the pages are a client of the platform's `/api` with the identity scope (`iterate/app`), and reach
the facets the project lends the person, as the Dash reaches a member's
([src/lib/iterate.ts](src/lib/iterate.ts)). Every page draws a facet's live state
(`useFacetLiveState`); the wizard is `@iterate-com/cloud/wizard`.

Deploy: CI deploys it with each release of the Cloud ([@iterate-com/cloud](../cloud/README.md), "A
release"); by hand, `pnpm --dir packages/cloud-app run deploy --env prd` (`cloudAppEnvs` in the root
`envs.ts`). It has no secrets, so it deploys from `_shared`'s `prd` Doppler config.

## Design work on the deployment page

`pnpm page-preview` serves [preview/](preview/main.tsx): the deployment page's body
([src/components/deployment-body.tsx](src/components/deployment-body.tsx)) drawn from each moment of
one recorded install, with no backend (`?moment=<index>` shows one alone). It is not a route and
never ships. The moments are [preview/moments.json](preview/moments.json), the live state a browser
got (secrets masked); `pnpm page-preview:record <log.json>` makes them again from a deployment
context's events ([preview/record.ts](preview/record.ts) says how to read them).
