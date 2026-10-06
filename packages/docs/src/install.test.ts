import { expect, test } from "vitest";
import { DocContract, DocsContract } from "./contract.ts";
import { docsAgentsSection, docsModule, ensureDoc, installDocs } from "./install.ts";

// install.ts spells the processors' consumes itself: the page imports it, and contract.ts pulls in
// iterate/stream/processor, which a browser can't load
test("opening a doc enables each processor on everything its contract consumes", async () => {
  const enabled: Record<string, unknown> = {};
  const context = (path: string): any => ({
    cd: context,
    append: async () => [],
    processors: {
      enable: async (slug: string, row: { consumes: string[] }) => {
        enabled[`${path} ${slug}`] = row.consumes;
      },
    },
  });

  await ensureDoc(context("/"), { repo: "/repos/config", path: "plan.md" });

  expect(enabled).toEqual({
    "/ docs": DocsContract.consumes,
    "/docs/config/plan.md doc": DocContract.consumes,
  });
});

test("installing Docs commits docs.ts, the pin beside the config's other dependencies and the agent guide's pointer, and waits for its publication", async () => {
  const commits: any[] = [];
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "config",
      dependencies: { "@iterate-com/voice": "1.0.0" },
    }),
    "AGENTS.md": "# Config\n\nThe project's own words.\n",
  };
  const project: any = {
    repos: {
      get: () => ({
        tip: async () => "c0",
        readFile: async (path: string) => files[path] || null,
        commitFiles: async (input: any) => {
          commits.push(input);
          return { commitOid: "c1" };
        },
      }),
    },
    waitForEvent: async (input: any) => ({
      type: "events.iterate.com/project/worker-updated",
      payload: input.payload,
      offset: 1,
    }),
  };

  expect(
    await installDocs(project, "https://pkg.pr.new/iterate/private/@iterate-com/docs@abc"),
  ).toBe("c1");
  expect(commits).toMatchObject([
    {
      parent: "c0",
      changes: [
        docsModule,
        {
          path: "package.json",
          content: `${JSON.stringify(
            {
              name: "config",
              dependencies: {
                "@iterate-com/voice": "1.0.0",
                "@iterate-com/docs": "https://pkg.pr.new/iterate/private/@iterate-com/docs@abc",
              },
            },
            null,
            2,
          )}\n`,
        },
        {
          path: "AGENTS.md",
          content: `# Config\n\nThe project's own words.\n\n${docsAgentsSection}`,
        },
      ],
    },
  ]);

  // installed again: the pointer is there already, and stays as it is
  files["AGENTS.md"] = commits[0].changes[2].content;
  await installDocs(project, "https://pkg.pr.new/iterate/private/@iterate-com/docs@def");
  expect(commits[1].changes.map((change: any) => change.path)).toEqual(["docs.ts", "package.json"]);
});

test("a give-up still standing at the deadline ends the install with its reason, after waiting for the outcome of the platform's run again", async () => {
  const waits: any[] = [];
  const project: any = {
    repos: {
      get: () => ({
        tip: async () => "c0",
        readFile: async () => null,
        commitFiles: async () => ({ commitOid: "c1" }),
      }),
    },
    waitForEvent: async (input: any) => {
      waits.push(input);
      // nothing after the give-up before the deadline: the wait times out, as a real one does
      if (waits.length > 1) throw new Error("no event within the deadline");
      return {
        type: "events.iterate.com/project/worker-update-failed",
        payload: {
          commitOid: "c1",
          generation: 35,
          error:
            "the config repo's docs.ts: resolving @iterate-com/docs failed: esm.sh answered 500",
          unavailable: true,
        },
        offset: 39,
      };
    },
  };

  await expect(
    installDocs(project, "https://pkg.pr.new/iterate/private/@iterate-com/docs@abc"),
  ).rejects.toThrow(
    "Docs is committed, but the platform could not publish it for now and publishes it later: the config repo's docs.ts: resolving @iterate-com/docs failed: esm.sh answered 500",
  );
  expect(waits).toMatchObject([
    { payload: { commitOid: "c1" }, afterOffset: 0, timeoutMs: 120_000 },
    { payload: { commitOid: "c1" }, afterOffset: 39 },
  ]);
});

test("installing a pin again after a give-up a later incarnation followed with its publication resolves: the newest outcome is the answer", async () => {
  const log = [
    {
      type: "events.iterate.com/project/worker-update-failed",
      payload: { commitOid: "c0", error: "esm.sh answered 500", unavailable: true },
      offset: 39,
    },
    { type: "events.iterate.com/project/worker-updated", payload: { commitOid: "c0" }, offset: 52 },
  ];
  const project: any = {
    repos: {
      get: () => ({
        tip: async () => "c0",
        readFile: async () => null,
        // the same files as the install that gave up: the same commit
        commitFiles: async () => ({ commitOid: "c0" }),
      }),
    },
    waitForEvent: async (input: any) => {
      const event = log.find((candidate) => candidate.offset > input.afterOffset);
      if (!event) throw new Error(`no event within ${input.timeoutMs}ms`);
      return event;
    },
  };
  await expect(
    installDocs(project, "https://pkg.pr.new/iterate/private/@iterate-com/docs@abc"),
  ).resolves.toBe("c0");
});
