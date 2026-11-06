import { expect, test, vi } from "vitest";
import { ProcessorEngine } from "iterate/stream/processor";
import { memoryStorage, memoryStream } from "iterate/stream/test-support";
import { MASKED, mintConfig } from "./config.ts";
import { DeploymentContract, PersonContract, ToolchainContract } from "./contract.ts";
import { DeploymentProcessor, type DeploymentDeps } from "./deployment.ts";
import type { DeploymentRecord, DeploymentState, RunStep } from "./records.ts";
import { installStepsOf } from "./views.ts";

const record: DeploymentRecord = {
  id: "dep_aaaabbbbccccdddd",
  name: "my-iterate",
  accountId: "11111111111111111111111111111111",
  accountName: "Ada's account",
  connection: "aaaabbbbcccc",
  store: "alchemy-state-store",
  stack: "iterate-my-iterate",
  owner: { sub: "user_aaaabbbbccccddddaaaabbbbccccdddd", email: "ada@example.test" },
  createdAt: "2026-11-06T12:00:00.000Z",
};

test("a creation prepares the sandbox, requests the first deploy itself, and its steps move with the output", async () => {
  const deployment = open({
    prepare: async () => ({ status: "succeeded" }),
    attempt: async (_run, report) => {
      await report([
        printed(
          0,
          "namespace",
          "== deploy my-iterate",
          "== step namespace",
          "created my-iterate-repos",
        ),
        printed(3, "image", "== step image", "the account's registry holds it: no copy"),
        printed(5, "build", "== step build", "built"),
      ]);
      await report([printed(7, "alchemy", "== step alchemy", "Done: 7 succeeded")]);
      await report([printed(9, "check", "== step check", "check: 200")]);
      return { status: "succeeded", url: "https://my-iterate.example.workers.dev" };
    },
  });
  deployment.request();

  await vi.waitFor(async () => expect((await deployment.state()).run?.status).toBe("succeeded"));
  const state = await deployment.state();
  expect(state).toMatchObject({
    url: "https://my-iterate.example.workers.dev",
    preparation: { status: "succeeded", attempt: 1 },
  });
  expect(state.run).toMatchObject({ kind: "deploy", lines: 11 });
  expect(installStepsOf(state).map((step) => [step.id, step.status, step.tail])).toEqual([
    ["sandbox", "succeeded", []],
    ["namespace", "succeeded", ["created my-iterate-repos"]],
    ["image", "succeeded", ["the account's registry holds it: no copy"]],
    ["build", "succeeded", ["built"]],
    ["alchemy", "succeeded", ["Done: 7 succeeded"]],
    ["check", "succeeded", ["check: 200"]],
  ]);
});

test("each hand-off is picked up while the driver is still finishing the step before it", async () => {
  // every append's push lands before the driver's own await returns, so each stage's event reaches
  // processEvent while the driver runs: the drain, not a later delivery, must start the next stage
  let attempts = 0;
  const deployment = open({
    prepare: async () => ({ status: "succeeded" }),
    attempt: async () => {
      attempts++;
      return { status: "succeeded" };
    },
  });
  const append = deployment.log.stream.append;
  deployment.log.stream.append = async (...events) => {
    const committed = await append(...events);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return committed;
  };
  deployment.request();
  await vi.waitFor(async () => expect((await deployment.state()).run?.status).toBe("succeeded"));
  expect(attempts).toBe(1);
  expect(
    deployment.log.events.filter((event) => event.type === "cloud/run-requested"),
  ).toHaveLength(1);
});

test("a run requested while one is open is refused, and says why", async () => {
  let release!: () => void;
  const deployment = open({
    prepare: async () => ({ status: "succeeded" }),
    attempt: () => new Promise((resolve) => (release = () => resolve({ status: "succeeded" }))),
  });
  deployment.request();
  await vi.waitFor(async () => expect((await deployment.state()).run?.attempt).toBe(1));
  deployment.log.stream.append({ type: "cloud/run-requested", payload: { kind: "destroy" } });
  await vi.waitFor(() =>
    expect(
      deployment.log.events.find((event) => event.type === "cloud/run-settled")?.payload,
    ).toMatchObject({
      status: "refused",
      error: expect.stringContaining("A deploy is running"),
    }),
  );
  release();
  await vi.waitFor(async () => expect((await deployment.state()).run?.status).toBe("succeeded"));
});

test("a failed preparation stays failed until the person asks again, then starts its attempts from zero", async () => {
  let fail = true;
  const deployment = open({
    prepare: async () =>
      fail ? { status: "failed", error: "the toolchain has no snapshot" } : { status: "succeeded" },
    attempt: async () => ({ status: "succeeded" }),
  });
  deployment.request();
  await vi.waitFor(async () =>
    expect((await deployment.state()).preparation).toMatchObject({
      status: "failed",
      error: "the toolchain has no snapshot",
    }),
  );
  expect(installStepsOf(await deployment.state())[0]).toMatchObject({
    status: "failed",
    error: "the toolchain has no snapshot",
  });

  fail = false;
  deployment.log.stream.append({ type: "cloud/preparation-requested", payload: {} });
  await vi.waitFor(async () => expect((await deployment.state()).run?.status).toBe("succeeded"));
  expect((await deployment.state()).preparation).toMatchObject({ status: "succeeded", attempt: 1 });
});

test("an attempt after one that died adopts the run, from the line the run reported last", async () => {
  const reported: number[] = [];
  let dies = true;
  const deployment = open({
    prepare: async () => ({ status: "succeeded" }),
    attempt: async (run, report) => {
      reported.push(run.reported);
      if (dies) {
        await report([printed(0, "namespace", "== step namespace", "created")]);
        // the incarnation goes before the attempt answers
        return new Promise(() => {});
      }
      await report([printed(run.reported, "alchemy", "== step alchemy", "Done")]);
      return { status: "succeeded" };
    },
  });
  deployment.request();
  await vi.waitFor(async () => expect((await deployment.state()).run?.lines).toBe(2));
  dies = false;
  deployment.restart();
  await vi.waitFor(async () => expect((await deployment.state()).run?.status).toBe("succeeded"));
  expect(reported).toEqual([0, 2]);
  expect((await deployment.state()).run).toMatchObject({ attempt: 2, lines: 4 });
});

test("the live state masks the config's secrets; the full state keeps them for the runs", async () => {
  const deployment = open({
    prepare: async () => ({ status: "failed", error: "stop here" }),
    attempt: async () => ({ status: "succeeded" }),
  });
  const config = deployment.request();
  await vi.waitFor(async () => expect(await deployment.state()).toMatchObject({ config }));
  const live = (await deployment.engine().liveSnapshot()).state as { config: unknown };
  expect(live.config).toMatchObject({
    adminBearer: MASKED,
    secretsEncryption: { key: MASKED },
    login: { methods: { password: { password: MASKED } } },
  });
  expect(JSON.stringify(live)).not.toContain(config.adminBearer);
  expect(JSON.stringify(live)).not.toContain(config.secretsEncryption.key);
});

test("each processor is delivered every event its contract defines: the facet specs take the contract's list", () => {
  for (const contract of [DeploymentContract, PersonContract, ToolchainContract])
    expect([...contract.consumes].sort()).toEqual(Object.keys(contract.events).sort());
});

/** Text lines `from` on, all of `step`, as runs.ts reports them. */
const printed = (from: number, step: RunStep, ...lines: string[]) =>
  ({ kind: "lines", from, step, lines }) as const;

/** A deployment's log and its processor, as its facet hosts them, with `deps` for the sandbox. */
function open(deps: DeploymentDeps) {
  const log = memoryStream(`/deployments/${record.id}`);
  // the checkpoint outlives an incarnation, as the facet's storage does
  const checkpoints = memoryStorage();
  const start = () => {
    const engine = new ProcessorEngine(new DeploymentProcessor(deps), {
      stream: log.stream,
      storage: checkpoints,
    });
    log.engines.splice(0, log.engines.length, engine);
    return engine;
  };
  let engine = start();
  return {
    log,
    engine: () => engine,
    restart: () => {
      engine = start();
      void engine.catchUpFromLog();
    },
    request() {
      const config = mintConfig(record);
      log.stream.append({ type: "cloud/deployment-requested", payload: { record, config } });
      return config;
    },
    state: async () => (await engine.snapshot()).state as DeploymentState,
  };
}
