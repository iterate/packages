// dash.tsx — A MIND'S DASH, drawn from lists: `Dash` takes the mind's pages (each a row with its
// id, name, icon and component) and its groups of links (other apps, the stack's pages), and draws
// the shell, the sidebar, the page the URL names and, on every page, what waits for a member's yes.
// ONE list of pages drives the sidebar. A page is any component: the kit's (`DashContexts`,
// `DashRepo`, … in ./dash-pages.tsx; `DashHome` and `DashAgents` in agent-kind-view/dash-agents.tsx)
// or one of the mind's own, which takes the same props (`DashPageProps`).
//
// TWO IDS ARE KNOWN TO THE SHELL, whatever component a row names:
//   agents    the Agents page. The sidebar lists the most recently active agents below the pages
//             and links, and `/agents/<path>` shows that agent there. The
//             catalog on `/agents` is read once, live, for all of them and handed to every page.
//   contexts  the raw view of any context (`/contexts/<path>`).
//
// The URL is the page's (#/lib/page-url.ts): `/<id>` (none: the first page) and the page's own
// keys. The first page of a no-build page loads none of the kit's larger parts: each page loads
// its own when it first draws, and suspends meanwhile.
import "./dash-href.ts";
import {
  Component,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ChevronRightIcon, SquarePenIcon } from "lucide-react";
import type { AuthenticatedApp } from "iterate/app";
import type { Principal } from "iterate/principal";
import { useContextStub, useFacetLiveState } from "iterate/react";
import { servesOf } from "./serves.ts";
import { DashAgentsNav } from "./dash-agents-nav.tsx";
import {
  DashNote,
  DashPlaceholder,
  type DashLink,
  type DashLinks,
  type DashPage,
} from "./dash-pages.tsx";
import { AppShell, AppShellBrand } from "#/components/app-shell.tsx";
import { ApprovalsAlert } from "#/components/approvals-alert.tsx";
import { useContextCatalog } from "#/components/context-catalog/context-catalog-list.tsx";
import { ReconnectingMark } from "#/components/reconnecting-mark.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible.tsx";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "#/components/ui/sidebar.tsx";
import { Toaster } from "#/components/ui/sonner.tsx";
import { agentRowsOf, type AgentRow } from "#/lib/agent-summary.ts";
import { itxSessionOf, kept, type ItxConnection } from "#/lib/itx-session.ts";
import { go, keysOfLink, linkTo, pageHref, useAddress, usePageParam } from "#/lib/page-url.ts";
import { titleWithCount, useWaitingApprovals } from "#/lib/waiting-approvals.ts";

export {
  DashAnalytics,
  DashContexts,
  DashIntegrations,
  DashNote,
  DashPartIsOff,
  DashPlaceholder,
  DashRepo,
  DashScroll,
  DashSecrets,
  type DashCall,
  type DashLink,
  type DashLinks,
  type DashPage,
  type DashPageProps,
} from "./dash-pages.tsx";

type Itx = AuthenticatedApp["itx"];

export function Dash({
  app,
  name,
  logo,
  itx,
  mind,
  principal,
  pages,
  links,
  pinned,
  sidebarDefaultOpen,
}: {
  /** the app's name (fallback when `name` is omitted) */
  app: string;
  /** the mind's name, shown in the sidebar header above `mind`; falls back to `app` */
  name?: string;
  /** the mind's logo, shown in the sidebar header tile; defaults to the iterate mark */
  logo?: ReactNode;
  itx: Itx;
  mind: string;
  /** Who is signed in, when the page knows already. Absent: the Dash draws at once and asks the
   *  mind itself (`itx.whoami()`). Until the answer, the account's place in the sidebar holds a
   *  placeholder and each page gets `principal` undefined, which means not known yet. */
  principal?: Principal | null;
  pages: DashPage[];
  links: DashLinks[];
  /** Rows the mind pins right under New agent, drawn as it is: a link to another place (an
   *  agent's view is `/agents/<path>`, which opens in place). */
  pinned?: DashLink[];
  /** The desktop sidebar for a person who has not toggled it yet: open, or false for the rail of
   *  icons. A page whose HTML draws the frame before the app loads passes what it drew. */
  sidebarDefaultOpen?: boolean;
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
  const address = useAddress();
  const asked = usePageParam("page");
  const agentsPage = pages.find((row) => row.id === "agents");
  // an agent view is the Agents page's, whatever page is named
  const agentParam = usePageParam("agent");
  const agent = (agentsPage && agentParam) || undefined;
  const page = (agent && agentsPage) || pages.find((row) => row.id === asked) || pages[0];
  if (!page) throw new Error("A Dash has at least one page");
  // The first page is the root `/` when addressed by path with no other key (e.g. `/home`).
  const firstPageId = pages[0]?.id;
  useEffect(() => {
    if (firstPageId && asked === firstPageId && address === `/${firstPageId}`)
      go(`/${location.hash}`, true);
  }, [firstPageId, asked, address]);
  const Page = page.component;
  // THE CATALOG OF THE MIND'S CONTEXTS, read once for every page: the Contexts page shows its
  // awake dots and its Recent list. A platform without it rejects and the rows stay undefined.
  const listContexts = useCallback(() => itx.contexts.list({ limit: 500 }), [itx]);
  const catalog = useContextCatalog(listContexts, { of: mind });
  // THE PAGE'S SESSION. The Dash subscribes to it, so the page lives on when a socket closes and
  // a new session opens: the Dash then opens again what it holds itself, and mounts anew each
  // page that does not say that it does the same (`staysOverReconnect`).
  const session = itxSessionOf(itx);
  const connection = useSyncExternalStore(session.subscribe, session.get, session.get);
  const account = useAccount(itx, principal, connection.epoch);
  // THE CATALOG OF THE MIND'S AGENTS, live, for the sidebar and every page
  const agents = useAgentRows(itx, Boolean(agentsPage), connection);
  const homeLink = linkTo(pageHref(undefined));
  return (
    <>
      <AppShell
        app={app}
        mind={mind}
        mindHref={() => pageHref(undefined)}
        switcher={
          <AppShellBrand
            app={name || app}
            line={mind}
            logo={logo}
            href={homeLink.href}
            onClick={homeLink.onClick}
          />
        }
        commandPalette={false}
        nav={
          <DashNav
            itx={itx}
            mind={mind}
            pages={pages}
            links={links}
            pinned={pinned}
            page={page}
            agent={agent}
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
        account={account}
        sidebarDefaultOpen={sidebarDefaultOpen}
        locationKey={address}
      >
        <PageBoundary key={page.id} shows={agent || ""}>
          <Suspense fallback={<DashPlaceholder />}>
            <Page
              // A page on the SDK's hooks alone holds stubs of the session that ended: mounted
              // anew, it opens them on the new one. No page can show a dead session's data.
              key={Page.staysOverReconnect ? "stays" : connection.epoch}
              itx={itx}
              mind={mind}
              principal={account}
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
      <ReconnectingMark itx={itx} />
      <Toaster theme={scheme} />
    </>
  );
}

/** The mind's answer to `whoami()` for one itx, asked once for the page's life, whoever asks:
 *  undefined until it comes. */
type Account = {
  principal: Principal | null | undefined;
  asking: boolean;
  /** How many asks in a row the mind refused: the wait before the next ask grows with it. */
  refused: number;
  listeners: Set<() => void>;
  subscribe(changed: () => void): () => void;
  get(): Principal | null | undefined;
};
const accounts = new WeakMap<object, Account>();
function accountOf(itx: Itx): Account {
  let account = accounts.get(itx);
  if (!account) {
    const listeners = new Set<() => void>();
    const made: Account = {
      principal: undefined,
      asking: false,
      refused: 0,
      listeners,
      subscribe(changed) {
        listeners.add(changed);
        return () => listeners.delete(changed);
      },
      get: () => made.principal,
    };
    account = made;
    accounts.set(itx, account);
  }
  return account;
}

/** Asks the mind who is signed in, unless it has answered or is being asked. A call that fails
 *  leaves the account not known, and is asked again by itself: after 1 s, then 2, 4 and 8 s, then
 *  every 15 s, while a page still listens. So a refusal on an open session (an overloaded mind)
 *  does not leave a page waiting for the account for ever; a new session asks at once. */
function askAccount(itx: Itx, account: Account) {
  // oxlint-disable-next-line iterate/simple-truthiness-check -- undefined is not known yet, null is signed in as someone the app cannot name
  if (account.asking || account.principal !== undefined) return;
  account.asking = true;
  Promise.resolve(itx.whoami())
    .then(
      (who) => {
        account.refused = 0;
        account.principal = who.principal || null;
        for (const changed of account.listeners) changed();
      },
      () => {
        const waitMs = Math.min(1_000 * 2 ** account.refused, 15_000);
        account.refused += 1;
        setTimeout(() => {
          if (account.listeners.size > 0) askAccount(itx, account);
        }, waitMs);
      },
    )
    .finally(() => {
      account.asking = false;
    });
}

/** WHO IS SIGNED IN: `given` when the page knows, else the mind's own answer to `whoami()`.
 *  Undefined until that answer: not known yet. A call that failed is asked again when a session
 *  opens (`epoch`). */
function useAccount(itx: Itx, given: Principal | null | undefined, epoch: number) {
  const account = accountOf(itx);
  const asked = useSyncExternalStore(account.subscribe, account.get, account.get);
  // oxlint-disable-next-line iterate/simple-truthiness-check -- as above: null is an answer
  const told = given !== undefined;
  useEffect(() => {
    if (!told) askAccount(itx, account);
  }, [itx, account, told, epoch]);
  return told ? given : asked;
}

/** The catalog on `/agents`, live: one subscription to its live state, which reads no agent, so
 *  the Dash wakes none. Undefined while it is read; none for a mind without agents. `on` false
 *  holds nothing. A new session (`connection.epoch`) subscribes again, and the last rows that
 *  were read stay until that answers, and when it fails. A failure with no rows ever read is
 *  none, and one while no session is open is the lost connection's, not the catalog's. */
function useAgentRows(itx: Itx, on: boolean, connection: ItxConnection): AgentRow[] | undefined {
  const { epoch } = connection;
  const held = useContextStub(on ? () => itx.cd("/agents") : null, [itx, on, epoch]);
  const live = useFacetLiveState(held.stub, "agents");
  const failed = connection.state === "open" && (Boolean(held.error) || live.status === "error");
  const read = live.value !== undefined;
  const rows = useMemo(() => (read ? agentRowsOf(live.value) : undefined), [read, live.value]);
  // only a list that the catalog answered is kept: a failure's empty one is not the last rows
  const [keep] = useState(() => kept<AgentRow[] | undefined>());
  const last = keep(rows, read, "agents");
  return useMemo(() => last || (failed ? [] : undefined), [last, failed]);
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
      href={link?.href || href}
      onClick={(event) => {
        onClick?.(event);
        link?.onClick(event);
      }}
    />
  );
}

/** What a pinned row's link opens in place: the agent it names, or one of the pages. A link to
 *  any other place (another host, a path of the Dash's own host) is the browser's. */
function inPlaceOf(href: string, pages: DashPage[]) {
  const keys = keysOfLink(href);
  const agent = keys?.get("agent") || undefined;
  const page = keys?.get("page");
  const inPage = Boolean(keys) && (Boolean(agent) || !page || pages.some((row) => row.id === page));
  return { agent, inPage };
}

/** The link to a page of the list: the first one is the Dash's root, `/`. */
function hrefOfPage(pages: DashPage[], page: DashPage) {
  return pageHref(page === pages[0] ? undefined : page.id);
}

/** A page that throws, or whose part did not load, says so in its own place; the sidebar stays. A
 *  browser keeps a module's failed load for the life of the page, so the way out is a reload.
 *  Another page is another boundary (its `key`). On the Agents page `shows` is the open agent's
 *  path: the error is the view's it came from, so another agent, or none, draws again. Nothing is
 *  mounted anew while there is no error, and the page's own `?view=` state is not in `shows`. */
declare global {
  interface Window {
    /** A page's own error capture, when it has one (a mind's `page-errors.js`). */
    reportPageError?: (error: unknown, kind?: string) => void;
  }
}

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
  /** A render error never reaches `window.onerror`. So it goes to the page's own error capture,
   *  when the page has one: a mind's `page-errors.js` sets `window.reportPageError`, and the
   *  error becomes an event of the mind. With no capture, nothing happens. A capture that throws
   *  cannot report its own failure, so that is said in the console, where its line names it. */
  override componentDidCatch(error: unknown) {
    try {
      window.reportPageError?.(error);
    } catch (captureError) {
      console.error("The page's error capture failed; the page's error was not reported.", {
        captureError,
        error,
      });
    }
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

/** The sidebar: "New agent" first, with the rows the mind pins under it, then the pages, then each
 *  group of links. A page whose part the mind does not have stays in its place, muted, with "Off"
 *  beside it. New agent and the pinned rows are plain rows, as the pages' are: a box around a row
 *  reads as "you are here", and New agent is an act, never a place. A pinned row is marked only
 *  while the agent it links to is the open one. */
function DashNav({
  itx,
  mind,
  pages,
  links,
  pinned = [],
  page,
  agent,
  waiting,
  newAgent,
  agents,
}: {
  itx: Itx;
  mind: string;
  pages: DashPage[];
  links: DashLinks[];
  pinned?: DashLink[];
  page: DashPage;
  /** the open agent's path, when an agent's view is shown */
  agent: string | undefined;
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
              render={<RowLink href={`https://${mind}/secrets/approvals`} />}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
      {newAgent || pinned.length > 0 ? (
        // in the icon rail, the same gap below it as between the other groups
        <SidebarGroup className="pb-0 group-data-[collapsible=icon]:pb-2">
          <SidebarGroupContent>
            <SidebarMenu>
              {newAgent ? (
                <SidebarMenuItem>
                  <SidebarMenuButton
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
              ) : null}
              {pinned.map((row) => (
                <SidebarMenuItem key={row.name}>
                  <SidebarMenuButton
                    isActive={!!agent && inPlaceOf(row.href, pages).agent === agent}
                    tooltip={row.name}
                    render={<RowLink href={row.href} inPage={inPlaceOf(row.href, pages).inPage} />}
                  >
                    <row.icon />
                    <span>{row.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {/* the header brand links to pages[0] (Home); with an Agents section, its "View all" is the Agents page's row */}
            {pages
              .filter((row, index) => index > 0 && !(agents && row.id === "agents"))
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
        <DashLinksGroup key={group.title} group={group} waiting={waiting} />
      ))}
      {/* last: the list moves as agents work, and nothing above it should move with it */}
      {agents}
    </>
  );
}

const GROUP_STORAGE_PREFIX = "dash:nav-group:";

/** Persisted open/closed state for a collapsible sidebar link group, falling back to its default. */
function readGroupOpen(title: string, defaultOpen: boolean): boolean {
  try {
    const stored = window.localStorage?.getItem(`${GROUP_STORAGE_PREFIX}${title}`);
    if (stored === "open") return true;
    if (stored === "closed") return false;
  } catch {
    // storage unavailable or blocked: keep the group's default
  }
  return defaultOpen;
}

function writeGroupOpen(title: string, open: boolean) {
  try {
    window.localStorage?.setItem(`${GROUP_STORAGE_PREFIX}${title}`, open ? "open" : "closed");
  } catch {
    // ignore storage errors
  }
}

/** One collapsible link group in the sidebar: forced open in the desktop icon rail so its links
 *  stay reachable, and showing any waiting-approvals count on the label while closed. */
function DashLinksGroup({ group, waiting }: { group: DashLinks; waiting: number | undefined }) {
  const { isMobile, state } = useSidebar();
  const inRail = state === "collapsed" && !isMobile;
  const [open, setOpen] = useState(() => readGroupOpen(group.title, !group.collapsed));
  const badge =
    waiting && group.rows.some((row) => row.count === "approvals") ? waiting : undefined;
  const toggle = (next: boolean) => {
    setOpen(next);
    writeGroupOpen(group.title, next);
  };
  return (
    <Collapsible open={inRail || open} onOpenChange={toggle}>
      <SidebarGroup>
        <SidebarGroupLabel
          render={
            <CollapsibleTrigger
              type="button"
              className="w-full cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            />
          }
        >
          <span>{group.title}</span>
          {!open && !inRail && badge ? (
            <span
              data-group-waiting
              className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sidebar-accent px-1 text-2xs font-medium text-sidebar-accent-foreground tabular-nums"
            >
              {badge}
            </span>
          ) : null}
          <ChevronRightIcon
            className={
              open
                ? "ml-auto rotate-90 transition-transform duration-200"
                : "ml-auto transition-transform duration-200"
            }
          />
        </SidebarGroupLabel>
        <CollapsibleContent>
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
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
