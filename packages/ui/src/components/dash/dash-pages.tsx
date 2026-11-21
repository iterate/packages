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
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import type { AuthenticatedApp } from "iterate/app";
import type { Principal } from "iterate/principal";
import { useContextStub } from "iterate/react";
import { servesOf } from "./serves.ts";
import { agentViewHref } from "./dash-href.ts";
import type { ContextListing } from "#/components/context-catalog/context-catalog-rows.ts";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { LoadingWait } from "#/components/virtual-log/read-progress.tsx";
import type { AgentRow } from "#/lib/agent-summary.ts";
import type { OwnPageTool } from "#/lib/page-tools.ts";
import { itxSessionOf, kept } from "#/lib/itx-session.ts";
import { go, linkTo, pageHref, usePageParam, useView } from "#/lib/page-url.ts";
import type { TailsOfMember } from "#/lib/saved-context.ts";
import { savedLogTails } from "#/lib/saved-log-tail.ts";

type Itx = AuthenticatedApp["itx"];

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

/** One page of the Dash: a route `/<id>`, and a row of the sidebar unless `row` is `false`. */
export type DashPage = {
  /** `/<id>`; the first page of the list is `/` (linked from the sidebar header) */
  id: string;
  name: string;
  icon: Icon;
  /** `false`: the page keeps its route `/<id>` and has no sidebar row (listed in `DashSettings`) */
  row?: false;
  /** one-line description shown on `DashSettings` */
  about?: string;
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
  /** The Agents page's: a call on any agent (an iterate agent's chat), as the mind's config has
   *  one (`call.ts`, apps.md "A call on an agent"). The header then has the call's controls, and the
   *  cameras and screens stand over the feed while a call is live. Absent: no call, and no call
   *  code is loaded. */
  call?: DashCall;
  /** The Agents page's, beside `call`: Share in the header of an agent page with a call. It makes
   *  links that let people who are not members into that one agent's chat and call, lists the live
   *  ones (the call's live state) with who came by each, ends one, and makes a calendar invite to
   *  the agent's page or to a link made there. Its first open turns the call on (`call.enable`).
   *  Absent, or without `call`: no Share. */
  share?: DashShare;
  /** The Agents page's: each member's open agent page lends that agent tools that run in the page
   *  (#/components/page-tools.tsx): a banner, and, inside what the page marks with
   *  `data-page-tools="scope"`, Playwright's locators. `tools` adds functions of the page's own.
   *  What the agent then does in a member's tab carries that member's stamp in the log, with an
   *  audit row beside it. Absent: nothing is lent, and no tool code is loaded. */
  pageTools?: true | { tools: Readonly<Record<string, OwnPageTool>> };
  /** `staysOverReconnect`, a property of the component itself (`Notes.staysOverReconnect =
   *  true`): the page opens again what it holds when the session's epoch grows
   *  (`itxSessionOf(itx)`: the epoch in its hooks' deps, or `useHeldContext`), so the Dash keeps
   *  it mounted over a new session, with what it shows. Without it the Dash mounts the page anew
   *  at each new session: a page on the SDK's hooks alone is then never left with a closed
   *  session's stubs. */
  component: ComponentType<DashPageProps> & { staysOverReconnect?: boolean };
};

/** A CALL ON AN AGENT, as a Dash page turns it on. The facet's spec is the mind's config's, which
 *  the kit does not know: `enable` turns the call on for the agent at `path`, at the first press
 *  of the call's controls, and the page then joins it:
 *  `enable: (itx, path) => itx.cd(path).processors.enable("call", { …the config's CALL_FACET })`. */
export type DashCall = {
  enable: (itx: Itx, path: string) => Promise<unknown>;
};

/** LINKS FOR GUESTS TO AN AGENT, as a Dash page turns them on. The links and their rules are the
 *  mind's config's, which the kit does not know: `make` makes a link to the agent at `path` that
 *  lives `lifetimeMs` and answers it once, with its secret in `url` (the page shows it once and
 *  keeps it nowhere); `end` ends one by its id. The live links come from the call's live state. */
export type DashShare = {
  make: (
    itx: Itx,
    path: string,
    lifetimeMs: number,
  ) => Promise<{ url: string; until: number; link: string }>;
  end: (itx: Itx, path: string, link: string) => Promise<unknown>;
};

/** A row that leaves the Dash: another app of the mind, or a page of the stack. `count:
 *  "approvals"` shows how many requests wait for a member's yes beside it. */
export type DashLink = {
  name: string;
  href: string;
  icon: Icon;
  /** one-line description shown on `DashSettings` */
  about?: string;
  count?: "approvals";
};
/** A group of links shown as a section on `DashSettings` (Access, Apps, …). */
export type DashLinks = { title: string; rows: DashLink[] };

/** What the Dash's shell hands every page it draws. */
export type DashPageProps = {
  itx: Itx;
  /** the mind's address, which is its control-plane hostname: `iterate.example.com`. Its sign-in, its
   *  keys and its approvals pages are there. */
  mind: string;
  /** the mind as its owner named it, the Dash's `name` and `logo` (no logo: iterate's mark):
   *  the first face of who is here on an agent's page. Absent: the agent page names the mind by
   *  `mind`. */
  mindFace?: { name: string; logo?: ReactNode };
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

/** Any context of the mind, live: `/contexts/<path>` (`/contexts?contextPath=/` for the root), and the explorer's
 *  own state in `?view`. With no context path the page opens no context: the list, and a note. With
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

/** One repo of the mind as a small IDE: `/repos/<name>` (none: config). It follows the repo's
 *  commits live, so the mind's root is held while the page is up, and opened again at each new
 *  session. The root of the session before stays in hand until then, so the IDE stays, with what
 *  is typed in it; a failure while no session is open is the lost connection's. */
export function DashRepo({ itx, mind, principal }: DashPageProps) {
  const { RepoIde, repoIdeSearchOf } = use(repoPart());
  const name = usePageParam("repo") || "config";
  const { view, setView } = useView();
  // Selecting another file or commit is a navigation (pushState); toggling a pane replaces.
  const onSearchChange = useCallback(
    (patch: Record<string, unknown>) => {
      const next = Object.fromEntries(
        Object.entries({ ...view, ...patch }).filter(([, value]) => value !== undefined),
      );
      const pushes =
        ("file" in patch && patch.file !== view.file) ||
        ("commit" in patch && patch.commit !== view.commit);
      setView(next, !pushes);
    },
    [view, setView],
  );
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
        onSearchChange={onSearchChange}
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
export function DashIntegrations({ itx, mind }: DashPageProps) {
  // asked while the page's part loads
  void servesOf(itx, "integrations");
  const { IntegrationsPage } = use(integrationsPart());
  // one function for the page's life: the kit's page reads again when it is handed another
  const openRegistry = useCallback(() => itx.cd("/integrations"), [itx]);
  // a `call` button's press: one function of the mind's config, by its name, on the page's own
  // `itx` (iterate/integrations `IntegrationCall`, whose schema allows an identifier alone). The
  // cast: `itx.config` is a name the mind lends, so the context's type does not list it; the stub
  // is a capnweb proxy, which pipelines any property and call to the mind, and the answer is read
  // with a schema (`IntegrationCallAnswer`).
  const callConfig = useCallback(
    (name: string, args: unknown[]) =>
      (itx as unknown as { config: Record<string, (...args: unknown[]) => Promise<unknown>> })
        .config[name]!(...args),
    [itx],
  );
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
          <IntegrationsPage
            openRegistry={openRegistry}
            deps={[itx, epoch]}
            callConfig={callConfig}
            mind={mind}
          />
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

function SettingsOffLabel({ itx, serves }: { itx: Itx; serves: string }) {
  return use(servesOf(itx, serves)) ? null : (
    <span className="shrink-0 text-xs text-muted-foreground">Off</span>
  );
}

/** One page listing everything the mind holds: the pages kept off the sidebar (`row: false`) and
 *  each group of `links` (Access, Apps), with one line of explanation and the state the Dash
 *  already holds (`Off` for unserved parts, waiting count for approvals). Edits nothing. */
export function DashSettings({ itx, mind, page, pages, links, waiting }: DashPageProps) {
  const hiddenPages = pages.filter((row) => row.row === false);
  const mindOrigin = mind ? `https://${mind}/` : "";
  return (
    <DashScroll>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 md:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{page.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            These pages show what the mind holds. Each line opens one.
          </p>
        </div>
        {hiddenPages.length > 0 ? (
          <section>
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">This mind</h2>
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              {hiddenPages.map((row) => (
                <a
                  key={row.id}
                  {...linkTo(pageHref(row.id))}
                  className="flex items-center gap-3 px-4 py-3 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <row.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">{row.name}</span>
                    {row.about ? (
                      <span className="block text-xs text-muted-foreground">{row.about}</span>
                    ) : null}
                  </span>
                  {row.serves ? (
                    <Suspense fallback={null}>
                      <SettingsOffLabel itx={itx} serves={row.serves} />
                    </Suspense>
                  ) : null}
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground/60"
                  />
                </a>
              ))}
            </div>
          </section>
        ) : null}
        {links
          .filter((group) => group.rows.length > 0)
          .map((group) => {
            const onMind =
              Boolean(mindOrigin) && group.rows.every((row) => row.href.startsWith(mindOrigin));
            return (
              <section key={group.title}>
                <h2 className="mb-2 text-xs font-medium text-muted-foreground">
                  {group.title}
                  {onMind ? <span className="font-normal"> (pages on {mind})</span> : null}
                </h2>
                <div className="divide-y overflow-hidden rounded-lg border bg-card">
                  {group.rows.map((row) => (
                    <a
                      key={row.name}
                      href={row.href}
                      className="flex items-center gap-3 px-4 py-3 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <row.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground">{row.name}</span>
                        {row.about ? (
                          <span className="block text-xs text-muted-foreground">{row.about}</span>
                        ) : null}
                      </span>
                      {row.count === "approvals" && waiting ? (
                        <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning tabular-nums">
                          {waiting === 1 ? "1 waits" : `${waiting} wait`}
                        </span>
                      ) : null}
                      <ExternalLinkIcon
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground/60"
                      />
                    </a>
                  ))}
                </div>
              </section>
            );
          })}
      </div>
    </DashScroll>
  );
}
DashSettings.staysOverReconnect = true;
