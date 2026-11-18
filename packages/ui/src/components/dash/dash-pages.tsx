// dash-pages.tsx — THE KIT'S PAGES OF A DASH, each a component that takes the page's props
// (`DashPageProps`: the member's itx, the mind, who is signed in) and does the rest itself: its
// reads, whether the mind serves its part, its state in the URL (../../lib/page-url.ts).
//
// EACH PAGE'S LARGER PART LOADS WHEN THE PAGE FIRST DRAWS, once (`once` below): the overview
// loads none of them, and the repo IDE, the charts and the YAML reader are most of what the kit
// weighs. While a part loads the page suspends, and the Dash's shell shows quiet shapes in its
// place (`DashPlaceholder`). A part that did not load stays so for the life of the page (a browser
// keeps a module's failed load), and the shell says so on that page alone.
import {
  Suspense,
  use,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  startTransition,
  type ComponentType,
  type ReactNode,
} from "react";
import type { AuthenticatedApp } from "iterate/app";
import { mindMcpUrlOf } from "iterate/mind-api";
import type { Principal } from "iterate/principal";
import { useContextStub } from "iterate/react";
import { servesOf } from "./serves.ts";
import { agentViewHref } from "./dash-href.ts";
import type { ContextListing } from "#/components/context-catalog/context-catalog-rows.ts";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { LoadingWait } from "#/components/virtual-log/read-progress.tsx";
import type { AgentRow } from "#/lib/agent-summary.ts";
import { itxSessionOf, kept } from "#/lib/itx-session.ts";
import { go, linkTo, pageHref, usePageParam, useView } from "#/lib/page-url.ts";
import type { TailsOfMember } from "#/lib/saved-context.ts";
import { savedLogTails } from "#/lib/saved-log-tail.ts";

type Itx = AuthenticatedApp["itx"];

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

/** One page of the Dash: a row of the sidebar. */
export type DashPage = {
  /** `?page=<id>`; the first page of the list has none */
  id: string;
  name: string;
  icon: Icon;
  /** a part that not every stack has (`telemetry`): when the mind does not serve `itx.<serves>`,
   *  the row is muted with "Off" beside it */
  serves?: string;
  /** The Agents page's: what the mind says first in an agent's empty chat, by the agent's path.
   *  The first time anyone opens it, the agent view appends the words as a developer's note,
   *  which starts the agent's first turn (`/agents/onboarding`'s greeting). */
  openers?: Record<string, string>;
  /** The Agents page's: `true` makes each member's open agent chat show who else has it open now
   *  (the platform's rows of their pages), who is typing, and what sharing it means. A page says
   *  its own status in an ephemeral event on the agent's context (nothing durable); the platform
   *  stamps who. Off unless the mind's config turns it on. */
  presence?: boolean;
  /** `staysOverReconnect`, a property of the component itself (`Notes.staysOverReconnect =
   *  true`): the page opens again what it holds when the session's epoch grows
   *  (`itxSessionOf(itx)`: the epoch in its hooks' deps, or `useHeldContext`), so the Dash keeps
   *  it mounted over a new session, with what it shows. Without it the Dash mounts the page anew
   *  at each new session: a page on the SDK's hooks alone is then never left with a closed
   *  session's stubs. */
  component: ComponentType<DashPageProps> & { staysOverReconnect?: boolean };
};

/** A row that leaves the Dash: another app of the mind, or a page of the stack. `count:
 *  "approvals"` shows how many requests wait for a member's yes beside it. */
export type DashLink = {
  name: string;
  href: string;
  icon: Icon;
  count?: "approvals";
};
export type DashLinks = { title: string; rows: DashLink[] };

/** What the Dash's shell hands every page it draws. */
export type DashPageProps = {
  itx: Itx;
  /** the mind's address, which is its control-plane hostname: `iterate.example.com`. Its sign-in, its
   *  keys and its approvals pages are there. */
  mind: string;
  /** who is signed in, as the session says; undefined while the Dash does not know yet (it
   *  draws before the mind has answered), which is not the same as nobody: a page that writes
   *  in the person's name waits for it */
  principal: Principal | null | undefined;
  /** the page's own row of the list: its id makes its links */
  page: DashPage;
  /** the Dash's lists, for a page that draws them (the overview) */
  pages: DashPage[];
  links: DashLinks[];
  /** the catalog of the mind's contexts, which the Dash reads once for every page (⌘K lists it);
   *  undefined while it loads, and for a mind whose platform has no catalog */
  catalog: readonly ContextListing[] | undefined;
  /** the catalog of the mind's agents, live, which the Dash reads once for every page when it has
   *  an Agents page; undefined while it loads, and for a Dash with no Agents page */
  agents: readonly AgentRow[] | undefined;
  /** how many requests wait for a member's yes; undefined until the mind has answered */
  waiting: number | undefined;
};

/** A module, imported the first time a page asks for it and kept: the same promise after. */
function once<T>(load: () => Promise<T>) {
  let loading: Promise<T> | undefined;
  return () => (loading ||= load());
}

const contextsPart = once(() => import("#/components/context-explorer/context-explorer.tsx"));
const repoPart = once(() => import("#/components/repo-ide/repo-ide.tsx"));
const secretsPart = once(() => import("#/components/secrets-page.tsx"));
const integrationsPart = once(() => import("#/components/integrations-page.tsx"));
const analyticsPart = once(() => import("#/components/analytics-page.tsx"));
const mcpPart = once(() => import("#/components/mcp-connect.tsx"));

/** `children` when the mind serves `root`, else `off`. It suspends while the page asks. */
function IfServed({
  itx,
  root,
  off,
  children,
}: {
  itx: Itx;
  root: string;
  off: ReactNode;
  children: ReactNode;
}) {
  return use(servesOf(itx, root)) ? children : off;
}

/** A page that scrolls. */
export function DashScroll({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>;
}

/** One plain line in a page's place: what it waits for, or why it shows nothing. */
export function DashNote({
  children,
  waiting,
  alert,
}: {
  children: ReactNode;
  waiting?: boolean;
  alert?: boolean;
}) {
  return (
    <p
      role={alert ? "alert" : undefined}
      data-spinner={waiting ? "true" : undefined}
      className={alert ? "p-4 text-sm text-destructive" : "p-4 text-sm text-muted-foreground"}
    >
      {children}
    </p>
  );
}

/** A PAGE'S PLACE WHILE ITS PART LOADS: quiet shapes and no words, in the column that a page's
 *  content takes and in the places of the home's parts (its composer, and the heading and first
 *  line of its two sections). A page's HTML can draw the same shapes before the app has loaded, so
 *  that the wait is one state from the first paint: the default config's Dash does (the frame in
 *  its index.html and app.css, which names these numbers). The shapes drawn by HTML alone do not
 *  pulse, and these begin their pulse from the same full shade. */
export function DashPlaceholder() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      data-slot="dash-placeholder"
      className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-8 md:px-8 md:pt-16"
    >
      <LoadingWait />
      <Skeleton className="h-12.5 shrink-0 md:h-14.5" />
      <div className="flex h-22 shrink-0 flex-col gap-5 pt-1">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-48" />
      </div>
      <div className="flex shrink-0 flex-col gap-4 pt-1">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-17" />
      </div>
    </div>
  );
}

/** A page for a part that the mind's stack does not have: its title and one plain line. */
export function DashPartIsOff({ title, children }: { title: string; children: ReactNode }) {
  return (
    <DashScroll>
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </DashScroll>
  );
}

/** The page's connection, live: its epoch goes in the deps of what holds a stub. */
function useConnection(itx: Itx) {
  const session = itxSessionOf(itx);
  return useSyncExternalStore(session.subscribe, session.get, session.get);
}

/** Any context of the mind, live: `?context=<path>` (`?context=/` is the root), and the explorer's
 *  own state in `?view`. With no `?context` the page opens no context: the list, and a note. With
 *  an Agents page, beside the path is the way to the same context in the agent view. */
export function DashContexts({ itx, mind, principal, page, pages, catalog }: DashPageProps) {
  const { ContextExplorer, contextPathOf, contextViewStateOf } = use(contextsPart());
  const tail = usePageParam("context");
  const path = tail ? contextPathOf(tail) : undefined;
  const { view, patchView } = useView();
  const links = useMemo(
    () => ({
      hrefOf: (to: string) => pageHref(page.id, { context: to }),
      onNavigate: (href: string, event: { preventDefault(): void }) => {
        event.preventDefault();
        go(href);
      },
    }),
    [page.id],
  );
  const openRoot = useCallback(() => itx.cd("/"), [itx]);
  // the member's saved rows, once the mind has said who the member is: none are read or saved
  // before, so one member never sees another's
  // not known yet who that is: the store is pending, and the shown context's read waits for it
  const tails: TailsOfMember =
    // oxlint-disable-next-line iterate/simple-truthiness-check -- undefined is not known yet; null is a member the page cannot name
    principal === undefined
      ? "pending"
      : principal?.actor
        ? savedLogTails({ mind, actor: principal.actor })
        : undefined;
  return (
    <ContextExplorer
      openRoot={openRoot}
      deps={[itx]}
      session={itxSessionOf(itx)}
      tails={tails}
      path={path}
      links={links}
      state={contextViewStateOf(view)}
      onStateChange={patchView}
      catalog={catalog}
      empty="Pick a context from the list, or type a path."
      actions={
        path && pages.some((row) => row.id === "agents") ? (
          <a
            {...linkTo(agentViewHref(path))}
            className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Agent view
          </a>
        ) : null
      }
    />
  );
}
// the explorer opens its contexts again at each new session, and keeps what it shows
DashContexts.staysOverReconnect = true;

/** One repo of the mind as a small IDE: `?repo=<name>` (none: config). It follows the repo's
 *  commits live, so the mind's root is held while the page is up, and opened again at each new
 *  session. The root of the session before stays in hand until then, so the IDE stays, with what
 *  is typed in it; a failure while no session is open is the lost connection's. */
export function DashRepo({ itx, mind, principal }: DashPageProps) {
  const { RepoIde, repoIdeSearchOf } = use(repoPart());
  const name = usePageParam("repo") || "config";
  const { view, patchView } = useView();
  const { epoch, state } = useConnection(itx);
  const opened = useContextStub(() => itx.cd("/"), [itx, epoch]);
  const [keep] = useState(() => kept<typeof opened>());
  const root = keep(
    opened,
    Boolean(opened.stub) || (Boolean(opened.error) && state === "open"),
    "root",
  );
  if (root.error) return <DashNote alert>{root.error}</DashNote>;
  // a commit is in the person's name: no IDE before the Dash knows who is signed in
  // oxlint-disable-next-line iterate/simple-truthiness-check -- undefined is not known yet, null is signed in as someone with no address
  if (!root.stub || principal === undefined) return <DashNote waiting>Opening the mind…</DashNote>;
  const email = principal?.email;
  return (
    <div className="flex min-h-0 flex-1">
      <RepoIde
        key={name}
        mind={root.stub}
        mindId={mind}
        repoPath={`/repos/${name}`}
        author={email ? { name: email, email } : undefined}
        search={repoIdeSearchOf(view)}
        onSearchChange={patchView}
      />
    </div>
  );
}
DashRepo.staysOverReconnect = true;

type SecretsList =
  | { secrets: Awaited<ReturnType<Itx["secrets"]["list"]>> }
  | { off: true }
  | { error: string };

/** The list, or why there is none: a mind with no vault yet, or the vault's refusal. */
async function secretsOf(itx: Itx): Promise<SecretsList> {
  try {
    if (!(await itx.rewriteRules.get("itx.secrets"))?.target) return { off: true };
    return { secrets: await itx.secrets.list() };
  } catch (failure) {
    return { error: failure instanceof Error ? failure.message : String(failure) };
  }
}

/** The mind's secrets. The page reads the list, and reads it again after a set or a delete; the
 *  old list stays shown while it does. The sheet's state is `?view`, so New secret and a row's
 *  Update are links: opening one is a new entry in the history, and Back closes it. */
export function DashSecrets({ itx }: DashPageProps) {
  // the page's part starts to load while the list is read
  void secretsPart();
  // held here, above the boundary that waits for it: a page that suspends keeps no state
  const [list, setList] = useState(() => secretsOf(itx));
  const reload = useCallback(() => {
    const next = secretsOf(itx);
    startTransition(() => setList(next));
    return next;
  }, [itx]);
  return (
    <Suspense fallback={<DashNote waiting>Reading the secrets…</DashNote>}>
      <Secrets itx={itx} list={list} reload={reload} />
    </Suspense>
  );
}
// holds nothing of a session: each read and each change is a call through the page's itx
DashSecrets.staysOverReconnect = true;

function Secrets({
  itx,
  list,
  reload,
}: {
  itx: Itx;
  list: Promise<SecretsList>;
  reload: () => Promise<SecretsList>;
}) {
  const { SecretsPage, secretsPageStateOf } = use(secretsPart());
  const { view, setView } = useView();
  const answer = use(list);
  if ("error" in answer) return <DashNote alert>{answer.error}</DashNote>;
  if ("off" in answer) return <DashNote>This mind has no vault for secrets yet.</DashNote>;
  return (
    <DashScroll>
      <SecretsPage
        itx={itx}
        secrets={answer.secrets}
        state={secretsPageStateOf(view)}
        onStateChange={setView}
        onChanged={reload}
      />
    </DashScroll>
  );
}

/** What the mind's packages registered, live from one subscription. */
export function DashIntegrations({ itx }: DashPageProps) {
  // asked while the page's part loads
  void servesOf(itx, "integrations");
  const { IntegrationsPage } = use(integrationsPart());
  // one function for the page's life: the kit's page reads again when it is handed another
  const openRegistry = useCallback(() => itx.cd("/integrations"), [itx]);
  // and at each new session, whose epoch is one of its deps
  const { epoch } = useConnection(itx);
  return (
    <Suspense fallback={<DashNote waiting>Reading the mind…</DashNote>}>
      <IfServed
        itx={itx}
        root="integrations"
        off={<DashPartIsOff title="Integrations">This mind has no integrations yet.</DashPartIsOff>}
      >
        <DashScroll>
          <IntegrationsPage openRegistry={openRegistry} deps={[itx, epoch]} />
        </DashScroll>
      </IfServed>
    </Suspense>
  );
}
DashIntegrations.staysOverReconnect = true;

/** The mind's telemetry. A mind without telemetry is asked nothing: the kit's page says that it
 *  is off, what turns it on and who can. */
export function DashAnalytics({ itx, mind }: DashPageProps) {
  // asked while the page's part loads (the sidebar has asked already)
  void servesOf(itx, "telemetry");
  const { AnalyticsPage, TelemetryOff, telemetryQueryOf } = use(analyticsPart());
  // one query for the page's life: the page reads again when it is handed another
  const query = useMemo(() => telemetryQueryOf(itx), [telemetryQueryOf, itx]);
  return (
    <Suspense fallback={<DashNote waiting>Reading the mind…</DashNote>}>
      <IfServed
        itx={itx}
        root="telemetry"
        off={
          <DashScroll>
            <TelemetryOff mind={mind} />
          </DashScroll>
        }
      >
        <DashScroll>
          <AnalyticsPage query={query} />
        </DashScroll>
      </IfServed>
    </Suspense>
  );
}
// holds nothing of a session: each query is a call through the page's itx
DashAnalytics.staysOverReconnect = true;

/** How to connect Claude Code or the Codex CLI to the mind: the stack's MCP server. */
export function DashMcp({ mind }: DashPageProps) {
  const { McpConnect } = use(mcpPart());
  return (
    <DashScroll>
      <McpConnect server={mindMcpUrlOf(mind)} />
    </DashScroll>
  );
}

// holds nothing of a session
DashMcp.staysOverReconnect = true;
