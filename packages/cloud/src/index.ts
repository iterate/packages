// @iterate-com/cloud — Iterate Cloud as a package a project installs (README.md). This entry is the
// facets a project's config re-exports from a top-level module (`cloud.ts`), since a processor row
// names a class of the published config (specs.ts `facetSpecOf`), and what a person's page may call
// on the two it lends them.
export { CloudDeploymentFacet, CloudPersonFacet, CloudToolchainFacet } from "./durable-object.ts";
export type { CloudDeploymentMethods, CloudPersonMethods } from "./durable-object.ts";
