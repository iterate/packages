// standalone.ts — THE AGENTS APP AS A WORKER OF ITS OWN, hosted apart from any mind
// (@iterate-com/shared/standalone-app says what that Worker is):
//
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… pnpm deploy:standalone [worker-name]
//   pnpm deploy:standalone [worker-name] --build-only   # dist/ only, nothing deployed
//
// The Worker is `iterate-app-agents` unless named. What it made goes with the Worker, its Durable
// Objects included:
//
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… pnpm exec wrangler delete --name iterate-app-agents
import { runStandaloneDeploy } from "@iterate-com/shared/standalone-app";

runStandaloneDeploy(new URL("..", import.meta.url), "iterate-app-agents");
