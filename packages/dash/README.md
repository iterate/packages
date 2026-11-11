# Dash

The app a person uses to see and change what one project holds. A person points it at a project
by its address (`/connect`, the standard page of `@iterate-com/ui`), and may be connected to
several, each with its own sign-in at that project's issuer (`iterate/app-server`). `/` goes to the
project used last.

Every page is about one project, at `/projects/<address>/…`, and reads the project's root context
`itx` through the app's gate (`createIterateClient({ project })`):

- the overview: the project's creation while it runs, its site, and its config repo's git remote;
- contexts: any context's log, live, beside the project's context tree;
- repos: the list, and `/repos/<name>`, the `RepoIde` of `@iterate-com/ui`;
- analytics (`itx.telemetry`), secrets (`itx.secrets`) and integrations (what the project's
  packages register on `/integrations`): each says so in one line while the project does not serve
  its root (`src/lib/served.ts`);
- MCP: how to connect a coding agent to the project's MCP server.

The app holds no credentials and no state of its own beyond the gate's browser sessions.

Local dev: `pnpm dev` (Vite, with the Cloudflare plugin's local workerd). The sidebar links to the
other first-party apps the worker's `ITERATE_APP` `urls` names (`src/apps.ts`,
`@iterate-com/shared/start-app-config`); a standalone Dash names none and links to none.

Deploy on its own, into the account the environment's credentials reach, as `iterate-app-dash` on
its `workers.dev` address (`scripts/standalone.ts` says how to destroy it):

```sh
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… pnpm --dir packages/dash deploy:standalone
```
