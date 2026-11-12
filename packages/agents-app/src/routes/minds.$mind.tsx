// registers `itx.agents` on InstalledAppRoots
import type {} from "iterate/agents";
import type { IterateContextApiWith } from "iterate/api";
import { createFileRoute, getRouteApi, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { createIterateClient, type AuthenticatedApp, type IterateClient } from "iterate/app";
import { facetSnapshotOf, useIterateContext } from "iterate/react";
import { AppShell } from "@iterate-com/ui/components/app-shell";
import { MindAppFrame, MindAppLoadError } from "@iterate-com/ui/components/mind-app-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@iterate-com/ui/components/ui/breadcrumb";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@iterate-com/ui/components/ui/empty";
import { AgentChatState } from "@iterate-com/ui/components/agent-chat/agent-chat-search";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import type { AgentKindViewInputs } from "@iterate-com/ui/agent-kind-view/bridge";
import {
  AgentKindHiddenFrame,
  AgentKindViewFrame,
  useAgentKindViewLink,
  useAgentKindViewLinks,
  type AgentKindViewVerbs,
} from "@iterate-com/ui/agent-kind-view/host";
import frameScript from "virtual:agent-kind-view-frame";
import { AgentsHome, type NewAgentOffer } from "@iterate-com/ui/components/agents-home";
import { AgentsNav } from "@iterate-com/ui/components/agents-nav";
import { personOf, type AgentRow } from "@iterate-com/ui/lib/agent-summary";
import { useAgentRows } from "../lib/use-agent-rows.ts";

// The mind's agents in the sidebar, and beside them one agent's chat or, with no agent in the
// URL, the home page that starts one. A chat is the agent's KIND's: its view, from
// `agent-kinds/<kind>.ts` in the mind's config repo, runs in a sandboxed frame
// (@iterate-com/ui/agent-kind-view), and this page feeds it the agent's live log and does what it
// asks to that one agent. The URL names the mind by its address (iterate/mind-api); the
// page's `itx` is that mind's root context, held for the page's life, and the agent's context
// is `itx.cd(path)`.
type Itx = AuthenticatedApp["itx"];
type Context = Awaited<ReturnType<Itx["cd"]>>;

/** The mind's root with its `itx.agents` root typed (iterate/agents api.ts). The root is there
 *  only by the mind's rewrite rule, so the stub cannot name it; the page calls it only where the
 *  rule is known to be there: the home page's composer only when the loader found it, the chat's
 *  composer only beside an agent. */
const withAgents = (itx: Itx) => itx as Itx & Pick<IterateContextApiWith<"agents">, "agents">;

/** One client per mind this page has shown, so switching back keeps its connection. */
const clients = new Map<string, IterateClient>();
function clientFor(mind: string) {
  let client = clients.get(mind);
  if (!client) {
    client = createIterateClient({ mind });
    clients.set(mind, client);
  }
  return client;
}

export const Route = createFileRoute("/minds/$mind")({
  // THE PAGE IS A LINK: the agent, its kind until the catalog lists it (one New agent just
  // started), New agent's choice of kind (`new`, `<kind>/<choice>`), and the chat's every choice
  // (the tab, the open trace, the Events tab's mode, filter, inspected event and open sheet). A
  // hand-edited value is an absent key, never an error page.
  validateSearch: AgentChatState.extend({
    agent: z.string().optional().catch(undefined),
    kind: z.string().optional().catch(undefined),
    new: z.string().optional().catch(undefined),
  }),
  // signing in is the browser's: the server's HTML is the frame from the URL (`pendingComponent`),
  // and the page while it signs in and reads
  ssr: false,
  // the mind's sign-in: a browser with none leaves to sign in, or to the connect page
  beforeLoad: ({ params, location }) => clientFor(params.mind).authenticate(location.href),
  // react-doctor-disable-next-line react-doctor/tanstack-start-loader-parallel-fetch -- the second read needs the first, and a first load's read is one batch that takes no calls after an await (iterate/app `read`)
  loader: async ({ context }) => {
    // a read each: `itx.agents` is called only once the rule that adds it is known to be there.
    // The first also asks who is signed in, for the account menu.
    const [rule, who] = await context.read((itx) =>
      Promise.all([itx.rewriteRules.get("itx.agents"), itx.whoami()]),
    );
    const principal = who.principal || null;
    if (!rule?.target) return { catalog: null, principal };
    // the catalog is on `/agents` (iterate/agents catalog.ts)
    const catalog = await context.read(async (itx) => {
      using agents = itx.cd("/agents");
      return await facetSnapshotOf(agents, "agents");
    });
    return { catalog, principal };
  },
  // the tab says which mind, and which agent when one is open (its path is its name)
  head: ({ params, match }) => ({
    meta: [{ title: [match.search.agent, params.mind, "Agents"].filter(Boolean).join(" · ") }],
  }),
  pendingComponent: () => <MindAppFrame app="Agents" />,
  // a sign-in or a first read that failed: the same frame, with what failed and a retry
  errorComponent: ({ error }) => <MindAppLoadError app="Agents" error={error} />,
  component: AgentsPage,
});

function AgentsPage() {
  const data = Route.useLoaderData();
  const { agent, kind, new: choice } = Route.useSearch();
  const { itx } = Route.useRouteContext();
  const { mind } = Route.useParams();
  const href = useRouterState({ select: (state) => state.location.href });
  const installed = Boolean(data.catalog);
  const agents = useAgentRows(itx, data.catalog);
  // the folder of this person's agents, from the address they signed in with
  const person = personOf(data.principal?.email);
  const navigate = useNavigate();
  // the sidebar and the home page import no router: a row is a link to this address, and a plain
  // click on it is a route change here
  const agentHref = useCallback(
    (path: string | undefined) =>
      `/minds/${mind}${path ? `?agent=${encodeURIComponent(path)}` : ""}`,
    [mind],
  );
  const openAgent = useCallback(
    (path: string | undefined) =>
      void navigate({
        to: "/minds/$mind",
        params: { mind },
        search: path ? { agent: path } : {},
      }),
    [navigate, mind],
  );
  return (
    <AppShell
      app="Agents"
      mind={mind}
      mindHref={(address) => `/minds/${address}`}
      nav={
        <AgentsNav
          mind={mind}
          agents={agents}
          person={person}
          installed={installed}
          agent={agent}
          agentHref={agentHref}
          onOpen={openAgent}
        />
      }
      header={
        agent ? (
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:inline-flex">Agents</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:inline-flex" />
              <BreadcrumbItem>
                <BreadcrumbPage className="font-mono">{agent}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        ) : null
      }
      // who the mind's API says is signed in; the menu names the mind when it says nobody
      account={data.principal}
      locationKey={href}
    >
      {agent ? (
        <AgentKindQueries>
          <AgentConversation
            key={`${mind}${agent}`}
            path={agent}
            row={agents.find((row) => row.path === agent)}
            kind={kind}
          />
        </AgentKindQueries>
      ) : installed ? (
        <AgentKindQueries>
          <NewAgentKinds>
            {({ offers, start }) => (
              <AgentsHome
                key={mind}
                agents={agents}
                person={person}
                offers={offers}
                choice={choice}
                onChoice={(next) =>
                  void navigate({
                    to: "/minds/$mind",
                    params: { mind },
                    search: next ? { new: next } : {},
                    replace: true,
                  })
                }
                onStart={start}
                onStarted={(path, started) =>
                  void navigate({
                    to: "/minds/$mind",
                    params: { mind },
                    search: { agent: path, kind: started },
                  })
                }
                agentHref={agentHref}
                onOpen={openAgent}
                onCreate={async (path) => {
                  await withAgents(itx).agents.create(path);
                }}
                onMessage={async (path, { message, files }) => {
                  await withAgents(itx).agents.get(path).message({ message, files });
                }}
              />
            )}
          </NewAgentKinds>
        </AgentKindQueries>
      ) : (
        <NotInstalled mind={mind} />
      )}
    </AppShell>
  );
}

const root = getRouteApi("__root__");

/** A mind without `itx.agents`: its config repo installs agents (`installAgents(itx)` in its
 *  init case, as the default template does), so the page says so and links to the mind in the
 *  Dash, when this deployment names one. */
function NotInstalled({ mind }: { mind: string }) {
  const { dashOrigin } = root.useLoaderData();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Agents are not installed</EmptyTitle>
        <EmptyDescription>
          A mind&apos;s config repo installs its agents: <code>installAgents(itx)</code> in its init
          case, as the default template does.{" "}
          {dashOrigin ? (
            <a href={`${dashOrigin}/minds/${mind}`} className="underline underline-offset-2">
              Open the config repo
            </a>
          ) : null}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// ── the agent's log, live ──

/** The agent's context — `itx.cd(path)` — held for the page's life: the stub every call (the
 *  composer's `message`, the live states) goes through. Released on unmount AND again after the
 *  connect settles, since an unmount mid-await comes before the handle that await returns. */
function useAgentContext(
  itx: Itx,
  path: string,
): { context: Context | undefined; error: string | undefined } {
  const [context, setContext] = useState<Context>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let disposed = false;
    setError(undefined);
    const held: { agent?: Context } = {};
    const release = () => {
      held.agent?.[Symbol.dispose]();
      held.agent = undefined;
    };
    (async () => {
      const agent = (held.agent = await itx.cd(path));
      if (disposed) return;
      // A capnweb stub is a callable proxy: handed to a state setter directly, React would take it
      // for an updater and CALL it (an empty method call the server refuses).
      setContext(() => agent);
    })()
      // the connect itself failing (no such path, the sign-in gone) is the page's
      // message; what fails after the handle exists is the log hook's
      .catch((e: unknown) => !disposed && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => disposed && release());
    return () => {
      disposed = true;
      release();
      setContext(undefined);
    };
  }, [itx, path]);
  return { context, error };
}

/** The kind files the page has read, kept while it is open. */
function AgentKindQueries({ children }: { children: ReactNode }) {
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } }),
    [],
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** New agent's other kinds: each kind file besides iterate's, loaded in a frame no one sees (kind
 *  code runs only in a frame), whose `newAgent` choices are the picker's offers, and which gives
 *  the events that start one. None while the files are read. */
function NewAgentKinds({
  children,
}: {
  children: (kinds: {
    offers: NewAgentOffer[];
    start: (offer: NewAgentOffer, path: string, fields: Record<string, string>) => Promise<void>;
  }) => ReactNode;
}) {
  const { itx } = Route.useRouteContext();
  const { mind } = Route.useParams();
  const files = useQuery({
    queryKey: ["agent-kinds", mind],
    queryFn: async () => {
      const paths = AgentKindPaths.parse(JSON.parse((await itx.kv.get("agent-kinds")) || "{}"));
      const config = itx.repos.get("/repos/config");
      const kinds = await Promise.all(
        Object.entries(paths)
          .filter(([kind]) => kind !== "iterate")
          .map(async ([kind, name]) => ({ kind, name, source: await config.readFile(name) })),
      );
      return kinds.filter((file): file is typeof file & { source: string } => Boolean(file.source));
    },
  });
  const kinds = useMemo(() => files.data || [], [files.data]);
  const { links, loaded } = useAgentKindViewLinks(kinds);
  const offers = useMemo(
    () =>
      kinds.flatMap(({ kind }, index): NewAgentOffer[] => {
        const report = loaded[index];
        const newAgent = report && "newAgent" in report ? report.newAgent : undefined;
        return (newAgent?.choices || []).map((option) => ({
          value: `${kind}/${option.id}`,
          // a choice named as its kind is said once: "claude", not "claude (claude)"
          label: option.label === kind ? option.label : `${option.label} (${kind})`,
          kind,
          choice: option.id,
          // the kind's word that this choice's agents may live in a person's folder
          byPerson: option.byPerson === true,
          // a field may be for some of the kind's choices alone
          fields: (newAgent?.fields || []).filter(
            (field) => !field.choices || field.choices.includes(option.id),
          ),
        }));
      }),
    [kinds, loaded],
  );
  const start = useCallback(
    async (offer: NewAgentOffer, path: string, fields: Record<string, string>) => {
      const link = links[kinds.findIndex(({ kind }) => kind === offer.kind)];
      if (!link) throw new Error(`no kind ${offer.kind}`);
      // the kind's events and the agent's context are asked for at once; if the kind refuses, the
      // context that still opens is let go
      const opening = itx.cd(path);
      const [events, context] = await Promise.all([
        link.startEvents({ choice: offer.choice, fields, path }),
        opening,
      ]).catch(async (error: unknown) => {
        (await opening.catch(() => null))?.[Symbol.dispose]();
        throw error;
      });
      try {
        // the kind's own start events, as a person wrote them; the platform parses each
        await context.append(...(events as Parameters<Context["append"]>));
      } finally {
        context[Symbol.dispose]();
      }
    },
    [itx, kinds, links],
  );
  return (
    <>
      {links.map((link) => (
        <AgentKindHiddenFrame key={link.name} link={link} frameScript={frameScript} />
      ))}
      {children({ offers, start })}
    </>
  );
}

/** One agent's chat: its kind's view in a sandboxed frame. The route reads the kind file from the
 *  config repo (the kind is the catalog row's), holds the agent's context, reads it live with what
 *  the ephemeral events its view names (`ephemeralEvents`, which the frame reports once it has loaded the file), and
 *  answers the frame's verbs for this agent alone. The chat's state is this route's search, so
 *  every view of it is a link. */
function AgentConversation({
  path,
  row,
  kind: kindInUrl,
}: {
  path: string;
  /** Its catalog row, or `undefined` for an agent the catalog doesn't list (yet). */
  row: AgentRow | undefined;
  /** The kind the URL names: an agent New agent just started, until its row says. */
  kind: string | undefined;
}) {
  const kind = row?.kind || kindInUrl || null;
  const { itx } = Route.useRouteContext();
  const { mind } = Route.useParams();
  // the mind's worker writes where each kind's file is on every publish (the template's
  // iterate/agents/kinds `publishAgentKinds`); a kind with no entry, or an agent with no catalog
  // row yet, shows the Events tab alone, and the row's arrival changes the key
  const kindFile = useQuery({
    queryKey: ["agent-kind", mind, kind],
    queryFn: async () => {
      if (!kind) return { path: null, source: null };
      const paths = AgentKindPaths.parse(JSON.parse((await itx.kv.get("agent-kinds")) || "{}"));
      const path = paths[kind];
      if (!path) return { path: null, source: null };
      return { path, source: await itx.repos.get("/repos/config").readFile(path) };
    },
  });
  if (kindFile.error)
    return (
      <p data-type="error" className="px-4 py-2 text-sm text-destructive">
        {kindFile.error.message}
      </p>
    );
  if (kindFile.isPending)
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Spinner className="size-4" /> Reading the agent…
      </div>
    );
  return (
    <AgentKindView
      path={path}
      name={kindFile.data.path || `${kind || "unknown"} (no kind file)`}
      source={kindFile.data.source}
    />
  );
}

/** The frame, fed the agent's live log. */
function AgentKindView({
  path,
  name,
  source,
}: {
  path: string;
  name: string;
  /** The kind file, or `null` when the kind has none: the frame shows the Events tab. */
  source: string | null;
}) {
  const { itx } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { mind } = Route.useParams();
  const { context, error } = useAgentContext(itx, path);
  const { link, loaded } = useAgentKindViewLink(name, source);
  // every durable event (the Events tab is the whole log) and, named, the ephemeral ones the view
  // reads, which a wildcard never matches; nothing until the frame has said which
  const options = useMemo(
    () => ({
      consumes: ["*", ...(loaded && "ephemeralEvents" in loaded ? loaded.ephemeralEvents : [])],
    }),
    [loaded],
  );
  const log = useIterateContext(loaded ? context : undefined, options);
  const onStateChange = useCallback(
    (patch: Partial<AgentChatState>) =>
      void navigate({
        to: "/minds/$mind",
        params: { mind },
        search: (previous) => ({ ...previous, ...patch }),
        replace: true,
      }),
    [navigate, mind],
  );
  const { loading, exhausted } = log.older;
  const older = useMemo(() => (exhausted ? null : { loading, exhausted }), [loading, exhausted]);
  // the chat's state is the search without the agent and the page's other keys, the same object
  // while it says the same
  const { agent: _agent, kind: _kind, new: _new, ...searchState } = search;
  const stateKey = JSON.stringify(searchState);
  const state = useMemo(() => JSON.parse(stateKey) as AgentChatState, [stateKey]);
  const documentClass = useSyncExternalStore(
    subscribeToDocumentClass,
    () => document.documentElement.className,
    () => "",
  );
  const inputs: AgentKindViewInputs = {
    path,
    events: log.events,
    caughtUp: log.caughtUp,
    error: log.error,
    head: log.head,
    older,
    processors: log.processors,
    presence: log.presence,
    liveState: log.liveState,
    hostError: error || (loaded && "error" in loaded ? loaded.error : undefined),
    state,
    // the page's theme, which the frame follows when it changes
    documentClass,
  };
  // everything the frame may do, to this agent only: never its context stub, whose `invoke` and
  // `cd` reach the whole mind
  const verbs: AgentKindViewVerbs = {
    message: async ({ message, files }) => {
      await withAgents(itx).agents.get(path).message({ message, files });
    },
    append: async (events) => {
      if (!context) throw new Error("not connected");
      // the events as a person wrote them; the platform parses each
      await context.append(...(events as Parameters<Context["append"]>));
    },
    fileUrl: async (filePath) => {
      if (!context) throw new Error("not connected");
      if (!filePath.startsWith(`${path}/`)) throw new Error(`${filePath} is not a file of ${path}`);
      return (await context.files.get(filePath).url()).url;
    },
    setState: onStateChange,
    loadOlder: log.older.loadOlder,
  };
  return <AgentKindViewFrame link={link} frameScript={frameScript} inputs={inputs} verbs={verbs} />;
}

/** `agent-kinds` in the mind's KV: each kind's file in the config repo. */
const AgentKindPaths = z.record(z.string(), z.string());

// The class on <html> is the page's theme. It lives outside React, so a component reads it as an
// external store: "" where there is no document, and again whenever the class changes.
function subscribeToDocumentClass(changed: () => void) {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
