import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { AppShell, AppShellBrand } from "@iterate-com/ui/components/app-shell";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import { iterateClient, MeContext, signedIn } from "../lib/iterate.ts";
import { CloudNav } from "../components/cloud-nav.tsx";
import { PersonProvider } from "../components/person-provider.tsx";

/** Everything a signed-in person sees, in the apps' one shell: the sidebar lists their deployments
 *  and the integrations, the account menu signs them out. A visitor nobody signed in goes to the
 *  Cloud's first page, which offers the sign-in. */
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
  // the shell's frame while the session is asked about
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
    <MeContext value={me}>
      <PersonProvider>
        <Frame me={me}>
          <Outlet />
        </Frame>
      </PersonProvider>
    </MeContext>
  );
}

/** The shell around a page: with `me`, the person's sidebar; without, the frame alone. */
function Frame({
  me,
  children,
}: {
  me?: { sub: string; email: string | null };
  children: React.ReactNode;
}) {
  const href = useRouterState({ select: (state) => state.location.href });
  return (
    <AppShell
      app="Cloud"
      projects={[]}
      activeProjectId={null}
      projectHref={() => "/"}
      searchRow={false}
      switcher={<AppShellBrand app="Cloud" line={me?.email} />}
      nav={me ? <CloudNav /> : null}
      account={me ? { actor: me.sub, email: me.email || undefined } : undefined}
      locationKey={href}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6">{children}</div>
    </AppShell>
  );
}
