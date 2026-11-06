import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { documentBasePath } from "@iterate-com/ui/apps/base-path";
import { IterateLogo } from "@iterate-com/ui/components/iterate-logo";
import { Button } from "@iterate-com/ui/components/ui/button";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import { cloudApi, signedInPerson } from "../lib/cloud.ts";
import { PersonProvider } from "../components/person-provider.tsx";

/** Everything a signed-in person sees: their Cloud session's person, the tab's API, one header. */
export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    // the socket's handshake starts beside the session check, not after it
    cloudApi();
    const me = await signedInPerson();
    // `next` is the browser's path, base path included (routes/index.tsx)
    if (!me)
      throw redirect({
        to: "/",
        search: { next: `${context.basePath}${location.href}` },
        replace: true,
      });
    return { me };
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
      <PersonProvider>
        <Outlet />
      </PersonProvider>
    </Frame>
  );
}

function Frame({ email, children }: { email?: string; children: React.ReactNode }) {
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
            <form method="post" action={`${documentBasePath()}/sign-out`}>
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
