import { expect, test } from "vitest";
import { readMindApprovals, titleWithCount } from "./waiting-approvals.ts";

test("the tab's title carries the count of what waits, once, and loses it at zero", () => {
  expect(titleWithCount("Approvals · example.com · Dash", 2)).toBe(
    "(2) Approvals · example.com · Dash",
  );
  // the router wrote a new title, or the count changed: one count, never two
  expect(titleWithCount("(2) Secrets · example.com · Dash", 3)).toBe(
    "(3) Secrets · example.com · Dash",
  );
  expect(titleWithCount("(3) Secrets · example.com · Dash", 0)).toBe(
    "Secrets · example.com · Dash",
  );
  expect(titleWithCount("example.com · Dash", 0)).toBe("example.com · Dash");
});

test("what waits is read from the mind's own logs: the vault is asked for no secret, however many there are", async () => {
  // `itx.secrets.list()` describes every secret path ever made, one call into the vault each.
  // A shell that asks on a timer with it filled the vault's memory (jispwoso.com, 12 November).
  const asked: string[] = [];
  const logs: Record<string, { type: string; payload?: unknown; createdAt: string }[]> = {
    "/secrets": [
      ...["gmail", "deleted-long-ago", "quiet"].map((name) => ({
        type: "events.iterate.com/itx/child-created",
        payload: { childPath: `/secrets/${name}` },
        createdAt: new Date().toISOString(),
      })),
      // not a secret's own path: no log of it is read
      {
        type: "events.iterate.com/itx/child-created",
        payload: { childPath: "/secrets/gmail/deeper" },
        createdAt: new Date().toISOString(),
      },
    ],
    "/secrets/gmail": [
      {
        type: "events.iterate.com/secret/approval-requested",
        payload: { digest: "d1", method: "POST", url: "https://example.net/send", bodyStart: "{" },
        createdAt: new Date().toISOString(),
      },
    ],
  };
  const itx = {
    rewriteRules: { get: async () => ({ target: "itx.builtins.secrets" }) },
    secrets: {
      list: async () => {
        throw new Error("the shell must not list the secrets");
      },
    },
    cd: (path: string) => ({
      readEvents: async () => {
        asked.push(path);
        if (path === "/approvals") throw new Error("a mind from before the gate");
        const events = (logs[path] || []).map((event, index) => ({ ...event, offset: index + 1 }));
        return { events, scannedThroughOffset: events.length, atHead: true };
      },
      [Symbol.dispose]() {},
    }),
  };
  const answer = await readMindApprovals(((ask: (root: typeof itx) => unknown) =>
    ask(itx)) as never);
  expect(answer).toMatchObject({
    served: true,
    waiting: [{ secret: "/secrets/gmail", digest: "d1" }],
    acts: [],
  });
  expect(asked.toSorted()).toEqual([
    "/approvals",
    "/secrets",
    "/secrets/deleted-long-ago",
    "/secrets/gmail",
    "/secrets/quiet",
  ]);
});
