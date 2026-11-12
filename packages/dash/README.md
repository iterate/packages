# Dash

The app a person uses to see and change what one mind holds. A person points it at a mind
by its address (`/connect`, the standard page of `@iterate-com/ui`), and may be connected to
several, each with its own sign-in at that mind's issuer (`iterate/app-server`). `/` goes to the
mind used last.

Every page is about one mind, at `/minds/<address>/…`, and reads the mind's root context
`itx` through the app's gate (`createIterateClient({ mind })`):

- the overview: the mind's creation while it runs, its site, and its config repo's git remote;
- contexts: any context's log, live, beside the mind's context tree;
- repos: the list, and `/repos/<name>`, the `RepoIde` of `@iterate-com/ui`;
- approvals: the requests that wait for a member's signed yes, each linked to the platform's
  `/secrets/approvals` page, where the member signs with a passkey;
- analytics (`itx.telemetry`), secrets (`itx.secrets`) and integrations (what the mind's
  packages register on `/integrations`): each says so in one line while the mind does not serve
  its root (`src/lib/served.ts`);
- MCP: how to connect a coding agent to the mind's MCP server.

The app holds no credentials and no state of its own beyond the gate's browser sessions.

Local dev: `pnpm dev` (Vite, with the Cloudflare plugin's local workerd). The sidebar links to the
other first-party apps the worker's `ITERATE_APP` `urls` names (`src/apps.ts`,
`@iterate-com/shared/start-app-config`); a standalone Dash names none and links to none.

Deploy on its own, into the account the environment's credentials reach, as `iterate-app-dash` on
its `workers.dev` address (`scripts/standalone.ts` says how to destroy it):

```sh
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… pnpm --dir packages/dash deploy:standalone
```

The prd deploy's CI workflow (`.depot/workflows/deploy-dash.yml`) is off, so dash.iterate.com keeps
the build that serves os.iterate.com's minds.
