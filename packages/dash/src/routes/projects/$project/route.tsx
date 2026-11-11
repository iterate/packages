// /projects/<address> — the frame of every page about one project. The URL names the project by
// its address (iterate/project-api); the page's `itx` is that project's root context, through the
// app's gate (`createIterateClient({ project })`). A browser with no session there leaves to sign
// in, or to the connect page. Every page below reads `itx`, `read` and `project` from this route's
// context. Until the browser has signed in, and in the server's HTML, the route shows `Frame`: the
// same shell, drawn from the URL alone.
import {
  createFileRoute,
  Outlet,
  useMatches,
  useParams,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { createIterateClient, type IterateClient } from "iterate/app";
import { AppShell } from "@iterate-com/ui/components/app-shell";
import { DefaultPendingComponent } from "@iterate-com/ui/components/route-defaults";
import { DropdownMenuGroup, DropdownMenuLabel } from "@iterate-com/ui/components/ui/dropdown-menu";
import { DashBreadcrumbs } from "../../../components/dash-breadcrumbs.tsx";
import { ProjectNav } from "../../../components/dash-nav.tsx";
import { Identifier } from "../../../components/identifier.tsx";

/** One client per project this page has shown, so switching back keeps its connection. */
const clients = new Map<string, IterateClient>();
function clientFor(project: string) {
  let client = clients.get(project);
  if (!client) {
    client = createIterateClient({ project });
    clients.set(project, client);
  }
  return client;
}

export const Route = createFileRoute("/projects/$project")({
  // signing in is the browser's: the server's HTML is the frame from the URL
  ssr: false,
  beforeLoad: async ({ params, location }) => ({
    ...(await clientFor(params.project).authenticate(location.href)),
    project: params.project,
  }),
  // who the project's API says is signed in, for the account menu
  loader: async ({ context }) => ({
    principal: (await context.read((itx) => itx.whoami())).principal || null,
  }),
  head: ({ params }) => ({ meta: [{ title: `${params.project} · Dash` }] }),
  pendingComponent: Frame,
  component: Shell,
});

/** The label the deepest page that names itself gives (`staticData: { page }`), for the header. */
function usePageLabel() {
  return useMatches()
    .map((match) => match.staticData.page)
    .filter((label): label is string => Boolean(label))
    .at(-1);
}

/** The shell before sign-in, from what the URL says: the navigation and the project. The account is
 *  a placeholder, and the page a spinner, until `Shell` replaces it in place. */
function Frame() {
  const href = useRouterState({ select: (state) => state.location.href });
  const { project } = useParams({ strict: false });
  const page = usePageLabel();
  if (!project) return <DefaultPendingComponent />;
  return (
    <AppShell
      app="Dash"
      project={project}
      projectHref={(address) => `/projects/${address}`}
      nav={<ProjectNav project={project} />}
      searchRow={false}
      header={<DashBreadcrumbs project={project} page={page} />}
      locationKey={href}
    >
      <DefaultPendingComponent />
    </AppShell>
  );
}

function Shell() {
  const { project } = Route.useRouteContext();
  const { principal } = Route.useLoaderData();
  const router = useRouter();
  const href = useRouterState({ select: (state) => state.location.href });
  const page = usePageLabel();
  return (
    <AppShell
      app="Dash"
      project={project}
      projectHref={(address) => `/projects/${address}`}
      // the dash has a client router: a plain click on a switcher item is a route change, not a
      // page load (the shell leaves modified and middle clicks to the anchor)
      onNavigate={(to, event) => {
        event.preventDefault();
        void router.navigate({ href: to });
      }}
      nav={<ProjectNav project={project} />}
      searchRow={false}
      header={<DashBreadcrumbs project={project} page={page} />}
      // the menu names the project when its API says nobody
      account={principal}
      accountActions={
        principal ? (
          // the person's id, copyable (Base UI: a menu label lives inside a group)
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              <Identifier value={principal.actor} textClassName="text-xs" />
            </DropdownMenuLabel>
          </DropdownMenuGroup>
        ) : undefined
      }
      locationKey={href}
    >
      <Outlet />
    </AppShell>
  );
}
