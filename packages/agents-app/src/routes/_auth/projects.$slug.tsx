// registers `itx.agents` on InstalledAppRoots
import type {} from "iterate/agents";
import type { IterateContextApiWith } from "iterate/api";
import { createFileRoute, getRouteApi, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { AuthenticatedApp } from "iterate/app";
import { facetSnapshotOf, useIterateContext } from "iterate/react";
import { AppShell } from "@iterate-com/ui/components/app-shell";
import { ProjectAppFrame } from "@iterate-com/ui/components/project-app-shell";
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
  AgentKindViewFrame,
  useAgentKindViewLink,
  type AgentKindViewVerbs,
} from "@iterate-com/ui/agent-kind-view/host";
import frameScript from "virtual:agent-kind-view-frame";
import { AgentsHome } from "../../components/agents-home.tsx";
import { AgentsNav } from "../../components/agents-nav.tsx";
import type { AgentRow } from "../../lib/agent-summary.ts";
import { useAgentRows } from "../../lib/use-agent-rows.ts";

// The project's agents in the sidebar, and beside them one agent's chat or, with no agent in the
// URL, the home page that starts one. A chat is the agent's KIND's: its view, from
// `agent-kinds/<kind>.ts` in the project's config repo, runs in a sandboxed frame
// (@iterate-com/ui/agent-kind-view), and this page feeds it the agent's live log and does what it asks to
// that one agent. The project stub is held for the page's life; the agent's context is
// `project.cd(path)`.
type ProjectPromise = ReturnType<AuthenticatedApp["api"]["projects"]["get"]>;
type Project = Awaited<ProjectPromise>;
type Context = Awaited<ReturnType<Project["cd"]>>;

/** The project — its stub, or the pipelined one a loader's `read` holds — with its `itx.agents`
 *  root typed (iterate/agents api.ts). The root is there only by the project's rewrite rule, so the
 *  session's project stub cannot name it; the page calls it only where the rule is known to be
 *  there: the loader after reading it, the home page's composer only when the loader found it, the
 *  chat's composer only beside an agent. */
const withAgents = <P extends Project | ProjectPromise>(itx: P) =>
  itx as P & Pick<IterateContextApiWith<"agents">, "agents">;

export const Route = createFileRoute("/_auth/projects/$slug")({
  // THE PAGE IS A LINK: the agent, and the chat's every choice (the tab, the open trace, the Events
  // tab's mode, filter, inspected event and open sheet). A hand-edited value is an absent key,
  // never an error page.
  validateSearch: AgentChatState.extend({ agent: z.string().optional().catch(undefined) }),
  // react-doctor-disable-next-line react-doctor/tanstack-start-loader-parallel-fetch -- each read needs the one before, and a first load's read is one batch that takes no calls after an await (iterate/app `read`)
  loader: async ({ context, params }) => {
    const projects = await context.read((api) => api.projects.list());
    // the URL names the project by slug; one this sign-in lacks → sign in again
    const project = projects.find((item) => item.slug === params.slug);
    if (!project) return context.signInFor(params.slug);
    // a read each: `itx.agents` is called only once the rule that adds it is known to be there
    const rule = await context.read(async (api) => {
      using itx = api.projects.get(project.id);
      return await itx.rewriteRules.get("itx.agents");
    });
    if (!rule?.target) return { projects, project, catalog: null };
    // the catalog is on `/agents` (iterate/agents catalog.ts)
    const catalog = await context.read(async (api) => {
      using itx = api.projects.get(project.id);
      return await facetSnapshotOf(itx.cd("/agents"), "agents");
    });
    return { projects, project, catalog };
  },
  // the project's frame from the URL while the page reads
  pendingComponent: () => <ProjectAppFrame app="Agents" />,
  component: AgentsPage,
});

function AgentsPage() {
  const data = Route.useLoaderData();
  const { agent } = Route.useSearch();
  const { api, info } = Route.useRouteContext();
  const href = useRouterState({ select: (state) => state.location.href });
  // the loader sends a sign-in the project is missing from off to sign in again, so it is here
  const project = data.project.id;
  const installed = Boolean(data.catalog);
  const agents = useAgentRows(api, project, data.catalog);
  return (
    <AppShell
      app="Agents"
      deploymentHome="/projects"
      projects={data.projects}
      activeProjectId={project}
      projectHref={(item) => `/projects/${item.slug}`}
      nav={
        <AgentsNav
          project={project}
          slug={data.project.slug}
          agents={agents}
          installed={installed}
          agent={agent}
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
      account={info.principal}
      locationKey={href}
    >
      {agent ? (
        <AgentKindQueries>
          <AgentConversation
            key={`${project}${agent}`}
            project={project}
            path={agent}
            row={agents.find((row) => row.path === agent)}
          />
        </AgentKindQueries>
      ) : installed ? (
        <AgentsHome
          key={project}
          slug={data.project.slug}
          agents={agents}
          onCreate={async (path) => {
            using itx = await api.projects.get(project);
            await withAgents(itx).agents.create(path);
          }}
          onMessage={async (path, { message, files }) => {
            using itx = await api.projects.get(project);
            await withAgents(itx).agents.get(path).message({ message, files });
          }}
        />
      ) : (
        <NotInstalled slug={data.project.slug} platformOrigin={info.platformOrigin} />
      )}
    </AppShell>
  );
}

const root = getRouteApi("__root__");

/** A project without `itx.agents`: its config repo installs agents (`installAgents(itx)` in its
 *  init case, as the default template does), so the page says so and links to that repo in the
 *  Dash, when this deployment names one. */
function NotInstalled({ slug, platformOrigin }: { slug: string; platformOrigin: string }) {
  const { dashOrigin } = root.useLoaderData();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Agents are not installed</EmptyTitle>
        <EmptyDescription>
          A project&apos;s config repo installs its agents: <code>installAgents(itx)</code> in its
          init case, as the default template does.{" "}
          {dashOrigin ? (
            <a
              href={`${dashOrigin}/.auth/connect?${new URLSearchParams({ issuer: platformOrigin, next: `/projects/${slug}` })}`}
              className="underline underline-offset-2"
            >
              Open the config repo
            </a>
          ) : null}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// ── the agent's log, live ──

/** The agent's context — `project.cd(path)` — held for the page's life: the stub every call
 *  (the composer's `message`, the live states) goes through. Released on unmount AND again after
 *  the connect settles, since an unmount mid-await comes before the handle that await returns. */
function useAgentContext(
  api: AuthenticatedApp["api"],
  project: string,
  path: string,
): { context: Context | undefined; error: string | undefined } {
  const [context, setContext] = useState<Context>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let disposed = false;
    setError(undefined);
    const held: { stub?: Project; agent?: Context } = {};
    const release = () => {
      held.agent?.[Symbol.dispose]();
      held.stub?.[Symbol.dispose]();
      held.agent = held.stub = undefined;
    };
    (async () => {
      held.stub = await api.projects.get(project);
      if (disposed) return;
      const agent = (held.agent = await held.stub.cd(path));
      if (disposed) return;
      // A capnweb stub is a callable proxy: handed to a state setter directly, React would take it
      // for an updater and CALL it (an empty method call the server refuses).
      setContext(() => agent);
    })()
      // the connect itself failing (no such project, no such path, the sign-in gone) is the page's
      // message; what fails after the handle exists is the log hook's
      .catch((e: unknown) => !disposed && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => disposed && release());
    return () => {
      disposed = true;
      release();
      setContext(undefined);
    };
  }, [api, project, path]);
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

/** One agent's chat: its kind's view in a sandboxed frame. The route reads the kind file from the
 *  config repo (the kind is the catalog row's), holds the agent's context, reads it live with what
 *  the ephemeral events its view names (`ephemeralEvents`, which the frame reports once it has loaded the file), and
 *  answers the frame's verbs for this agent alone. The chat's state is this route's search, so
 *  every view of it is a link. */
function AgentConversation({
  project,
  path,
  row,
}: {
  project: string;
  path: string;
  /** Its catalog row, or `undefined` for an agent the catalog doesn't list (yet). */
  row: AgentRow | undefined;
}) {
  const kind = row?.kind || null;
  const { api } = Route.useRouteContext();
  // the project's worker writes where each kind's file is on every publish (the template's
  // iterate/agents/kinds `publishAgentKinds`); a kind with no entry, or an agent with no catalog
  // row yet, shows the Events tab alone, and the row's arrival changes the key
  const kindFile = useQuery({
    queryKey: ["agent-kind", project, kind],
    queryFn: async () => {
      if (!kind) return { path: null, source: null };
      using itx = await api.projects.get(project);
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
      project={project}
      path={path}
      name={kindFile.data.path || `${kind || "unknown"} (no kind file)`}
      source={kindFile.data.source}
    />
  );
}

/** The frame, fed the agent's live log. */
function AgentKindView({
  project,
  path,
  name,
  source,
}: {
  project: string;
  path: string;
  name: string;
  /** The kind file, or `null` when the kind has none: the frame shows the Events tab. */
  source: string | null;
}) {
  const { api } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { slug } = Route.useParams();
  const { context, error } = useAgentContext(api, project, path);
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
        to: "/projects/$slug",
        params: { slug },
        search: (previous) => ({ ...previous, ...patch }),
        replace: true,
      }),
    [navigate, slug],
  );
  const { loading, exhausted } = log.older;
  const older = useMemo(() => (exhausted ? null : { loading, exhausted }), [loading, exhausted]);
  // the chat's state is the search without the agent, the same object while it says the same
  const { agent: _agent, ...searchState } = search;
  const stateKey = JSON.stringify(searchState);
  const state = useMemo(() => JSON.parse(stateKey) as AgentChatState, [stateKey]);
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
    // the page's theme (AgentKindView renders only in the browser: the kind file is read there)
    documentClass: document.documentElement.className,
  };
  // everything the frame may do, to this agent only: never its context stub, whose `invoke` and
  // `cd` reach the whole project
  const verbs: AgentKindViewVerbs = {
    message: async ({ message, files }) => {
      using itx = await api.projects.get(project);
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

/** `agent-kinds` in the project's KV: each kind's file in the config repo. */
const AgentKindPaths = z.record(z.string(), z.string());
