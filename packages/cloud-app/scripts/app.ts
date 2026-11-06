import { cloudAppEnvs } from "../../../envs.ts";
import { startAppCli } from "../../../scripts/lib/start-app.ts";

/** packages/cloud-app as scripts/lib/start-app.ts sees it: the package scripts and vite.config.ts
 *  run off this. It has no secrets of its own: its deploy reads the Cloudflare token every app
 *  inherits, from _shared. */
export const cloudApp = {
  name: "cloud",
  dopplerProject: "_shared",
  root: new URL("..", import.meta.url),
  envs: cloudAppEnvs,
};
if (import.meta.main) void startAppCli(cloudApp).run();
