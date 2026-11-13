import { createRootRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { AppDocumentShell, AppRoot } from "@iterate-com/ui/apps/document";
import { appHead } from "@iterate-com/ui/apps/head";
import { startAppConfigOf } from "@iterate-com/shared/start-app-config";
import css from "../styles.css?url";
/** What the worker's `ITERATE_APP` says about this deployment: its PostHog project key (envs.ts, prd
 *  only). */
const deployment = createServerFn().handler(async () => {
  const { env } = await import("cloudflare:workers");
  const config = startAppConfigOf(env);
  return {
    posthogProjectKey: config.posthogProjectKey || null,
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
