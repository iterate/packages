import { expect, test, vi } from "vitest";
import { githubSyncFolder, installGithubSync, linkThroughCloud } from "./install.ts";

const version = "https://pkg.pr.new/iterate/private/@iterate-com/github-sync@abc1234";
const origin =
  'https://x-access-token:getSecret("/secrets/github-c1", { field: "accessToken" })@github.com/Acme/config.git';

test("the sync's folder names its main module in package.json", () => {
  const folder = githubSyncFolder(version);
  expect(JSON.parse(folder["package.json"]!)).toEqual({
    main: "index.ts",
    dependencies: { "@iterate-com/github-sync": version },
  });
  expect(folder["index.ts"]).toContain("GithubSyncDurableObject");
});

test("the sync mounts on the connection to the origin's owner and on the root, each with its marker", async () => {
  const root = project({ origin });
  expect(await installGithubSync(root, githubSyncFolder(version))).toEqual({
    repo: "/repos/config",
    repository: "Acme/config",
    log: "/integrations/github/c1",
  });
  const connection = root.contexts["/integrations/github/c1"]!;
  expect(connection).toMatchObject({
    appended: [
      {
        type: "events.iterate.com/itx/rewrite-rule-configured",
        payload: { match: "itx.repos", target: "itx.builtins.cd('/').repos" },
      },
      {
        type: "events.iterate.com/itx/rewrite-rule-configured",
        payload: { match: "itx.fetch", target: "itx.builtins.cd('/').fetch" },
      },
      { type: "github-sync/installed", payload: { repo: "/repos/config" } },
    ],
  });
  expect(connection.processors.enable).toHaveBeenCalledWith("github-sync", {
    source: githubSyncFolder(version),
    className: "GithubSyncDurableObject",
    consumes: [
      "events.iterate.com/github/webhook-received",
      "github/delivery-received",
      "github-sync/installed",
    ],
  });
  expect(root.processors.enable).toHaveBeenCalledWith("github-sync", {
    source: githubSyncFolder(version),
    className: "GithubSyncDurableObject",
    consumes: ["events.iterate.com/repo/commit-completed", "github-sync/installed"],
  });
  expect(root).toMatchObject({
    appended: [{ type: "github-sync/installed", payload: { repo: "/repos/config" } }],
  });
});

test("another repo, and a connection named by the install", async () => {
  const root = project({ origin });
  await installGithubSync(root, githubSyncFolder(version), {
    repo: "/repos/site",
    connection: "c9",
  });
  expect(root).toMatchObject({ originsRead: ["/repos/site"] });
  expect(root.contexts["/integrations/github/c9"]!.appended.at(-1)).toEqual({
    type: "github-sync/installed",
    payload: { repo: "/repos/site" },
  });
});

test("a package's log named by the install: the sync mounts there, and no connection is looked up", async () => {
  const root = project({ origin, connections: [] });
  expect(
    await installGithubSync(root, githubSyncFolder(version), {
      log: "/integrations/own-github/4242",
    }),
  ).toEqual({
    repo: "/repos/config",
    repository: "Acme/config",
    log: "/integrations/own-github/4242",
  });
  expect(root.contexts["/integrations/own-github/4242"]!.appended.at(-1)).toEqual({
    type: "github-sync/installed",
    payload: { repo: "/repos/config" },
  });
  await expect(
    installGithubSync(root, githubSyncFolder(version), { log: "/repos/config" }),
  ).rejects.toThrow(/log is a stream under \/integrations/);
});

test.for([
  ["a repo with no origin", { origin: null }, /has no GitHub origin: link it/],
  [
    "an origin on another host",
    { origin: "https://gitlab.com/acme/config.git" },
    /has no GitHub origin/,
  ],
  [
    "no connection to the owner",
    { origin, connections: [] },
    /expected one GitHub connection to Acme, found 0/,
  ],
  [
    "two connections to the owner",
    { origin, connections: ["c1", "c2"] },
    /expected one GitHub connection to Acme, found 2: name one with \{ connection \}/,
  ],
] as const)("%s is refused, and nothing is installed", async ([, input, error]) => {
  const root = project(input);
  await expect(installGithubSync(root, githubSyncFolder(version))).rejects.toThrow(error);
  expect(root.processors.enable).not.toHaveBeenCalled();
  expect(Object.keys(root.contexts)).toEqual([]);
});

test("a repo links to its GitHub repository through iterate Cloud's App: the installation's secret, the origin, and the log", async () => {
  const set = vi.fn().mockResolvedValue({});
  const setOrigin = vi.fn().mockResolvedValue({});
  const asked: Request[] = [];
  const itx = {
    fetch: async (request: Request) => {
      asked.push(request);
      return Response.json({
        installations: [
          { id: 7, account: { login: "someone-else" } },
          { id: 42, account: { login: "Acme" } },
        ],
      });
    },
    secrets: { set },
    repos: { get: () => ({ setOrigin }) },
  } as unknown as Parameters<typeof linkThroughCloud>[0];
  expect(await linkThroughCloud(itx, { repository: "acme/config" })).toEqual({
    repo: "/repos/config",
    repository: "acme/config",
    installationId: "42",
    secret: "/secrets/github-installation-42",
    log: "/integrations/github/42",
  });
  // the person's own token finds the installation; it never leaves a placeholder
  expect(asked[0]!.headers.get("authorization")).toBe(
    'Bearer getSecret("/secrets/github", { field: "accessToken" })',
  );
  // the installation's token is the Cloud's to mint: the secret holds no key
  expect(set).toHaveBeenCalledWith(
    "/secrets/github-installation-42",
    {},
    {
      urls: ["https://api.github.com", "https://github.com"],
      refresh: {
        kind: "github-app-installation",
        apiOrigin: "https://api.github.com",
        installationId: "42",
        client: { cloud: "github" },
      },
    },
  );
  expect(setOrigin).toHaveBeenCalledWith(
    'https://x-access-token:getSecret("/secrets/github-installation-42", { field: "accessToken" })@github.com/acme/config.git',
  );
  await expect(linkThroughCloud(itx, { repository: "nobody/config" })).rejects.toThrow(
    /the App is not installed on nobody/,
  );
});

/** A project root as installing calls it: its repo's origin, its GitHub connections (to `acme` by
 *  default one, `c1`), and each context `cd` reaches, recording what is appended and enabled. */
function project(input: { origin: string | null; connections?: readonly string[] }) {
  const contexts: Record<string, ReturnType<typeof context>> = {};
  const originsRead: string[] = [];
  const integrations = Object.fromEntries(
    (input.connections || ["c1"]).map((connection) => [
      `/integrations/github/${connection}`,
      { provider: "github", connection, account: "acme" },
    ]),
  );
  const root = {
    ...context(),
    contexts,
    originsRead,
    whoami: vi.fn().mockResolvedValue({ path: "/" }),
    cd: (path: string) => (contexts[path] ??= context()),
    facets: { get: () => ({ snapshot: async () => ({ state: { integrations } }) }) },
    repos: {
      get: (path: string) => ({
        origin: async () => {
          originsRead.push(path);
          return input.origin;
        },
      }),
    },
  };
  // The fake implements only the calls installing makes; typed once as what installGithubSync
  // takes, it keeps its records for the assertions.
  return root as typeof root & Parameters<typeof installGithubSync>[0];
}

function context() {
  const appended: unknown[] = [];
  return {
    appended,
    append: vi.fn(async (...events: unknown[]) => {
      appended.push(...events);
      return [];
    }),
    rewriteRules: { get: vi.fn().mockResolvedValue(null) },
    processors: { enable: vi.fn().mockResolvedValue({ name: "github-sync" }) },
  };
}
