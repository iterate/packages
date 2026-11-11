// github-sync/install.ts — how a project installs the sync: from a folder of its config repo that
// pins this package (`githubSyncFolder`), as voice installs (@iterate-com/voice/install).
// `installGithubSync` mounts it on the two logs whose events trigger it, which only a session may do
// (README.md). Nothing here is the runtime.
import type { IterateContextApi } from "iterate/api";
import { githubRepositoryOf } from "./github-repository.ts";

/** The source a project installs the sync from, by file: `version` is what package.json pins (a
 *  pkg.pr.new URL, or an npm range once the package is on npm). */
export function githubSyncFolder(version: string): Record<string, string> {
  return {
    "package.json": `${JSON.stringify({ main: "index.ts", dependencies: { "@iterate-com/github-sync": version } }, null, 2)}\n`,
    "index.ts": 'export { GithubSyncDurableObject } from "@iterate-com/github-sync";\n',
  };
}

/** Mount the sync from its source (`githubSyncFolder`, as `repo.modules({ dir })` answers it) for
 *  `repo` (default `/repos/config`), whose origin must be its GitHub repository (the Dash's Config
 *  repo links it), on the log the pushes arrive on: `log`, a package's stream (iterategrations
 *  github/ records the project's own App's deliveries on `/integrations/own-github/<installation
 *  id>`), or else the log of `connection`, by default the project's one GitHub connection to the
 *  repository's owner. Installing the same source again changes nothing but a new marker; a new
 *  source is an upgrade. */
export async function installGithubSync(
  itx: Pick<IterateContextApi, "whoami" | "append" | "cd" | "facets" | "repos" | "processors">,
  source: Record<string, string>,
  options: { repo?: string; connection?: string; log?: string } = {},
): Promise<{ repo: string; repository: string; log: string }> {
  const { path } = await itx.whoami();
  if (path !== "/") throw new Error("Install the GitHub sync at the project root");
  const repo = options.repo || "/repos/config";
  const repository = githubRepositoryOf(await itx.repos.get(repo).origin());
  if (!repository)
    throw new Error(
      `${repo} has no GitHub origin: link it to its repository first (the Dash's Config repo)`,
    );
  const owner = repository.split("/")[0]!;
  const logPath =
    options.log ||
    `/integrations/github/${options.connection || (await githubConnectionTo(itx, owner))}`;
  if (!/^\/integrations\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(logPath))
    throw new Error(`log is a stream under /integrations, got ${JSON.stringify(logPath)}`);
  const log = itx.cd(logPath);
  // The connection's log reaches only itself: these rows lend it the root's repos, where `repo` is,
  // and the root's egress, which a pull's git exchange goes through (the connection's token is a
  // root secret).
  for (const root of ["repos", "fetch"]) {
    const match = `itx.${root}`;
    const target = `itx.builtins.cd('/').${root}`;
    if ((await log.rewriteRules.get(match))?.target !== target)
      await log.append({
        type: "events.iterate.com/itx/rewrite-rule-configured",
        payload: { match, target },
      });
  }
  const spec = { source, className: "GithubSyncDurableObject" };
  await log.processors.enable("github-sync", {
    ...spec,
    consumes: [
      "events.iterate.com/github/webhook-received",
      "github/delivery-received",
      "github-sync/installed",
    ],
  });
  await itx.processors.enable("github-sync", {
    ...spec,
    consumes: ["events.iterate.com/repo/commit-completed", "github-sync/installed"],
  });
  // What each syncs starts here: the logs' history before the markers is never synced.
  const installed = { type: "github-sync/installed", payload: { repo } };
  await Promise.all([log.append(installed), itx.append(installed)]);
  return { repo, repository, log: logPath };
}

/** LINK `repo` TO A GITHUB REPOSITORY THROUGH ITERATE CLOUD'S APP (internal-packages/cloud-clients): the
 *  App is iterate's and its key stays at the Cloud, which mints the installation's token for a
 *  project that connected the installation. `connection` is the secret a member connected with
 *  `itx.secrets.beginOAuth(path, { client: { cloud: client, accounts: [<the repository's owner>] } })`
 *  (or with `install: true`, where the App is not installed there yet), by default
 *  `/secrets/<client>`. This finds the App's installation on the repository's owner, makes that
 *  installation's token a secret of its own, and sets the repo's origin to use it. The Cloud
 *  delivers the installation's pushes on the `log` this answers: pass it to `installGithubSync`.
 *  `api` and `host` are GitHub's, unless a test says otherwise. */
export async function linkThroughCloud(
  itx: Pick<IterateContextApi, "fetch" | "secrets" | "repos">,
  options: {
    repository: string;
    repo?: string;
    client?: string;
    connection?: string;
    api?: string;
    host?: string;
  },
): Promise<{
  repo: string;
  repository: string;
  installationId: string;
  secret: string;
  log: string;
}> {
  const { repository, repo = "/repos/config", client = "github" } = options;
  const { connection = `/secrets/${client}`, api = "https://api.github.com" } = options;
  const { host = "https://github.com" } = options;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error(`repository is owner/name, got ${JSON.stringify(repository)}`);
  const owner = repository.split("/")[0]!.toLowerCase();
  // the installations the person who connected administers, asked of GitHub with their token
  const answer = await itx.fetch(
    new Request(`${api}/user/installations?per_page=100`, {
      headers: {
        authorization: `Bearer getSecret("${connection}", { field: "accessToken" })`,
        accept: "application/vnd.github+json",
        "user-agent": "iterate",
      },
    }),
  );
  if (!answer.ok)
    throw new Error(`GitHub answered ${answer.status} for ${connection}: connect it first`);
  const { installations = [] } = (await answer.json()) as {
    installations?: { id: number; account?: { login?: string } }[];
  };
  const installation = installations.find((each) => each.account?.login?.toLowerCase() === owner);
  if (!installation)
    throw new Error(`the App is not installed on ${owner}: install it there, then connect again`);
  const installationId = String(installation.id);
  const secret = `/secrets/${client}-installation-${installationId}`;
  await itx.secrets.set(
    secret,
    {},
    {
      urls: [api, host],
      refresh: {
        kind: "github-app-installation",
        apiOrigin: api,
        installationId,
        client: { cloud: client },
      },
    },
  );
  await itx.repos
    .get(repo)
    .setOrigin(
      `${host.replace("://", `://x-access-token:getSecret("${secret}", { field: "accessToken" })@`)}/${repository}.git`,
    );
  return {
    repo,
    repository,
    installationId,
    secret,
    log: `/integrations/${client}/${installationId}`,
  };
}

/** The project's connections, as its root's `project` facet records them (core/os
 *  src/integrations/contract.ts `IntegrationConnectionRow`). */
type ProjectIntegrations = {
  snapshot(): Promise<{
    state: {
      integrations: Record<string, { provider: string; connection: string; account: string }>;
    };
  }>;
};

/** The project's one GitHub connection to `owner` (a login's case does not matter to GitHub). */
async function githubConnectionTo(itx: Pick<IterateContextApi, "facets">, owner: string) {
  const { state } = await itx.facets.get<ProjectIntegrations>("project").snapshot();
  const rows = Object.values(state.integrations).filter(
    (row) => row.provider === "github" && row.account.toLowerCase() === owner.toLowerCase(),
  );
  if (rows.length !== 1)
    throw new Error(
      `expected one GitHub connection to ${owner}, found ${rows.length}: name one with { connection }`,
    );
  return rows[0]!.connection;
}
