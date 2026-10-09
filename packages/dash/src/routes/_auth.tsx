// The signed-in shell: authenticate once (the SDK client; a missing session leaves for the issuer's
// login), open the tree every page shares — the person's organizations and their projects, read
// again as they change (components/organization-tree.tsx) — and frame every child in the shared `AppShell` (packages/ui,
// the same frame agents, notes and voice use). Consent is task-based: the dash asks for `iterate`,
// `account` and `organizations:write`, the person may untick the optional two, and the pages read
// `info.scopes` for what they may do. Until the browser has signed in — and in the server's HTML,
// since signing in happens in the browser — the route shows `Frame`: the same shell, drawn from the
// URL alone.
import {
  createFileRoute,
  Link,
  Outlet,
  useMatch,
  useMatches,
  useParams,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Plus } from "lucide-react";
import { useMemo } from "react";
import { AppShell } from "@iterate-com/ui/components/app-shell";
import { DefaultPendingComponent } from "@iterate-com/ui/components/route-defaults";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@iterate-com/ui/components/ui/dropdown-menu";
import { usePosthogIdentity, type PosthogGroup } from "@iterate-com/ui/components/posthog";
import { Identifier } from "../components/identifier.tsx";
import { DashBreadcrumbs } from "../components/dash-breadcrumbs.tsx";
import { ProjectNav, TopLevelNav } from "../components/dash-nav.tsx";
import { OrganizationTree, useOrganizationTree } from "../components/organization-tree.tsx";
import { projectSiteOf } from "../lib/origins.ts";
import { iterateClient } from "../lib/iterate-client.ts";

export const Route = createFileRoute("/_auth")({
  ssr: false,
  beforeLoad: ({ location }) => iterateClient.authenticate(location.href),
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

/** The shell before sign-in, from what the URL says: the navigation, the header, and the project by
 *  its slug, which is all the switcher shows of it. What only the session knows (the person, their
 *  projects, the project's site) is a placeholder, and the page a spinner, until `Shell` replaces
 *  it in place. */
function Frame() {
  const href = useRouterState({ select: (state) => state.location.href });
  const { slug } = useParams({ strict: false });
  const page = usePageLabel();
  return (
    <AppShell
      app="iterate"
      projects={slug ? [{ id: slug, slug }] : []}
      activeProjectId={slug || null}
      projectHref={(project) => `/projects/${project.slug}`}
      nav={slug ? <ProjectNav project={{ slug }} host={null} signingIn /> : <TopLevelNav />}
      header={<DashBreadcrumbs project={null} page={page} />}
      locationKey={href}
    >
      <DefaultPendingComponent />
    </AppShell>
  );
}

function Shell() {
  const { api, info } = Route.useRouteContext();
  const router = useRouter();
  const href = useRouterState({ select: (state) => state.location.href });
  const tree = useOrganizationTree();
  // inside a project: the one its route resolved (projects/$slug/route.tsx)
  const active = useMatch({ from: "/_auth/projects/$slug", shouldThrow: false })?.context.project;
  const page = usePageLabel();
  // PostHog: the person is the platform user id (the same person in every app); the groups are the
  // project on screen and its organization, keyed by id (docs: organization, then project).
  const activeOrg = active && tree.organizations.find((org) => org.id === active.orgId);
  const posthogGroups = useMemo(
    (): PosthogGroup[] =>
      active
        ? [
            ...(activeOrg
              ? [{ type: "organization", key: activeOrg.id, properties: { name: activeOrg.name } }]
              : []),
            { type: "project", key: active.id, properties: { slug: active.slug } },
          ]
        : [],
    [active, activeOrg],
  );
  usePosthogIdentity(info.principal, posthogGroups);
  // the switcher lists projects by organization, in the tree's order
  const treeProjects = tree.organizations.flatMap((org) =>
    org.projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      org: { id: org.id, name: org.name },
    })),
  );
  // THE PAGE'S PROJECT, NAMED AT ONCE: a fresh page load resolves it from the catalog
  // (projects/$slug/route.tsx) before the tree has answered, and until the tree lists it the
  // switcher would read "(select project)" on that very project's page — a second or more on a busy
  // platform. It names the project the page shows, its organization by id.
  const switcherProjects =
    active && !treeProjects.some((project) => project.id === active.id)
      ? [
          ...treeProjects,
          { id: active.id, slug: active.slug, org: { id: active.orgId, name: active.orgId } },
        ]
      : treeProjects;
  return (
    <>
      <OrganizationTree api={api} info={info} />
      <AppShell
        app="iterate"
        projects={switcherProjects}
        activeProjectId={active?.id || null}
        projectHref={(project) => `/projects/${project.slug}`}
        // the dash has a client router: a plain click on a switcher item is a route change, not a
        // page load (the shell leaves modified and middle clicks to the anchor)
        onNavigate={(to, event) => {
          event.preventDefault();
          void router.navigate({ href: to });
        }}
        switcherActions={
          <>
            <DropdownMenuItem render={<Link to="/projects" search={{ new: 1 }} />}>
              <Plus />
              <span>New project</span>
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link to="/projects" />}>
              <ArrowLeft />
              <span>All projects</span>
            </DropdownMenuItem>
          </>
        }
        nav={
          active ? (
            <ProjectNav
              project={active}
              // on the hostname this deployment's config pins to it; the shell never reads the
              // one the project claimed, but a page visit on its ingress URL goes on there (core/os
              // primary-hostname-redirect.ts)
              host={projectSiteOf(info, {
                id: active.id,
                slug: active.slug,
                primaryHostname: null,
              })}
              platformOrigin={info.platformOrigin}
            />
          ) : (
            <TopLevelNav platformOrigin={info.platformOrigin} />
          )
        }
        header={<DashBreadcrumbs project={active || null} page={page} />}
        account={info.principal}
        accountActions={
          <>
            {/* the person's id, copyable (Base UI: a menu label lives inside a group) */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                <Identifier value={info.principal.actor} textClassName="text-xs" />
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuItem render={<Link to="/sessions" />}>
              <KeyRound />
              <span>Sessions</span>
            </DropdownMenuItem>
          </>
        }
        locationKey={href}
      >
        <Outlet />
      </AppShell>
    </>
  );
}
