import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { documentBasePath } from "@iterate-com/ui/apps/base-path";
import { IterateLogo } from "@iterate-com/ui/components/iterate-logo";
import { Button } from "@iterate-com/ui/components/ui/button";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import { iterateClient, MeContext, signedIn } from "../lib/iterate.ts";
import { PersonProvider } from "../components/person-provider.tsx";

/** Everything a signed-in person sees: who the platform says they are, the tab's session, one
 *  header. A visitor nobody signed in goes to the Cloud's first page, which offers the sign-in. */
export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    // `next` is the browser's path, base path included (routes/index.tsx)
    const next = `${context.basePath}${location.href}`;
    if (!(await signedIn())) throw redirect({ to: "/", search: { next }, replace: true });
    const { api } = await iterateClient.authenticate(next);
    const { actor, email } = await api.whoami();
    return { me: { api, sub: actor, email: email || null } };
  },
  // the header's frame while the session is asked about
  pendingComponent: () => (
    <Frame>
      <Spinner />
    </Frame>
  ),
  component: Shell,
});

function Shell() {
  const { me } = Route.useRouteContext();
  return (
    <Frame email={me.email}>
      <MeContext value={me}>
        <PersonProvider>
          <Outlet />
        </PersonProvider>
      </MeContext>
    </Frame>
  );
}

function Frame({ email, children }: { email?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center gap-3 border-b px-5 py-3">
        <Link to="/deployments" className="flex items-center gap-2 font-semibold">
          <IterateLogo alt="" className="size-5" />
          iterate
        </Link>
        {email ? (
          <>
            <span className="ml-auto text-sm text-muted-foreground">{email}</span>
            {/* the platform's sign-out, back to the Cloud's first page */}
            <form
              method="post"
              action={`/.auth/logout?${new URLSearchParams({ next: `${documentBasePath()}/` })}`}
            >
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </>
        ) : null}
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-8">{children}</main>
    </div>
  );
}
