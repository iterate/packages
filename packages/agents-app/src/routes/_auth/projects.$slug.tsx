// registers `itx.agents` on InstalledAppRoots
import type {} from "iterate/agents";
import type { IterateContextApiWith } from "iterate/api";
import {
  createFileRoute,
  getRouteApi,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import type { AuthenticatedApp } from "iterate/app";
import { useIterateContext } from "iterate/react";
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
import {
  AgentChat,
  agentChatContextOptions,
} from "@iterate-com/ui/components/agent-chat/agent-chat";
import { AgentChatState } from "@iterate-com/ui/components/agent-chat/agent-chat-search";
import { AgentsNav } from "../../components/agents-nav.tsx";
import { newWebAgentPath } from "../../lib/web-agent.ts";
import { useAgentSummaries } from "../../lib/use-agent-summaries.ts";

// The project's agents in the sidebar, and one agent's chat (`AgentChat`, whose file says what a
// chat is) beside them. The project stub is held for the page's life; the agent's context is
// `project.cd(path)`.
type ProjectPromise = ReturnType<AuthenticatedApp["api"]["projects"]["get"]>;
type Project = Awaited<ProjectPromise>;
type Context = Awaited<ReturnType<Project["cd"]>>;

/** The project — its stub, or the pipelined one a loader's `read` holds — with its `itx.agents`
 *  root typed (iterate/agents api.ts). The root is there only by the project's rewrite rule, so the
 *  session's project stub cannot name it; the page calls it only where the rule is known to be
 *  there: the loader after reading it, the sidebar's create only when the loader found it, the
 *  composer only beside an agent. */
const withAgents = <P extends Project | ProjectPromise>(itx: P) =>
  itx as P & Pick<IterateContextApiWith<"agents">, "agents">;

export const Route = createFileRoute("/_auth/projects/$slug")({
  // THE PAGE IS A LINK: the agent, and the chat's every choice (the tab, the open trace, the Events
  // tab's mode, filter, inspected event and open sheet). A hand-edited value is an absent key,
  // never an error page.
  validateSearch: AgentChatState.extend({ agent: z.string().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ agent: search.agent }),
  loader: async ({ context, params, deps }) => {
    const projects = await context.read((api) => api.projects.list());
    // the URL names the project by slug; one this sign-in lacks → sign in again
    const project = projects.find((item) => item.slug === params.slug);
    if (!project) return context.signInFor(params.slug);
    // a read each: `itx.agents` is called only once the rule that adds it is known to be there
    const rule = await context.read(async (api) => {
      using itx = api.projects.get(project.id);
      return await itx.rewriteRules.get("itx.agents");
    });
    if (!rule?.target)
      return {
        projects,
        project,
        agents: [],
        agent: undefined,
        installed: false,
      };
    const agents = await context.read(async (api) => {
      using itx = api.projects.get(project.id);
      return await withAgents(itx).agents.list();
    });
    return {
      projects,
      project,
      agents,
      agent: deps.agent || agents[0]?.path,
      installed: true,
    };
  },
  // the project's frame from the URL while the page reads
  pendingComponent: () => <ProjectAppFrame app="Agents" />,
  component: AgentsPage,
});

function AgentsPage() {
  const data = Route.useLoaderData();
  const { api, info } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();
  const href = useRouterState({ select: (state) => state.location.href });
  // the loader sends a sign-in the project is missing from off to sign in again, so it is here
  const project = data.project.id;
  const paths = useMemo(() => data.agents.map((item) => item.path), [data.agents]);
  const summaries = useAgentSummaries(api, project, paths);
  return (
    <AppShell
      app="Agents"
      projects={data.projects}
      activeProjectId={project}
      projectHref={(item) => `/projects/${item.slug}`}
      nav={
        <AgentsNav
          project={project}
          slug={data.project.slug}
          agents={data.agents}
          summaries={summaries}
          installed={data.installed}
          agent={data.agent}
          onCreate={async () => {
            // An agent is its path; a new one is born at this moment's path.
            const path = newWebAgentPath(new Date());
            using itx = await api.projects.get(project);
            await withAgents(itx).agents.create(path);
            await router.invalidate();
            await navigate({
              to: "/projects/$slug",
              params: { slug: data.project.slug },
              search: { agent: path },
            });
          }}
        />
      }
      header={
        data.agent ? (
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:inline-flex">Agents</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:inline-flex" />
              <BreadcrumbItem>
                <BreadcrumbPage className="font-mono">{data.agent}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        ) : null
      }
      account={info.principal}
      locationKey={href}
    >
      {data.agent ? (
        <AgentConversation key={`${project}${data.agent}`} project={project} path={data.agent} />
      ) : data.installed ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No agents yet</EmptyTitle>
            <EmptyDescription>Create one in the sidebar, then talk to it here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
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

/** One agent's chat: the route holds the agent's context and reads it live with the SDK's ONE
 *  `useIterateContext`; `AgentChat` draws everything inside. The chat's state is this route's
 *  search, so every view of it is a link. */
function AgentConversation({ project, path }: { project: string; path: string }) {
  const { api } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { slug } = Route.useParams();
  const { context, error } = useAgentContext(api, project, path);
  const log = useIterateContext(context, agentChatContextOptions);
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
  const signedUrl = useCallback(
    async (filePath: string) => {
      if (!context) throw new Error("not connected");
      return (await context.files.get(filePath).url()).url;
    },
    [context],
  );
  return (
    <AgentChat
      path={path}
      context={log}
      error={error}
      state={search}
      onStateChange={onStateChange}
      onMessage={async ({ message, files }) => {
        using itx = await api.projects.get(project);
        await withAgents(itx).agents.get(path).message({ message, files });
      }}
      onAppend={
        context
          ? // The chat hands over events as a person wrote them (the raw composer's parsed YAML,
            // the Events tab's draft). `append` is typed as the SDK's tuple of inputs, a shape an
            // array cannot spell, and the platform parses each event.
            (events) => context.append(...(events as Parameters<Context["append"]>))
          : undefined
      }
      signedUrl={signedUrl}
    />
  );
}
