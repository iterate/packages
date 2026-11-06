// cloud/specs.ts — WHERE THE CLOUD'S CONTEXTS ARE, and the facet spec each one's processor is
// enabled from: the classes of the project's published config, whose top-level `cloud.ts`
// re-exports this package (a processor row names a top-level module).
import { DeploymentContract, PersonContract, ToolchainContract } from "./contract.ts";

export const deploymentPathOf = (id: string) => `/deployments/${id}`;
export const TOOLCHAIN_PATH = "/toolchain";

/** The facet spec of one of the package's processors. `consumes` is its contract's: the platform
 *  delivers the processor no other type. */
const facetSpecOf = (className: string, consumes: readonly string[]) => ({
  className,
  mainModule: "cloud.ts",
  source: CONFIG_SOURCE,
  consumes: [...consumes],
});

/** The project's published config, as a facet spec names its source (a path, not a string). */
const CONFIG_SOURCE: ["itx", ["cd", string], "config"] = ["itx", ["cd", "/"], "config"];

// Each processor's name is its contract's slug: a lendee's live state is keyed by the slug, and the
// platform's reader takes the key for the facet's name (core/os context/facet-lends.ts rule 4).
export const PERSON_PROCESSOR = {
  name: PersonContract.slug,
  spec: facetSpecOf("CloudPersonFacet", PersonContract.consumes),
};
export const DEPLOYMENT_PROCESSOR = {
  name: DeploymentContract.slug,
  spec: facetSpecOf("CloudDeploymentFacet", DeploymentContract.consumes),
};
export const TOOLCHAIN_PROCESSOR = {
  name: ToolchainContract.slug,
  spec: facetSpecOf("CloudToolchainFacet", ToolchainContract.consumes),
};
