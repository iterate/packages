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
  useState,
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
import {
  DashNote,
  DashPlaceholder,
  type DashLink,
  type DashLinks,
  type DashPage,
} from "./dash-pages.tsx";
import { DashPalette } from "./dash-palette.tsx";
import { AppShell } from "#/components/app-shell.tsx";
import { ApprovalsAlert } from "#/components/approvals-alert.tsx";
import { useContextCatalog } from "#/components/context-catalog/context-catalog-list.tsx";
import { ReconnectingMark } from "#/components/reconnecting-mark.tsx";
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
import { itxSessionOf, kept, type ItxConnection } from "#/lib/itx-session.ts";
import { go, linkTo, pageHref, usePageParam, useSearch } from "#/lib/page-url.ts";
import { titleWithCount, useWaitingApprovals } from "#/lib/waiting-approvals.ts";

export {
  DashAnalytics,
  DashContexts,
  DashIntegrations,
  DashMcp,
  DashNote,
  DashPartIsOff,
  DashPlaceholder,
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
  pinned,
  sidebarDefaultOpen,
}: {
  /** the app's name, on top of the sidebar: "Dash" */
  app: string;
  itx: Itx;
  mind: string;
  /** Who is signed in, when the page knows already. Absent: the Dash draws at once and asks the
   *  mind itself (`itx.whoami()`). Until the answer, the account's place in the sidebar holds a
   *  placeholder and each page gets `principal` undefined, which means not known yet. */
  principal?: Principal | null;
  pages: DashPage[];
  links: DashLinks[];
  /** Rows the mind pins right under New agent, drawn as it is: a link to another place (an
   *  agent's view is `?agent=<path>`, which opens in place). */
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
  // THE PAGE'S SESSION. The Dash subscribes to it, so the page lives on when a socket closes and
  // a new session opens: the Dash then opens again what it holds itself, and mounts anew each
  // page that does not say that it does the same (`staysOverReconnect`).
  const session = itxSessionOf(itx);
  const connection = useSyncExternalStore(session.subscribe, session.get, session.get);
  const account = useAccount(itx, principal, connection.epoch);
  // THE CATALOG OF THE MIND'S AGENTS, live, for the sidebar, ⌘K and every page
  const agents = useAgentRows(itx, Boolean(agentsPage), connection);
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
      href={href}
      onClick={(event) => {
        onClick?.(event);
        link?.onClick(event);
      }}
    />
  );
}

/** The agent a link opens in place (`?agent=<path>`), or null for any other link. */
function agentOfHref(href: string) {
  return href.startsWith("?") ? new URLSearchParams(href).get("agent") : null;
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
              render={<RowLink href={`https://iterate.${mind}/secrets/approvals`} />}
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
                    isActive={!!agent && agentOfHref(row.href) === agent}
                    tooltip={row.name}
                    render={<RowLink href={row.href} inPage={row.href.startsWith("?")} />}
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
