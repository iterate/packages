import { expect, test } from "vitest";
import { createDeployment, finishCreation, type CreationScope } from "./creation.ts";
import type { DeploymentRecord } from "./records.ts";

const PLATFORM = { issuer: "https://os.example", dash: null };
const record: DeploymentRecord = {
  id: "dep_aaaabbbbccccdddd",
  name: "my-iterate",
  accountId: "11111111111111111111111111111111",
  accountName: "Ada",
  connection: "aaaabbbbcccc",
  store: "alchemy-state-store",
  stack: "iterate-my-iterate",
  owner: { sub: "user_aaaabbbbccccddddaaaabbbbccccdddd", email: "ada@example.test" },
  createdAt: "2026-11-06T00:00:00.000Z",
  project: null,
  domain: null,
};

test("a creation makes the deployment reachable before it lists it, and requests it last; a creation that stops after the listing is finished the same way", async () => {
  const { itx, calls } = recording();
  await createDeployment(itx, record, PLATFORM, async () => true);
  expect(calls).toEqual([
    "/deployments/dep_aaaabbbbccccdddd enable cloud-deployment",
    "/deployments/dep_aaaabbbbccccdddd lend cloud-deployment to user_aaaabbbbccccddddaaaabbbbccccdddd",
    "/people append cloud/deployment-added",
    "/deployments/dep_aaaabbbbccccdddd append cloud/deployment-requested",
  ]);

  // the log listed another creation of the name first: this one stops at the listing, reachable
  const refused = recording();
  await expect(
    createDeployment(refused.itx, record, PLATFORM, async () => false),
  ).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  expect(refused.calls.at(-1)).toBe("/people append cloud/deployment-added");

  const finished = recording();
  await finishCreation(finished.itx, record, PLATFORM);
  expect(finished).toMatchObject({
    calls: [
      "/deployments/dep_aaaabbbbccccdddd enable cloud-deployment",
      "/deployments/dep_aaaabbbbccccdddd lend cloud-deployment to user_aaaabbbbccccddddaaaabbbbccccdddd",
      "/deployments/dep_aaaabbbbccccdddd append cloud/deployment-requested",
    ],
  });
});

/** A person's context that records what a creation asks of it, in order. */
function recording() {
  const calls: string[] = [];
  const contextAt = (path: string) => ({
    append: async (...events: { type: string }[]) => {
      calls.push(...events.map((event) => `${path} append ${event.type}`));
      return events.map((event, index) => ({ ...event, offset: calls.length + index }));
    },
    processors: { enable: async (name: string) => void calls.push(`${path} enable ${name}`) },
    facets: {
      lend: async (name: string, { to }: { to: string }) =>
        void calls.push(`${path} lend ${name} to ${to}`),
    },
  });
  const person = { ...contextAt("/people"), cd: contextAt };
  // safe: a creation calls only what this records (creation.ts); the scope's full type is the
  // platform's whole context API
  return { itx: person as unknown as CreationScope, calls };
}
