import { createFileRoute, redirect } from "@tanstack/react-router";
import { documentBasePath } from "@iterate-com/ui/apps/base-path";
import { z } from "zod";
import { LogInWithIterate } from "@iterate-com/ui/components/log-in-with-iterate";
import { signedIn } from "../lib/iterate.ts";

/** A visitor the platform does not know sees the sign-in and nothing else; a signed-in one goes to
 *  their deployments, or to `next`. */
export const Route = createFileRoute("/")({
  validateSearch: z.object({ next: z.string().optional().catch(undefined) }),
  ssr: false,
  // `next` is the browser's path, base path included; the router's own paths are without it
  beforeLoad: async ({ search }) => {
    if (await signedIn())
      throw redirect({
        href: withoutBase(sameOrigin(search.next)) || "/deployments",
        replace: true,
      });
  },
  head: () => ({ meta: [{ title: "Sign in · iterate" }] }),
  component: SignIn,
});

function SignIn() {
  const { next } = Route.useSearch();
  const base = documentBasePath();
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex max-w-sm flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">iterate</h1>
          <p className="font-readme text-muted-foreground">
            Run iterate in your own Cloudflare account.
          </p>
        </div>
        {/* the platform's sign-in, asking only who the person is; `/.auth/*` is this origin's own
            under subdomains and the platform's (this origin too) under paths */}
        <LogInWithIterate scopes={["identity"]} next={sameOrigin(next) || `${base}/deployments`} />
      </div>
    </main>
  );
}

/** A browser path as the router names it: without the base path. */
function withoutBase(path: string | undefined) {
  const base = documentBasePath();
  if (!path || !base) return path;
  return path.startsWith(`${base}/`) ? path.slice(base.length) : undefined;
}

/** `next` as a path on this origin, or undefined. */
function sameOrigin(next: string | undefined) {
  if (!next) return undefined;
  const url = new URL(next, location.origin);
  return url.origin === location.origin ? `${url.pathname}${url.search}` : undefined;
}
