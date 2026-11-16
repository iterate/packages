import { expect, test } from "vitest";
import { holdNothing, readMindApprovals, titleWithCount } from "./waiting-approvals.ts";

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
  // A shell that asks on a timer with it filled the vault's memory (12 November 2026).
  const mind = fakeMind({
    "/secrets": ["gmail", "deleted-long-ago", "quiet"].map((name) =>
      childCreated(`/secrets/${name}`),
    ),
    "/secrets/gmail": [requested("d1")],
    "/secrets/deleted-long-ago": [used()],
  });
  const answer = await readMindApprovals(mind.read);
  expect(answer).toMatchObject({
    served: true,
    waiting: [{ secret: "/secrets/gmail", digest: "d1" }],
    acts: [],
  });
  expect(mind).toMatchObject({
    calls: ["vault", CATALOG, "read /approvals after 0", "read /secrets/gmail after 0"],
  });
});

test("a mind with 400 secrets and no request ever reads no secret's log, and nothing waits", async () => {
  const logs: Record<string, Event[]> = {};
  for (let secret = 0; secret < 400; secret += 1)
    logs[`/secrets/key-${secret}`] = Array.from({ length: 300 }, () => used());
  const mind = fakeMind(logs);
  const answer = await readMindApprovals(mind.read);
  expect(answer).toMatchObject({ served: true, waiting: [], acts: [], proposed: [] });
  expect(mind).toMatchObject({ calls: ["vault", CATALOG, "read /approvals after 0"] });
});

test("of 400 secrets, only the three that had a request are read, and only what waits is counted", async () => {
  const logs: Record<string, Event[]> = {};
  for (let secret = 0; secret < 400; secret += 1)
    logs[`/secrets/key-${secret}`] = Array.from({ length: 50 }, () => used());
  logs["/secrets/key-7"]?.push(requested("a"));
  logs["/secrets/key-70"]?.push(requested("b"));
  logs["/secrets/key-300"]?.push(requested("c"), approved("c"));
  const mind = fakeMind(logs);
  const answer = await readMindApprovals(mind.read);
  expect(mind.secretsRead().toSorted()).toEqual([
    "/secrets/key-300",
    "/secrets/key-7",
    "/secrets/key-70",
  ]);
  expect(answer.served && answer.waiting.map((request) => request.digest).toSorted()).toEqual([
    "a",
    "b",
  ]);
});

test("of eight secrets with a request, never more than three logs are read at the same time", async () => {
  const logs: Record<string, Event[]> = { "/approvals": [] };
  for (let secret = 0; secret < 8; secret += 1)
    logs[`/secrets/key-${secret}`] = [requested(`d${secret}`)];
  const mind = fakeMind(logs);
  const answer = await readMindApprovals(mind.read);
  expect(mind.secretsRead()).toHaveLength(8);
  expect(answer.served && answer.waiting).toHaveLength(8);
  expect(mind.mostAtOnce()).toBe(3);
});

test("a second ask reads only what is new: from the offset held, and not at all where the catalog counts nothing new", async () => {
  const logs: Record<string, Event[]> = {
    "/approvals": [{ type: "events.iterate.com/itx/child-created", createdAt: at() }],
    "/secrets/still": [used(), requested("s")],
    "/secrets/grows": [requested("g"), used(), used()],
  };
  const mind = fakeMind(logs);
  const held = holdNothing();
  const first = await readMindApprovals(mind.read, held);
  expect(first.served && first.waiting.map((request) => request.digest).toSorted()).toEqual([
    "g",
    "s",
  ]);
  logs["/secrets/grows"]?.push(approved("g"));
  logs["/approvals"]?.push({
    type: "events.iterate.com/approval/act-held",
    payload: { digest: "m1", act: "email.send", summary: "a mail" },
    createdAt: at(),
  });
  mind.calls.length = 0;
  const second = await readMindApprovals(mind.read, held);
  expect(mind.calls.toSorted()).toEqual([
    CATALOG,
    "read /approvals after 1",
    "read /secrets/grows after 3",
    "vault",
  ]);
  // the request of `grows` was approved meanwhile: it waits no more
  expect(second).toMatchObject({
    served: true,
    waiting: [{ secret: "/secrets/still", digest: "s" }],
    acts: [{ digest: "m1" }],
  });
});

test("the answer is what waits and no more: a secret with a rule and no request is not read, and no rule or decision is answered", async () => {
  // the rules and the decisions of a mind are whole only in the log of every secret
  const mind = fakeMind({
    "/secrets/ruled": [
      {
        type: "events.iterate.com/secret/approval-rule-configured",
        payload: { rule: { methods: ["POST"], hosts: ["example.net"] } },
        createdAt: new Date().toISOString(),
      },
      used(),
    ],
    "/secrets/asked": [requested("a"), approved("a")],
  });
  const answer = await readMindApprovals(mind.read);
  expect(mind.secretsRead()).toEqual(["/secrets/asked"]);
  expect(Object.keys(answer).toSorted()).toEqual(["acts", "proposed", "served", "waiting"]);
  expect(answer).toMatchObject({ served: true, waiting: [] });
});

test("a secret's log is held only in what the fold reads: a use that names no request is not kept", async () => {
  const mind = fakeMind({
    "/secrets/busy": [requested("d"), ...Array.from({ length: 2500 }, () => used()), used("d")],
  });
  const held = holdNothing();
  const answer = await readMindApprovals(mind.read, held);
  // three pages of a thousand
  expect(mind.secretsRead()).toHaveLength(3);
  expect(held.secrets.get("/secrets/busy")?.events.map((event) => event.type)).toEqual([
    REQUESTED,
    "events.iterate.com/secret/used",
  ]);
  expect(answer).toMatchObject({ waiting: [] });
});

test("a mind whose catalog cannot be asked: the ask fails, and no log is read at all", async () => {
  // no second way to find the secrets: the other way is to read every secret's whole log
  const logs: Record<string, Event[]> = { "/secrets": [] };
  for (let secret = 0; secret < 8; secret += 1) {
    logs["/secrets"]?.push(childCreated(`/secrets/key-${secret}`));
    logs[`/secrets/key-${secret}`] = secret === 5 ? [requested("five")] : [used()];
  }
  const mind = fakeMind(logs, "none");
  await expect(readMindApprovals(mind.read)).rejects.toThrow("no such method: contexts");
  expect(mind).toMatchObject({ calls: ["vault", CATALOG] });
});

test("a catalog row that does not parse, a path below a secret and a row with no request are not read", async () => {
  const mind = fakeMind(
    {
      "/secrets/real": [requested("r")],
      "/secrets/a/b": [requested("deep")],
      "/secrets/mentions": [used()],
      "/secrets/broken": [requested("broken")],
    },
    [
      { path: "/secrets/real", eventCount: 1, eventTypes: { [REQUESTED]: 1 } },
      { path: "/secrets/a/b", eventCount: 1, eventTypes: { [REQUESTED]: 1 } },
      // its description named the type: the text matched, but no request is in its log
      {
        path: "/secrets/mentions",
        eventCount: 1,
        eventTypes: { "events.iterate.com/secret/used": 1 },
      },
      { path: "/secrets/broken", eventCount: "one" },
    ],
  );
  const answer = await readMindApprovals(mind.read);
  expect(mind.secretsRead()).toEqual(["/secrets/real"]);
  expect(answer).toMatchObject({ waiting: [{ digest: "r" }] });
});

const REQUESTED = "events.iterate.com/secret/approval-requested";
const CATALOG = `catalog /secrets ${REQUESTED} 1000`;

type Event = { type: string; payload?: unknown; createdAt: string };

function at() {
  return new Date().toISOString();
}
function requested(digest: string): Event {
  return {
    type: REQUESTED,
    payload: { digest, method: "POST", url: "https://example.net/send", bodyStart: "{" },
    createdAt: at(),
  };
}
function approved(digest: string): Event {
  return {
    type: "events.iterate.com/secret/request-approved",
    payload: { digests: [digest], signer: { principal: { actor: "member" }, label: "laptop" } },
    createdAt: at(),
  };
}
function used(digest?: string): Event {
  return {
    type: "events.iterate.com/secret/used",
    payload: { status: 200, digest },
    createdAt: at(),
  };
}
function childCreated(childPath: string): Event {
  return { type: "events.iterate.com/itx/child-created", payload: { childPath }, createdAt: at() };
}

/** A mind whose logs are `logs`. Its catalog lists each context under `/secrets` whose path or
 *  types hold the search words, as the kernel's does; `catalog` replaces its rows, and `"none"`
 *  is a mind with no catalog. `calls` is every call the mind got, in order; `mostAtOnce` is the
 *  most logs it was asked to read at the same time. */
function fakeMind(logs: Record<string, Event[]>, catalog?: unknown[] | "none") {
  const calls: string[] = [];
  let reading = 0;
  let mostAtOnce = 0;
  const itx = {
    rewriteRules: {
      get: async () => {
        calls.push("vault");
        return { target: "itx.builtins.secrets" };
      },
    },
    secrets: {
      list: async () => {
        throw new Error("the shell must not list the secrets");
      },
    },
    contexts: {
      list: async (options: { under: string; search: string; limit: number }) => {
        calls.push(`catalog ${options.under} ${options.search} ${options.limit}`);
        if (catalog === "none") throw new Error("no such method: contexts");
        if (catalog) return catalog;
        return Object.entries(logs).flatMap(([path, events]) => {
          const eventTypes: Record<string, number> = {};
          for (const event of events) eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1;
          const text = `${path} ${Object.keys(eventTypes).join(" ")}`;
          return path.startsWith(`${options.under}/`) && text.includes(options.search)
            ? [{ path, eventCount: events.length, eventTypes, recentTypes: [], processors: [] }]
            : [];
        });
      },
    },
    cd: (path: string) => ({
      readEvents: async (after: number, limit: number) => {
        calls.push(`read ${path} after ${after}`);
        reading += 1;
        mostAtOnce = Math.max(mostAtOnce, reading);
        try {
          // a log is read over a few turns, so reads that run at the same time overlap
          await new Promise((resolve) => setTimeout(resolve, 1));
          if (path === "/approvals" && !logs[path]) throw new Error("a mind from before the gate");
          const all = (logs[path] || []).map((event, index) => ({ ...event, offset: index + 1 }));
          const events = all.slice(after, after + limit);
          return {
            events,
            scannedThroughOffset: events.at(-1)?.offset ?? after,
            atHead: after + events.length >= all.length,
          };
        } finally {
          reading -= 1;
        }
      },
      [Symbol.dispose]() {},
    }),
  };
  return {
    calls,
    mostAtOnce: () => mostAtOnce,
    read: ((ask: (root: typeof itx) => unknown) => ask(itx)) as never,
    /** The secrets' logs that were read. */
    secretsRead: () =>
      calls.filter((call) => call.startsWith("read /secrets/")).map((call) => call.split(" ")[1]),
  };
}
