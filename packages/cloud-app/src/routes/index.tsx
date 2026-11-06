import { createFileRoute, redirect } from "@tanstack/react-router";
import { documentBasePath } from "@iterate-com/ui/apps/base-path";
import { z } from "zod";
import { LogInWithIterate } from "@iterate-com/ui/components/log-in-with-iterate";
import { ErrorMessage } from "@iterate-com/ui/components/standalone-page";
import { signedInPerson } from "../lib/cloud.ts";

/** A visitor with no Cloud session sees the sign-in and nothing else; a signed-in one goes to their
 *  deployments, or to `next`. */
export const Route = createFileRoute("/")({
  validateSearch: z.object({
    next: z.string().optional().catch(undefined),
    error: z.string().optional().catch(undefined),
  }),
  ssr: false,
  // `next` is the browser's path, base path included; the router's own paths are without it
  beforeLoad: async ({ search }) => {
    if (await signedInPerson())
      throw redirect({
        href: withoutBase(sameOrigin(search.next)) || "/deployments",
        replace: true,
      });
  },
  head: () => ({ meta: [{ title: "Sign in · iterate" }] }),
  component: SignIn,
});

function SignIn() {
  const { next, error } = Route.useSearch();
  const base = documentBasePath();
  const href = `${base}/sign-in?${new URLSearchParams({ next: sameOrigin(next) || `${base}/deployments` })}`;
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex max-w-sm flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">iterate</h1>
          <p className="font-readme text-muted-foreground">
            Run iterate in your own Cloudflare account.
          </p>
        </div>
        {error ? (
          <ErrorMessage>{SIGN_IN_ERRORS[error] || SIGN_IN_ERRORS.unconfirmed}</ErrorMessage>
        ) : null}
        {/* the one recognisable button, posting to the Cloud's own sign-in (sign-in.ts) */}
        <LogInWithIterate formAction={href} />
      </div>
    </main>
  );
}

/** What the Cloud's sign-in says went wrong (@iterate-com/cloud sign-in.ts), in our words: the
 *  URL carries a code, never a sentence. */
const SIGN_IN_ERRORS: Record<string, string> = {
  expired: "This sign-in expired or began in another browser. Start it again.",
  issuer: "The answer did not come from os.iterate.com. Start the sign-in again.",
  cancelled: "The sign-in at os.iterate.com was cancelled.",
  unconfirmed: "We could not confirm who you are at os.iterate.com. Try again.",
};

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
