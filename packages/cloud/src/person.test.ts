import { expect, test, vi } from "vitest";
import { ProcessorEngine } from "iterate/stream/processor";
import { memoryStorage, memoryStream, reduceProcessor, settle } from "iterate/stream/test-support";
import { PersonProcessor } from "./person.ts";

test("a connect is pending until its settlement, and the live state never carries its nonce", () => {
  const processor = new PersonProcessor();
  const state = reduceProcessor(processor, [
    {
      type: "cloud/person-signed-in",
      payload: { sub: "user_aaaabbbbccccddddaaaabbbbccccdddd", email: "ada@example.test" },
    },
    // the platform the config names, and the one it names after a change: the newer stands
    {
      type: "cloud/platform-configured",
      payload: {
        issuer: "https://os.example",
        cloudflare: { clientId: "old", secret: "/secrets/a" },
      },
    },
    {
      type: "cloud/platform-configured",
      payload: {
        issuer: "https://os.example",
        cloudflare: { clientId: "new", secret: "/secrets/b" },
      },
    },
    { type: "cloud/connection-requested", payload: { connection: "aaaabbbbcccc", nonce: "n-1" } },
    { type: "cloud/connection-requested", payload: { connection: "ddddccccbbbb", nonce: "n-2" } },
    {
      type: "cloud/connection-settled",
      payload: {
        requestOffset: 4,
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
  expect(state).toMatchObject({
    platform: { cloudflare: { clientId: "new", secret: "/secrets/b" } },
  });
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

test("an ask writes the next ask, then the host settles, and only for the pending attempt that stands", async () => {
  let settles = 0;
  const log = memoryStream("/people/user_aaaabbbbccccddddaaaabbbbccccdddd");
  const engine = new ProcessorEngine(new PersonProcessor({ settleX: async () => void settles++ }), {
    stream: log.stream,
    storage: memoryStorage(),
  });
  log.engines.push(engine);
  await log.stream.append(
    { type: "cloud/x-connect-requested", payload: { nonce: "n-1" } },
    { type: "cloud/x-settle-asked", payload: { nonce: "n-1", afterMs: 20_000, waitedMs: 20_000 } },
    // a newer connect replaced the attempt: an ask for the older one is spent
    { type: "cloud/x-connect-requested", payload: { nonce: "n-2" } },
    { type: "cloud/x-settle-asked", payload: { nonce: "n-1", afterMs: 40_000, waitedMs: 60_000 } },
    // settled meanwhile: nothing to ask
    {
      type: "cloud/x-connect-settled",
      payload: { requestOffset: 3, status: "connected", xUserId: "1", username: "ada" },
    },
    { type: "cloud/x-settle-asked", payload: { nonce: "n-2", afterMs: 20_000, waitedMs: 20_000 } },
  );
  await vi.waitFor(() => expect(settles).toBe(1));
  await settle();
  expect(settles).toBe(1);
  const asks = log.events.filter((event) => event.type === "events.iterate.com/itx/schedule-set");
  expect(asks.map((event) => event.payload)).toEqual([
    {
      key: ["x-settle", "n-1"],
      when: { afterMs: 40_000 },
      events: [
        {
          type: "cloud/x-settle-asked",
          payload: { nonce: "n-1", afterMs: 40_000, waitedMs: 60_000 },
        },
      ],
    },
  ]);
  expect((await engine.snapshot()).state.x).toMatchObject({ status: "connected", username: "ada" });
});

test("an ask after two hours of waiting gives the attempt up as failed, and asks no more", async () => {
  let settles = 0;
  const log = memoryStream("/people/user_aaaabbbbccccddddaaaabbbbccccdddd");
  const engine = new ProcessorEngine(new PersonProcessor({ settleX: async () => void settles++ }), {
    stream: log.stream,
    storage: memoryStorage(),
  });
  log.engines.push(engine);
  await log.stream.append(
    { type: "cloud/x-connect-requested", payload: { nonce: "n-1" } },
    {
      type: "cloud/x-settle-asked",
      payload: { nonce: "n-1", afterMs: 600_000, waitedMs: 2 * 60 * 60_000 },
    },
  );
  await vi.waitFor(async () =>
    expect((await engine.snapshot()).state.x).toMatchObject({
      status: "failed",
      error: expect.stringContaining("two hours"),
    }),
  );
  await settle();
  expect(settles).toBe(0);
  expect(log.events.some((event) => event.type === "events.iterate.com/itx/schedule-set")).toBe(
    false,
  );
});
