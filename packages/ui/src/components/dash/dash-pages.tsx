// dash-pages.tsx — THE KIT'S PAGES OF A DASH, each a component that takes the page's props
// (`DashPageProps`: the member's itx, the mind, who is signed in) and does the rest itself: its
// reads, whether the mind serves its part, its state in the URL (../../lib/page-url.ts).
//
// EACH PAGE'S LARGER PART LOADS WHEN THE PAGE FIRST DRAWS, once (`once` below): the overview
// loads none of them, and the repo IDE, the charts and the YAML reader are most of what the kit
// weighs. While a part loads the page suspends, and the Dash's shell shows "Loading the page…". A
// part that did not load stays so for the life of the page (a browser keeps a module's failed
// load), and the shell says so on that page alone.
import {
  Suspense,
  use,
  useCallback,
  useMemo,
  useState,
  startTransition,
  type ComponentType,
  type ReactNode,
} from "react";
import type { AuthenticatedApp } from "iterate/app";
import type { Principal } from "iterate/principal";
import { useContextStub } from "iterate/react";
import { servesOf } from "./serves.ts";
import type { ContextListing } from "#/components/context-catalog/context-catalog-rows.ts";
import { go, pageHref, usePageParam, useView } from "#/lib/page-url.ts";

type Itx = AuthenticatedApp["itx"];

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

/** One page of the Dash: a row of the sidebar, and a card of the overview. */
export type DashPage = {
  /** `?page=<id>`; the first page of the list has none */
  id: string;
  name: string;
  icon: Icon;
  /** the overview's line for it; a page with none has no card (the overview itself) */
  about?: string;
  /** a part that not every stack has (`telemetry`): when the mind does not serve `itx.<serves>`,
   *  the row is muted with "Off" beside it, and its card says `offAbout` */
  serves?: string;
  offAbout?: string;
  component: ComponentType<DashPageProps>;
};

/** A row that leaves the Dash: another app of the mind, or a page of the stack. `count:
 *  "approvals"` shows how many requests wait for a member's yes beside it. */
export type DashLink = {
  name: string;
  href: string;
  icon: Icon;
  about: string;
  count?: "approvals";
};
export type DashLinks = { title: string; rows: DashLink[] };

/** What the Dash's shell hands every page it draws. */
export type DashPageProps = {
  itx: Itx;
  /** the mind's address: `example.com` */
  mind: string;
  /** who is signed in, as the session says */
  principal: Principal | null | undefined;
  /** the page's own row of the list: its id makes its links */
  page: DashPage;
  /** the Dash's lists, for a page that draws them (the overview) */
  pages: DashPage[];
  links: DashLinks[];
  /** the catalog of the mind's contexts, which the Dash reads once for every page (⌘K lists it);
   *  undefined while it loads, and for a mind whose platform has no catalog */
  catalog: readonly ContextListing[] | undefined;
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

/** Any context of the mind, live: `?context=<path>`, and the explorer's own state in `?view`. */
export function DashContexts({ itx, page, catalog }: DashPageProps) {
  const { ContextExplorer, contextPathOf, contextViewStateOf } = use(contextsPart());
  const path = usePageParam("context") || "";
  const { view, patchView } = useView();
  const links = useMemo(
    () => ({
      hrefOf: (to: string) => pageHref(page.id, { context: to === "/" ? undefined : to }),
      onNavigate: (href: string, event: { preventDefault(): void }) => {
        event.preventDefault();
        go(href);
      },
    }),
    [page.id],
  );
  const openRoot = useCallback(() => itx.cd("/"), [itx]);
  return (
    <ContextExplorer
      openRoot={openRoot}
      deps={[itx]}
      path={contextPathOf(path)}
      links={links}
      state={contextViewStateOf(view)}
      onStateChange={patchView}
      catalog={catalog}
    />
  );
}

/** One repo of the mind as a small IDE: `?repo=<name>` (none: config). It follows the repo's
 *  commits live, so the mind's root is held while the page is up. */
export function DashRepo({ itx, mind, principal }: DashPageProps) {
  const { RepoIde, repoIdeSearchOf } = use(repoPart());
  const name = usePageParam("repo") || "config";
  const { view, patchView } = useView();
  const root = useContextStub(() => itx.cd("/"), [itx]);
  if (root.error) return <DashNote alert>{root.error}</DashNote>;
  if (!root.stub) return <DashNote waiting>Opening the mind…</DashNote>;
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
  return (
    <Suspense fallback={<DashNote waiting>Reading the mind…</DashNote>}>
      <IfServed
        itx={itx}
        root="integrations"
        off={<DashPartIsOff title="Integrations">This mind has no integrations yet.</DashPartIsOff>}
      >
        <DashScroll>
          <IntegrationsPage openRegistry={openRegistry} deps={[itx]} mind={mind} />
        </DashScroll>
      </IfServed>
    </Suspense>
  );
}

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

/** How to connect Claude Code or the Codex CLI to the mind: the stack's MCP server. */
export function DashMcp({ mind }: DashPageProps) {
  const { McpConnect } = use(mcpPart());
  return (
    <DashScroll>
      <McpConnect server={`https://iterate.${mind}/mcp`} />
    </DashScroll>
  );
}
