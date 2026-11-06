import { expect, test } from "vitest";
import { reduceProcessor } from "iterate/stream/test-support";
import { PersonProcessor } from "./person.ts";

test("a connect is pending until its settlement, and the live state never carries its nonce", () => {
  const processor = new PersonProcessor();
  const state = reduceProcessor(processor, [
    {
      type: "cloud/person-signed-in",
      payload: { sub: "user_aaaabbbbccccddddaaaabbbbccccdddd", email: "ada@example.test" },
    },
    { type: "cloud/connection-requested", payload: { connection: "aaaabbbbcccc", nonce: "n-1" } },
    { type: "cloud/connection-requested", payload: { connection: "ddddccccbbbb", nonce: "n-2" } },
    {
      type: "cloud/connection-settled",
      payload: {
        requestOffset: 2,
        connection: "aaaabbbbcccc",
        status: "connected",
        cloudflareUser: "ada@example.test",
        accounts: [{ id: "11111111111111111111111111111111", name: "Ada" }],
        scopes: ["workers-scripts.write"],
      },
    },
    // a settlement for another request of the same connection is not this one's
    {
      type: "cloud/connection-settled",
      payload: { requestOffset: 9, connection: "ddddccccbbbb", status: "failed", error: "x" },
    },
  ]);
  expect(state.connections.map((connection) => [connection.id, connection.status])).toEqual([
    ["aaaabbbbcccc", "connected"],
    ["ddddccccbbbb", "pending"],
  ]);
  expect(JSON.stringify(processor.projectLiveState(state))).not.toMatch(/n-1|n-2|nonce/);
});

test("of two creations of one name in one account, the first the log lists stands", () => {
  const record = {
    id: "dep_aaaabbbbccccdddd",
    name: "my-iterate",
    accountId: "11111111111111111111111111111111",
    accountName: "Ada",
    connection: "aaaabbbbcccc",
    store: "alchemy-state-store",
    stack: "iterate-my-iterate",
    owner: { sub: "user_aaaabbbbccccddddaaaabbbbccccdddd", email: "ada@example.test" },
    createdAt: "2026-11-06T12:00:00.000Z",
  };
  const state = reduceProcessor(new PersonProcessor(), [
    { type: "cloud/deployment-added", payload: record },
    { type: "cloud/deployment-added", payload: { ...record, id: "dep_ddddccccbbbbaaaa" } },
    // the same name in another account is another deployment
    {
      type: "cloud/deployment-added",
      payload: {
        ...record,
        id: "dep_aaaaddddbbbbcccc",
        accountId: "22222222222222222222222222222222",
      },
    },
  ]);
  expect(state.deployments.map((known) => known.id)).toEqual([
    "dep_aaaabbbbccccdddd",
    "dep_aaaaddddbbbbcccc",
  ]);
});

test("a person whose email changed at the platform is recorded again, and the newer email stands", () => {
  const sub = "user_aaaabbbbccccddddaaaabbbbccccdddd";
  const state = reduceProcessor(new PersonProcessor(), [
    { type: "cloud/person-signed-in", payload: { sub, email: "ada@example.test" } },
    { type: "cloud/person-signed-in", payload: { sub, email: "ada.lovelace@example.test" } },
  ]);
  expect(state).toMatchObject({ sub, email: "ada.lovelace@example.test" });
});
