// dash.tsx — A MIND'S DASH, drawn from lists: `Dash` takes the mind's pages (each a row with its
// id, name, icon and component) and its groups of links (other apps, the stack's pages), and draws
// the shell, the sidebar, the page the URL names and, on every page, what waits for a member's yes.
// ONE list of pages drives the sidebar. A page is any component: the kit's (`DashContexts`,
// `DashRepo`, … in ./dash-pages.tsx; `DashHome` and `DashAgents` in agent-kind-view/dash-agents.tsx)
// or one of the mind's own, which takes the same props (`DashPageProps`).
//
// TWO IDS ARE KNOWN TO THE SHELL, whatever component a row names:
//   agents    the Agents page. The sidebar lists the most recently active agents below the pages and links,
//             `?agent=<path>` shows that page (its agent view), and ⌘K has an Agents tab. The
//             catalog on `/agents` is read once, live, for all of them and handed to every page.
//   contexts  the raw view of any context: ⌘K's Raw contexts tab and its path mode open it.
// ⌘K is the shell's, one palette for every page (./dash-palette.tsx).
//
// The URL is the page's (#/lib/page-url.ts): `?page=<id>` (none: the first page) and the page's
// own keys. The first page of a no-build page loads none of the kit's larger parts: each page loads
// its own when it first draws, and suspends meanwhile.
import {
  Component,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { SquarePenIcon } from "lucide-react";
import type { AuthenticatedApp } from "iterate/app";
import type { Principal } from "iterate/principal";
import { useContextStub, useFacetLiveState } from "iterate/react";
import { servesOf } from "./serves.ts";
import { DashAgentsNav } from "./dash-agents-nav.tsx";
import { agentViewHref, rawViewHref } from "./dash-href.ts";
import { DashNote, type DashLinks, type DashPage } from "./dash-pages.tsx";
import { DashPalette } from "./dash-palette.tsx";
import { AppShell } from "#/components/app-shell.tsx";
import { ApprovalsAlert } from "#/components/approvals-alert.tsx";
import { useContextCatalog } from "#/components/context-catalog/context-catalog-list.tsx";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "#/components/ui/sidebar.tsx";
import { Toaster } from "#/components/ui/sonner.tsx";
import { agentRowsOf, type AgentRow } from "#/lib/agent-summary.ts";
import { go, linkTo, pageHref, usePageParam, useSearch } from "#/lib/page-url.ts";
import { titleWithCount, useWaitingApprovals } from "#/lib/waiting-approvals.ts";

export {
  DashAnalytics,
  DashContexts,
  DashIntegrations,
  DashMcp,
  DashNote,
  DashPartIsOff,
  DashRepo,
  DashScroll,
  DashSecrets,
  type DashLink,
  type DashLinks,
  type DashPage,
  type DashPageProps,
} from "./dash-pages.tsx";

type Itx = AuthenticatedApp["itx"];

export function Dash({
  app,
  itx,
  mind,
  principal,
  pages,
  links,
}: {
  /** the app's name, on top of the sidebar: "Dash" */
  app: string;
  itx: Itx;
  mind: string;
  principal: Principal | null | undefined;
  pages: DashPage[];
  links: DashLinks[];
}) {
  // WHAT WAITS FOR A MEMBER'S YES is said on every page: the alert at the top of the sidebar, the
  // number beside the link that counts it, and the count before the tab's title. An agent stands
  // still until a member answers.
  const read = useCallback<AuthenticatedApp["read"]>((ask) => Promise.resolve(ask(itx)), [itx]);
  const waiting = useWaitingApprovals(mind, read);
  useEffect(() => {
    document.title = titleWithCount(document.title, waiting);
  }, [waiting]);
  const scheme = useSyncExternalStore(
    () => () => {},
    schemeOfPage,
    (): "light" => "light",
  );
  const search = useSearch();
  const asked = usePageParam("page");
  const agentsPage = pages.find((row) => row.id === "agents");
  const contextsPage = pages.find((row) => row.id === "contexts");
  // an agent view is the Agents page's, whatever `?page` says
  const agentParam = usePageParam("agent");
  const agent = (agentsPage && agentParam) || undefined;
  const page = (agent && agentsPage) || pages.find((row) => row.id === asked) || pages[0];
  if (!page) throw new Error("A Dash has at least one page");
  const Page = page.component;
  // THE CATALOG OF THE MIND'S CONTEXTS, read once for every page: ⌘K lists it, and the Contexts
  // page shows its awake dots and its Recent list. A platform without it rejects: the rows stay
  // undefined, and ⌘K says so.
  const listContexts = useCallback(() => itx.contexts.list({ limit: 500 }), [itx]);
  const catalog = useContextCatalog(listContexts, { of: mind });
  // THE CATALOG OF THE MIND'S AGENTS, live, for the sidebar, ⌘K and every page
  const agents = useAgentRows(itx, Boolean(agentsPage));
  const context = usePageParam("context");
  const searchContexts = useCallback(
    (query: string) => itx.contexts.list({ search: query, limit: 200 }),
    [itx],
  );
  const listUnder = useCallback(
    (path: string) => itx.contexts.list({ under: path, limit: 200 }),
    [itx],
  );
  return (
    <>
      <AppShell
        app={app}
        mind={mind}
        mindHref={() => "./"}
        nav={
          <DashNav
            itx={itx}
            mind={mind}
            pages={pages}
            links={links}
            page={page}
            waiting={waiting}
            newAgent={agentsPage ? hrefOfPage(pages, agentsPage) : undefined}
            agents={
              agentsPage ? (
                <DashAgentsNav
                  agents={agents}
                  current={agent}
                  overview={hrefOfPage(pages, agentsPage)}
                  overviewShown={page === agentsPage && !agent}
                />
              ) : null
            }
          />
        }
        account={principal}
        palette={
          agentsPage || contextsPage
            ? ({ open, onClose }) => (
                <DashPalette
                  open={open}
                  onClose={onClose}
                  agents={agents}
                  rows={catalog.rows}
                  error={catalog.error}
                  search={searchContexts}
                  listUnder={listUnder}
                  onOpenAgent={agentsPage ? (path) => go(agentViewHref(path)) : null}
                  onOpenContext={
                    contextsPage ? (path) => go(rawViewHref(contextsPage.id, path)) : null
                  }
                  current={agent || (page === contextsPage && context) || undefined}
                />
              )
            : undefined
        }
        locationKey={search}
      >
        <PageBoundary key={page.id} shows={agent || ""}>
          <Suspense fallback={<DashNote waiting>Loading the page…</DashNote>}>
            <Page
              itx={itx}
              mind={mind}
              principal={principal}
              page={page}
              pages={pages}
              links={links}
              catalog={catalog.rows}
              agents={agents}
              waiting={waiting}
            />
          </Suspense>
        </PageBoundary>
      </AppShell>
      <Toaster theme={scheme} />
    </>
  );
}

/** The catalog on `/agents`, live: one subscription to its live state, which reads no agent, so
 *  the Dash wakes none. Undefined while it is read; none for a mind without agents. `on` false
 *  holds nothing. */
function useAgentRows(itx: Itx, on: boolean): AgentRow[] | undefined {
  const held = useContextStub(on ? () => itx.cd("/agents") : null, [itx, on]);
  const live = useFacetLiveState(held.stub, "agents");
  const failed = Boolean(held.error) || live.status === "error";
  return useMemo(
    () => (live.value !== undefined ? agentRowsOf(live.value) : failed ? [] : undefined),
    [live.value, failed],
  );
}

/** The page's colour scheme, as apps/theme.css set it when the page loaded: shadcn's class
 *  `dark` on `<html>`. Nothing changes it later, so the store has nothing to subscribe to. */
const schemeOfPage = (): "dark" | "light" =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

/** An `<a>` for a sidebar row's `render`: the row hands it its content and its own props. `inPage`:
 *  a plain left click changes the Dash's URL in place. */
function RowLink({
  href,
  inPage,
  onClick,
  ...props
}: ComponentProps<"a"> & { href: string; inPage?: boolean }) {
  const link = inPage ? linkTo(href) : undefined;
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        link?.onClick(event);
      }}
    />
  );
}

/** The link to a page of the list: the first one is the Dash's root, "./". */
function hrefOfPage(pages: DashPage[], page: DashPage) {
  return pageHref(page === pages[0] ? undefined : page.id);
}

/** A page that throws, or whose part did not load, says so in its own place; the sidebar stays. A
 *  browser keeps a module's failed load for the life of the page, so the way out is a reload.
 *  Another page is another boundary (its `key`). On the Agents page `shows` is the open agent's
 *  path: the error is the view's it came from, so another agent, or none, draws again. Nothing is
 *  mounted anew while there is no error, and the page's own `?view=` state is not in `shows`. */
type Shown = { error: string | null; shows: string };
class PageBoundary extends Component<{ shows: string; children: ReactNode }, Shown> {
  override state: Shown = { error: null, shows: this.props.shows };
  static getDerivedStateFromProps(props: { shows: string }, state: Shown): Partial<Shown> | null {
    if (props.shows === state.shows) return null;
    return { error: null, shows: props.shows };
  }
  static getDerivedStateFromError(error: unknown): Partial<Shown> {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <DashNote alert>
        This page did not load: {this.state.error}. <a href={location.href}>Load the page again</a>{" "}
        to try once more.
      </DashNote>
    );
  }
}

/** Whether the mind serves a page's part: false while the page asks, and for a page that every
 *  stack has. The sidebar and the cards draw at once, and mute a row when the answer is no. */
function Off({
  itx,
  serves,
  children,
}: {
  itx: Itx;
  serves: string | undefined;
  children: (off: boolean) => ReactNode;
}) {
  if (!serves) return children(false);
  return (
    <Suspense fallback={children(false)}>
      <OffAnswer itx={itx} serves={serves}>
        {children}
      </OffAnswer>
    </Suspense>
  );
}

function OffAnswer({
  itx,
  serves,
  children,
}: {
  itx: Itx;
  serves: string;
  children: (off: boolean) => ReactNode;
}) {
  return children(!use(servesOf(itx, serves)));
}

/** The sidebar: "New agent" first, then the pages, then each group of links. A page whose part the mind does not have
 *  stays in its place, muted, with "Off" beside it. */
function DashNav({
  itx,
  mind,
  pages,
  links,
  page,
  waiting,
  newAgent,
  agents,
}: {
  itx: Itx;
  mind: string;
  pages: DashPage[];
  links: DashLinks[];
  page: DashPage;
  /** Undefined until the mind has answered: the alert draws for a count that is known. */
  waiting: number | undefined;
  /** Where a new agent starts: the Agents page, whose composer's first message starts one. The
   *  sidebar's first row goes there. None for a Dash with no Agents page. */
  newAgent?: string;
  /** The Agents section, below the pages and the links, for a Dash with an Agents page. */
  agents: ReactNode;
}) {
  return (
    <>
      {waiting ? (
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <ApprovalsAlert
              waiting={waiting}
              render={<RowLink href={`https://iterate.${mind}/secrets/approvals`} />}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
      {newAgent ? (
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  variant="outline"
                  tooltip="New agent"
                  render={
                    <RowLink
                      href={newAgent}
                      inPage
                      onClick={(event) => {
                        // the composer takes the caret: at once when the page is shown already,
                        // and when it draws otherwise, which it does only while nothing has focus
                        event.currentTarget.blur();
                        document
                          .querySelector<HTMLElement>('[aria-label="Message a new agent"]')
                          ?.focus();
                      }}
                    />
                  }
                >
                  <SquarePenIcon />
                  <span>New agent</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {/* with an Agents section, its "View all" is the Agents page's row */}
            {pages
              .filter((row) => !(agents && row.id === "agents"))
              .map((row) => (
                <Off key={row.id} itx={itx} serves={row.serves}>
                  {(off) => (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={row === page}
                        tooltip={row.name}
                        className={off ? "text-muted-foreground" : undefined}
                        render={<RowLink href={hrefOfPage(pages, row)} inPage />}
                      >
                        <row.icon />
                        <span>{row.name}</span>
                      </SidebarMenuButton>
                      {off ? (
                        <SidebarMenuBadge className="text-muted-foreground">Off</SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  )}
                </Off>
              ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {links.map((group) => (
        <SidebarGroup key={group.title}>
          <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.rows.map((row) => (
                <SidebarMenuItem key={row.name}>
                  <SidebarMenuButton tooltip={row.name} render={<RowLink href={row.href} />}>
                    <row.icon />
                    <span>{row.name}</span>
                  </SidebarMenuButton>
                  {row.count === "approvals" && waiting ? (
                    <SidebarMenuBadge>{waiting}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
      {/* last: the list moves as agents work, and nothing above it should move with it */}
      {agents}
    </>
  );
}
