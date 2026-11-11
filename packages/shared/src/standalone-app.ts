// standalone-app.ts — A FIRST-PARTY APP AS A WORKER OF ITS OWN, hosted apart from any mind
// (tasks/project-stack.md, "Headless Workers"): no envs.ts entry, no Doppler, no issuer, no default
// mind and no PostHog. A person opens it, types a mind's address, and signs in there. Each
// app's `scripts/standalone.ts` runs `runStandaloneDeploy`, and its `vite.config.ts` builds
// `standaloneWorkerConfig` when `ITERATE_STANDALONE_WORKER` names the Worker. The Worker is on
// `https://<worker-name>.<account subdomain>.workers.dev`, its only hostname, and binds the gate's
// `BrowserSession` class and the assets, nothing else. The deploy is wrangler's, over the config
// the build snapshots into dist/server/wrangler.json, into the account `CLOUDFLARE_ACCOUNT_ID` and
// `CLOUDFLARE_API_TOKEN` name. Node only: the app's build scripts import it, never its Worker.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COMPATIBILITY_DATE } from "iterate/compatibility-date";

/** The environment variable that makes an app's `vite.config.ts` build the standalone Worker. */
export const STANDALONE_WORKER_ENV = "ITERATE_STANDALONE_WORKER";

/** The Worker config the Cloudflare Vite plugin takes (`cloudflare({ config })`) for the app at
 *  `appRoot` (its directory, `new URL("..", import.meta.url)` from its scripts). */
export function standaloneWorkerConfig(appRoot: URL, name: string) {
  const publicDir = new URL("public/", appRoot);
  const publicFiles = existsSync(publicDir)
    ? readdirSync(publicDir, { withFileTypes: true }).map((entry) =>
        entry.isDirectory() ? `!/${entry.name}/*` : `!/${entry.name}`,
      )
    : [];
  return {
    name,
    main: "src/server.ts",
    compatibility_date: COMPATIBILITY_DATE,
    // strictly public: the gate's fetches (discovery, the token endpoint, the mind's API) go
    // out over the internet, as a browser's would
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    durable_objects: { bindings: [{ name: "BROWSER_SESSION", class_name: "BrowserSession" }] },
    exports: { BrowserSession: { type: "durable-object" as const, storage: "sqlite" as const } },
    // no issuer, no other apps, no PostHog (./start-app-config.ts)
    vars: { ITERATE_APP: "{}" },
    observability: { enabled: true },
    workers_dev: true,
    assets: {
      binding: "ASSETS",
      not_found_handling: "none" as const,
      // every request starts the Worker but vite's hashed files and public/
      // (scripts/lib/start-app.ts `workerFirstRoutes`)
      run_worker_first: ["/*", "!/assets/*", ...publicFiles],
    },
  };
}

/** The app's `deploy:standalone`: `[worker-name] [--build-only]` from the command line, the name
 *  `defaultName` unless given. Builds, then deploys unless `--build-only`. */
export function runStandaloneDeploy(appRoot: URL, defaultName: string) {
  const args = process.argv.slice(2);
  const buildOnly = args.includes("--build-only");
  const name = args.find((arg) => !arg.startsWith("--")) || defaultName;
  if (!buildOnly && (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN)) {
    console.error(
      "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for the account to deploy to.",
    );
    process.exit(1);
  }
  const run = (command: string, commandArgs: string[], env: Record<string, string> = {}) => {
    console.log(`$ ${command} ${commandArgs.join(" ")}`);
    const result = spawnSync(command, commandArgs, {
      cwd: fileURLToPath(appRoot),
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  };
  run("pnpm", ["exec", "vite", "build"], { [STANDALONE_WORKER_ENV]: name });
  if (!buildOnly)
    run("pnpm", ["exec", "wrangler", "deploy", "--config", "dist/server/wrangler.json"]);
}
