import { createRootRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { AppDocumentShell, AppRoot } from "@iterate-com/ui/apps/document";
import { appHead } from "@iterate-com/ui/apps/head";
import { startAppConfigOf } from "@iterate-com/shared/start-app-config";
import css from "../styles.css?url";
/** What the worker's `ITERATE_APP` says about this deployment: its PostHog project key (envs.ts, prd
 *  only) and its dash, where a mind's config repo is (`urls.dash`: prd's from envs.ts; a per-PR
 *  preview's, the same PR's dash preview). `dashOrigin` is null when it names none: a preview run
 *  that did not deploy the dash. */
const deployment = createServerFn().handler(async () => {
  const { env } = await import("cloudflare:workers");
  const config = startAppConfigOf(env);
  return {
    posthogProjectKey: config.posthogProjectKey || null,
    dashOrigin: config.urls.dash || null,
  };
});

export const Route = createRootRoute({
  loader: () => deployment(),
  staleTime: Infinity,
  head: () => appHead({ title: "Agents", stylesheet: css }),
  // the document is the shell's, which reads no loader data: when `deployment` fails, the error
  // page still has its <html>, its styles and its scripts
  shellComponent: ({ children }) => (
    <AppDocumentShell icon="/client-logo.svg">{children}</AppDocumentShell>
  ),
  component: Root,
});

function Root() {
  const { posthogProjectKey } = Route.useLoaderData();
  return <AppRoot posthogProjectKey={posthogProjectKey} />;
}
