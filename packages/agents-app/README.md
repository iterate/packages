# Agents

Agents is an optional app. The mind Worker (`core/mind-worker`) supplies contexts, streams, workers, facets, model access
and storage; the agents runtime is `iterate/agents` (core/lib/src/agents: the catalog, lifecycle
and model loop), which the platform ships, and voice is `@iterate-com/voice` (packages/voice),
which runs on it. `itx.agents` is a durable rewrite to the installed collection
facet, not a platform built-in. This folder is the web app and the tests that drive both packages.

- `src/` — the web app: chat, attachments, live state, events and traces.
- `scripts/` — the voice call and device tools.
- Its tests are those of `iterate/agents` (`core/lib/src/agents/*.test.ts`); this folder has none.

A mind's config repo installs the app ([core/lib/src/agents/README.md](https://github.com/iterate/core/blob/main/core/lib/src/agents/README.md#install);
core/configs/default does). This app installs nothing: on a mind without `itx.agents` it says so
and links to the config repo. `itx.agents.create(path)` installs an agent at that context;
`get(path).message(text)` sends a message. The mind owns its data.

The sidebar reads the catalog on `/agents`, which lists every context under `/agents`: an agent is
any of them, iterate's own or not ([what an agent is](https://github.com/iterate/core/blob/main/core/lib/src/agents/README.md#what-an-agent-is)).
It lists the agents at the top (no `parent`; a row that only holds others, like `/agents/web`, is a
folder and is skipped), each with an icon for its `kind` and a dot for its `status`. An agent
iterate does not run opens on its Events tab.

The collection delegates capabilities to each agent: `itx ⇒ itx.cd(<creator>)` and `itx.agents` at
the agent's own path, written into its context at birth. The agent's scripts run in that same
context, so the loop and its scripts share one table, and an agent holds its creator's reach. A
script's `itx.agents.create('./b')` births `/agents/a/b`, linked to `/agents/a`, so a child never
holds more than its creator. An agent's scripts are not narrowed separately from its loop: the loop
reaches `itx.ai`, `itx.files` and its own log through the same rows.

The agents upgrade with the platform: a deploy restarts them on their next call, with their grants
and history kept. A mind whose config still pins the retired npm package `@iterate-com/agents`
keeps running that build until its `agents.ts` re-exports `iterate/agents` instead.

See [packages/voice/README.md](../../packages/voice/README.md) for voice setup. Run voice tools from this package:
`pnpm voice:call`, `pnpm voice:board`. Kit’s Prepare device flow installs voice.

Dev: `pnpm dev`. The app signs in at the mind its URL names (`/minds/<address>`), at that mind's
own issuer; `/connect` points it at a mind. The prd deploy is
`doppler run --project agents --config prd -- pnpm run deploy --env prd`; its CI workflow
(`.depot/workflows/deploy-agents.yml`) is off, so agents.iterate.com keeps the build that serves
os.iterate.com's minds. Deploy on its own, as `iterate-app-agents` on its `workers.dev` address:
`CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… pnpm deploy:standalone` (`scripts/standalone.ts`
says how to destroy it).
