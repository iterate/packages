// The signed-in shell: authenticate once with the `admin` scope (the SDK client; a missing session
// leaves for the issuer's login), read the projects this session reaches — every project on the
// platform, for an admin —
// and frame every child in the shared `AppShell` (packages/ui), the frame every client app uses.
// Until then — and in the server's HTML, since signing in happens in the browser — the route shows
// `Frame`: the same shell, drawn from the URL alone.
import {
  createFileRoute,
  Link,
  Outlet,
  useMatch,
  useParams,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { Activity, FolderKanban, Globe, Users } from "lucide-react";
import { createIterateClient } from "iterate/app";
import { AppShell } from "@iterate-com/ui/components/app-shell";
import { DefaultPendingComponent } from "@iterate-com/ui/components/route-defaults";
import { usePosthogIdentity } from "@iterate-com/ui/components/posthog";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@iterate-com/ui/components/ui/sidebar";
import { adminScopes } from "../scopes.ts";

const iterate = createIterateClient({ scopes: adminScopes });

export const Route = createFileRoute("/_auth")({
  ssr: false,
  beforeLoad: ({ location }) => iterate.authenticate(location.href),
  pendingComponent: Frame,
  loader: async ({ context }) => ({ projects: await context.read((api) => api.projects.list()) }),
  component: Shell,
});

/** The shell before sign-in and while the projects are read, from what the URL says: the
 *  navigation, and the project by its slug, which is all the switcher shows of it. The server sends
 *  it in the HTML; `Shell` replaces it in place. */
function Frame() {
  const href = useRouterState({ select: (state) => state.location.href });
  const { slug } = useParams({ strict: false });
  return (
    <AppShell
      app="iterate"
      projects={slug ? [{ id: slug, slug }] : []}
      activeProjectId={slug || null}
      projectHref={(project) => `/projects/${project.slug}`}
      nav={<AdminNav />}
      locationKey={href}
    >
      <DefaultPendingComponent />
    </AppShell>
  );
}

function Shell() {
  const { info } = Route.useRouteContext();
  const { projects } = Route.useLoaderData();
  const router = useRouter();
  const href = useRouterState({ select: (state) => state.location.href });
  const slug = useMatch({ from: "/_auth/projects/$slug/$", shouldThrow: false })?.params.slug;
  const active = projects.find((project) => project.slug === slug);
  usePosthogIdentity(info.principal);
  return (
    <AppShell
      app="iterate"
      projects={projects.map((project) => ({ id: project.id, slug: project.slug }))}
      activeProjectId={active?.id || null}
      projectHref={(project) => `/projects/${project.slug}`}
      onNavigate={(to, event) => {
        event.preventDefault();
        void router.navigate({ href: to });
      }}
      nav={<AdminNav />}
      account={info.principal}
      locationKey={href}
    >
      <Outlet />
    </AppShell>
  );
}

function AdminNav() {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Projects" render={<Link to="/projects" />}>
              <FolderKanban />
              <span>Projects</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Users" render={<Link to="/users" />}>
              <Users />
              <span>Users</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Global"
              render={<Link to="/global/$" params={{ _splat: "" }} />}
            >
              <Globe />
              <span>Global</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Telemetry" render={<Link to="/telemetry" />}>
              <Activity />
              <span>Telemetry</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
