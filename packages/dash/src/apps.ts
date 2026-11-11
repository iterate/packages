import type { StartAppConfig } from "@iterate-com/shared/start-app-config";

/** The first-party apps the dash links to from a mind — each its own worker on its own origin,
 *  serving a mind at `/minds/<address>`. Their origins are this deployment's
 *  (`appDirectory`): a standalone Dash names none, and links to none. */
const APPS = [
  { id: "agents", name: "Agents" },
  { id: "voice", name: "Voice" },
] as const;

/** The directory as this deployment has it: each app at the origin the worker's `ITERATE_APP
 *  urls` names. An app it names no origin for is not listed. */
export function appDirectory(urls: StartAppConfig["urls"]) {
  return APPS.flatMap((app) => {
    const url = urls[app.id];
    return url ? [{ ...app, url }] : [];
  });
}
