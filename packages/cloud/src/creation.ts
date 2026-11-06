// cloud/creation.ts — A DEPLOYMENT'S CREATION, as the person's facet runs it (durable-object.ts
// `createDeployment`, `finishCreation`), in an order that leaves the person's page able to reach
// the deployment at every point it can stop:
//
//   1. the deployment's processor, and its facet lent to the owner (`reachDeployment`);
//   2. the person's listing, `cloud/deployment-added`;
//   3. the deployment's own request, with the config minted for it (`requestCreation`).
//
// Each step is idempotent. A creation that stops after 2 is listed and reachable, its state with
// no record yet, and its page offers Start again, which runs 1 and 3 again (`finishCreation`).
import type { IterateContextApi } from "iterate/api";
import { mintConfig } from "./config.ts";
import { errorCodeOf, type DeploymentRecord } from "./records.ts";
import { DEPLOYMENT_PROCESSOR, deploymentPathOf } from "./specs.ts";

/** What a creation calls of the person's context: its own log, and the deployment's context. */
export type CreationScope = Pick<IterateContextApi, "append" | "cd">;

/** Steps 1 to 3 for a new deployment. `listed` reads the person's state once it has processed the
 *  listing, at its offset: of two creations of one name that overlap, the log lists only the first
 *  (person.ts), and the other stops there. */
export async function createDeployment(
  itx: CreationScope,
  record: DeploymentRecord,
  issuer: string,
  listed: (offset: number) => Promise<boolean>,
) {
  await reachDeployment(itx, record);
  const [added] = await itx.append({
    type: "cloud/deployment-added",
    idempotencyKey: `deployment-added:${record.id}`,
    payload: record,
  });
  if (!(await listed(added!.offset)))
    throw refused(`You already have a deployment named ${record.name} in ${record.accountName}.`);
  await requestCreation(itx, record, issuer);
}

/** Steps 1 and 3 again, for a creation that stopped between them. */
export async function finishCreation(itx: CreationScope, record: DeploymentRecord, issuer: string) {
  await reachDeployment(itx, record);
  await requestCreation(itx, record, issuer);
}

/** The deployment's processor, and its facet lent to its owner: what the person's page reads. */
export async function reachDeployment(itx: CreationScope, record: DeploymentRecord) {
  const context = itx.cd(deploymentPathOf(record.id));
  await context.processors.enable(DEPLOYMENT_PROCESSOR.name, DEPLOYMENT_PROCESSOR.spec);
  await context.facets.lend(DEPLOYMENT_PROCESSOR.name, { to: record.owner.sub });
}

/** The deployment's request, with a config whose owner signs in through `issuer`, keyed on its id: once one landed, a later one, whose config is
 *  another, is refused as a conflict, and the config that landed stays the only one. */
async function requestCreation(itx: CreationScope, record: DeploymentRecord, issuer: string) {
  await itx
    .cd(deploymentPathOf(record.id))
    .append({
      type: "cloud/deployment-requested",
      idempotencyKey: `deployment-requested:${record.id}`,
      payload: { record, config: mintConfig(record, issuer) },
    })
    .catch((error: unknown) => {
      if (errorCodeOf(error) !== "IDEMPOTENCY_CONFLICT") throw error;
    });
}

/** A refusal the page shows as it stands: an expected outcome, coded like the platform's. */
export const refused = (message: string) =>
  Object.assign(new Error(message), { code: "INVALID_INPUT" });
