// dash-agents.tsx — THE DASH'S AGENT PAGES, for a mind's own no-build Dash: rows of its `pages`
// (components/dash/dash.tsx), with the Dash's props (`DashPageProps`).
//
//   DashHome    a composer that starts a new agent, what waits for the member, and the agents
//               active most recently.
//   DashAgents  the Agents page (its row's id is `agents`): the composer and every agent, or, with
//               `?agent=<path>`, ANY context seen as an agent. iterate's own agents are its chat
//               (`AgentChat`); an agent of a kind with a file of its own (`agent-kinds/<kind>.ts`
//               in the config repo) is that kind's view, in a sandboxed frame (./host.ts). Its
//               header names the path and links to the raw view of the same context. The row's
//               `openers` are what the mind says first in an empty chat.
//
// They live here, out of the shadcn registry, because they host kinds' frames: a registry item may
// not import this folder. Each loads its larger part when it first draws (the composer, the chat),
// and reads the kinds once for the page's life: which kind has which file (the mind's KV,
// `agent-kinds`, which worker.ts writes at every publish), and each file's source.
import {
  Suspense,
  use,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";
import { z } from "zod";
import type { AuthenticatedApp } from "iterate/app";
import { facetSnapshotOf, useContextStub, useIterateContext } from "iterate/react";
import type { AgentKindViewInputs } from "./bridge.ts";
import { appendEvents, messageAgent, startKindAgent, withAgents } from "./dash-agent-calls.ts";
import {
  AgentKindHiddenFrame,
  AgentKindViewFrame,
  useAgentKindViewLink,
  useAgentKindViewLinks,
  type AgentKindViewLink,
  type AgentKindViewVerbs,
} from "./host.ts";
import { AgentChatState } from "#/components/agent-chat/agent-chat-search.ts";
import { AppShellPageHeader } from "#/components/app-shell.tsx";
import { ContextPathText } from "#/components/context-path-text.tsx";
import {
  DashNote,
  DashScroll,
  type DashPage,
  type DashPageProps,
} from "#/components/dash/dash.tsx";
import { agentViewHref, rawViewHref } from "#/components/dash/dash-href.ts";
import { servesOf } from "#/components/dash/serves.ts";
import { agentGroups, findAgents, personOf, type AgentRow } from "#/lib/agent-summary.ts";
import { newAgentOffers, newAgentValues, type NewAgentOffer } from "#/lib/new-agent.ts";
import { go, linkTo, pageHref, usePageParam, useView } from "#/lib/page-url.ts";

type Itx = AuthenticatedApp["itx"];

/** A module, imported the first time a page asks for it and kept: the same promise after. */
function once<T>(load: () => Promise<T>) {
  let loading: Promise<T> | undefined;
  return () => (loading ||= load());
}

const homePart = once(() => import("#/components/agents-home.tsx"));
const chatPart = once(() => import("#/components/agent-chat/agent-chat.tsx"));

// ── the kinds ──

/** A kind of agent with a file of its own: the file's path in the config repo, and its source
 *  (null when it cannot be read: its view then shows the agent's events). */
type KindFile = { kind: string; name: string; source: string | null };

const KindPaths = z.record(z.string(), z.string());

/** Every kind's file, read once for the page's life, whoever asks. No key, or a key that is not
 *  JSON, is no kind. */
const kindFiles = new WeakMap<object, Promise<KindFile[]>>();
function kindFilesOf(itx: Itx): Promise<KindFile[]> {
  let files = kindFiles.get(itx);
  if (!files) {
    files = (async () => {
      const text = await Promise.resolve(itx.kv.get("agent-kinds")).catch(() => null);
      let paths: Record<string, string> = {};
      try {
        paths = KindPaths.safeParse(JSON.parse(text || "{}")).data || {};
      } catch {
        // not JSON: no kind has a file
      }
      const config = itx.repos.get("/repos/config");
      return await Promise.all(
        Object.entries(paths).map(async ([kind, name]) => ({
          kind,
          name,
          source: await Promise.resolve(config.readFile(name)).then(
            (source) => source || null,
            () => null,
          ),
        })),
      );
    })();
    kindFiles.set(itx, files);
  }
  return files;
}

/** THE KIND FRAME'S SCRIPT: one classic file of the build of this package that the page's import
 *  map pins, named by its place in the package. `?raw` asks the module server for the file as it
 *  is, not a module that wraps it. Read once. */
let frameScript: string | undefined;
function frameScriptOfPage(): string {
  if (!frameScript) {
    const map = ImportMap.safeParse(
      JSON.parse(document.querySelector('script[type="importmap"]')?.textContent || "{}"),
    );
    frameScript = `${map.data?.imports["@iterate-com/ui/"] || "/"}dist/agent-kind-view-frame.js?raw`;
  }
  return frameScript;
}
const ImportMap = z.object({ imports: z.record(z.string(), z.string()) });

// ── the pages ──

/** THE HOME: a composer whose first message starts a new agent, what waits for the member, and
 *  the agents active most recently. */
export function DashHome({ itx, mind, principal, pages, agents, waiting }: DashPageProps) {
  // both load at once; the page shows when both are in
  const reading = kindFilesOf(itx);
  const { RecentAgents } = use(homePart());
  const kinds = use(reading);
  const links = useAgentLinks(pages);
  const person = personOf(principal?.email);
  return (
    <DashScroll>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-8 pb-12 md:px-8 md:pt-16">
        <NewAgent itx={itx} mind={mind} person={person} kinds={kinds} links={links} />
        <NeedsYou itx={itx} mind={mind} pages={pages} waiting={waiting} />
        {agents ? (
          // the most recently active, whoever's: no person's agents first
          <RecentAgents agents={agents} {...links} />
        ) : (
          <DashNote waiting>Reading the agents…</DashNote>
        )}
      </div>
    </DashScroll>
  );
}

/** THE AGENTS PAGE: every agent, or one context as an agent (`?agent=<path>`). */
export function DashAgents(props: DashPageProps) {
  const path = usePageParam("agent");
  if (path) return <AgentView key={path} {...props} path={path} />;
  return <AgentsOverview {...props} />;
}

function AgentsOverview({ itx, mind, principal, pages, agents }: DashPageProps) {
  const reading = kindFilesOf(itx);
  const { AllAgents } = use(homePart());
  const kinds = use(reading);
  const links = useAgentLinks(pages);
  const now = useNow(5_000);
  // the agents, not their folders: the count the palette and the list show
  const count = useMemo(() => agents && findAgents(agents, "").length, [agents]);
  // the list that is drawn: an agent at the top for each row, so folders alone draw none
  const groups = useMemo(() => agents && agentGroups(agents), [agents]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 md:px-8">
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <span className="text-sm text-muted-foreground tabular-nums">
            {count === undefined
              ? ""
              : `${count.toLocaleString("en")} ${count === 1 ? "agent" : "agents"}`}
          </span>
        </header>
        <NewAgent
          itx={itx}
          mind={mind}
          person={personOf(principal?.email)}
          kinds={kinds}
          links={links}
        />
        <h2 className="text-sm font-medium text-muted-foreground">Most recently active</h2>
      </div>
      {!agents || !groups ? (
        <DashNote waiting>Reading the agents…</DashNote>
      ) : groups.length ? (
        <AllAgents agents={agents} nowMs={now} className="pb-8" {...links} />
      ) : (
        <p className="mx-auto w-full max-w-3xl px-4 font-readme text-sm text-muted-foreground md:px-8">
          No agents yet. Say something above to start one.
        </p>
      )}
    </div>
  );
}

/** Where an agent's view is (the Agents page for none), and the in-page way to go there. */
function useAgentLinks(pages: DashPage[]) {
  const overview = pages.find((row) => row.id === "agents")?.id;
  return useMemo(() => {
    const agentHref = (path: string | undefined) =>
      path ? agentViewHref(path) : pageHref(overview);
    return { agentHref, onOpen: (path: string | undefined) => go(agentHref(path)) };
  }, [overview]);
}

// ── a new agent ──

/** THE COMPOSER, with the picker of other kinds. Each kind with a file is loaded in a frame no
 *  one sees (a kind's code runs only in a frame), which reports the kind's choices and fields and
 *  makes the events that start one. The choice and the typed fields are the page's `?view`. */
function NewAgent({
  itx,
  mind,
  person,
  kinds,
  links,
}: {
  itx: Itx;
  mind: string;
  person: string | undefined;
  kinds: KindFile[];
  links: ReturnType<typeof useAgentLinks>;
}) {
  const { NewAgentComposer } = use(homePart());
  const others = useMemo(
    () =>
      kinds.flatMap(({ kind, name, source }) =>
        kind !== "iterate" && source ? [{ kind, name, source }] : [],
      ),
    [kinds],
  );
  const { links: frames, loaded } = useAgentKindViewLinks(others);
  const offers = useMemo(
    () =>
      others.flatMap(({ kind }, index) => {
        const report = loaded[index];
        return newAgentOffers(kind, report && "newAgent" in report ? report.newAgent : undefined);
      }),
    [others, loaded],
  );
  const { view, patchView } = useView();
  const { new: choice, fields } = NewAgentView.parse(view);
  const picked = offers.find((offer) => offer.value === choice);
  // what was typed is by kind and field: every kind has a Runner, and one kind's is not another's
  const values = useMemo(
    () => newAgentValues(picked, (name) => fields[`${picked?.kind}/${name}`], person),
    [picked, fields, person],
  );
  const frameOf = (offer: NewAgentOffer) =>
    frames[others.findIndex(({ kind }) => kind === offer.kind)];
  const line = useKindLine(picked && frameOf(picked), picked, values, mind);
  return (
    <>
      {frames.map((frame) => (
        <AgentKindHiddenFrame key={frame.name} link={frame} frameScript={frameScriptOfPage()} />
      ))}
      <NewAgentComposer
        person={person}
        offers={offers}
        offersLoading={others.some((_, index) => !loaded[index])}
        choice={choice}
        values={values}
        line={line}
        onChoice={(next) => patchView({ new: next })}
        onField={(name, value) =>
          picked && patchView({ fields: { ...fields, [`${picked.kind}/${name}`]: value } })
        }
        onStart={async (offer, path, startFields) => {
          const frame = frameOf(offer);
          if (!frame) throw new Error(`no kind ${offer.kind}`);
          await startKindAgent(
            itx,
            path,
            frame.startEvents({ choice: offer.choice, fields: startFields, path }),
          );
        }}
        onStarted={(path, kind) => go(pageHref(undefined, { agent: path, kind }))}
        onCreate={(path) => withAgents(itx).agents.create(path)}
        onMessage={(path, { message, files }) => messageAgent(itx, path, { message, files })}
        {...links}
      />
    </>
  );
}

/** New agent's part of `?view`: the picked choice, and what was typed, by `<kind>/<field>`. */
const NewAgentView = z.object({
  new: z.string().optional().catch(undefined),
  fields: z.record(z.string(), z.string()).catch({}).default({}),
});

/** The kind's line about the choice as typed (`newAgent.describe`), asked of its frame. The line of
 *  the fields as they were stays until the kind has said the new one. */
function useKindLine(
  frame: AgentKindViewLink | undefined,
  picked: NewAgentOffer | undefined,
  values: Record<string, string>,
  mind: string,
) {
  const [line, setLine] = useState<string | null>(null);
  const asked = JSON.stringify(values);
  useEffect(() => {
    if (!frame || !picked) return;
    let current = true;
    frame.describe({ choice: picked.choice, fields: JSON.parse(asked), mind }).then(
      (said) => current && setLine(said),
      () => current && setLine(null),
    );
    return () => {
      current = false;
    };
  }, [frame, picked, asked, mind]);
  return picked ? line : null;
}

// ── what waits for the member ──

/** What needs the member, in a place of one height while it is read: the requests that wait for
 *  their yes (the count the Dash keeps), and each integration whose status asks for them. */
function NeedsYou({
  itx,
  mind,
  pages,
  waiting,
}: Pick<DashPageProps, "itx" | "mind" | "pages" | "waiting">) {
  // read once when the home draws
  const [integrations] = useState(() => integrationsNeedingYou(itx));
  const integrationsPage = pages.find((row) => row.id === "integrations");
  return (
    // one row's room, kept while it is read: the list under it does not move for one thing
    <section aria-labelledby="needs-you" className="flex min-h-22 flex-col gap-3">
      <h2 id="needs-you" className="text-sm font-medium text-muted-foreground">
        Waiting for you
      </h2>
      <Suspense fallback={<p className="font-readme text-sm text-muted-foreground">Looking…</p>}>
        <NeedsYouRows
          integrations={integrations}
          approvals={waiting}
          approvalsHref={`https://iterate.${mind}/secrets/approvals`}
          integrationsHref={integrationsPage && pageHref(integrationsPage.id)}
        />
      </Suspense>
    </section>
  );
}

function NeedsYouRows({
  integrations,
  approvals,
  approvalsHref,
  integrationsHref,
}: {
  integrations: Promise<Attention[]>;
  approvals: number;
  approvalsHref: string;
  integrationsHref: string | undefined;
}) {
  const asking = use(integrations);
  if (!approvals && !asking.length)
    return <p className="font-readme text-sm text-muted-foreground">Nothing waits for you.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {approvals ? (
        <NeedsYouRow
          href={approvalsHref}
          icon={<ShieldAlertIcon aria-hidden className="size-4 shrink-0 text-warning" />}
          title={
            approvals === 1
              ? "1 request waits for your yes"
              : `${String(approvals)} requests wait for your yes`
          }
          text="Your agents wait until you answer."
        />
      ) : null}
      {asking.map((item) => (
        <NeedsYouRow
          key={item.key}
          href={integrationsHref}
          inPage
          icon={
            <TriangleAlertIcon
              aria-hidden
              className={
                item.kind === "error"
                  ? "size-4 shrink-0 text-destructive"
                  : "size-4 shrink-0 text-warning"
              }
            />
          }
          title={item.title}
          text={item.text}
        />
      ))}
    </ul>
  );
}

function NeedsYouRow({
  href,
  inPage,
  icon,
  title,
  text,
}: {
  href: string | undefined;
  inPage?: boolean;
  icon: ComponentProps<"span">["children"];
  title: string;
  text: string | undefined;
}) {
  const body = (
    <>
      {icon}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{title}</span>
        {text ? <span className="truncate text-xs text-muted-foreground">{text}</span> : null}
      </span>
    </>
  );
  const look = "flex items-center gap-3 rounded-lg border px-3 py-2";
  return (
    <li>
      {href ? (
        <a
          {...(inPage ? linkTo(href) : { href })}
          className={`${look} text-inherit no-underline hover:bg-muted/60`}
        >
          {body}
        </a>
      ) : (
        <div className={look}>{body}</div>
      )}
    </li>
  );
}

/** An integration, or one connection of it, whose status asks for the member. */
type Attention = {
  key: string;
  title: string;
  text: string | undefined;
  kind: "attention" | "error";
};

const Status = z.object({
  kind: z.enum(["ok", "attention", "error"]),
  text: z.string().optional(),
});
const Registry = z.object({
  integrations: z
    .record(z.string(), z.looseObject({ title: z.string(), status: Status.optional() }))
    .catch({})
    .default({}),
  connections: z
    .record(z.string(), z.looseObject({ account: z.string(), status: Status.optional() }))
    .catch({})
    .default({}),
});

/** The integrations whose card or connection says "attention" or "error", from one read of the
 *  registry on `/integrations` (the `integration` facet's snapshot). A mind without integrations,
 *  or a read that fails, has none. */
async function integrationsNeedingYou(itx: Itx): Promise<Attention[]> {
  try {
    if (!(await servesOf(itx, "integrations"))) return [];
    const registry = await itx.cd("/integrations");
    let state: unknown;
    try {
      state = (await facetSnapshotOf(registry, "integration")).state;
    } finally {
      registry[Symbol.dispose]();
    }
    const { integrations, connections } = Registry.parse(state);
    const cards = Object.entries(integrations).flatMap(([name, card]) =>
      card.status && card.status.kind !== "ok"
        ? [{ key: name, title: card.title, text: card.status.text, kind: card.status.kind }]
        : [],
    );
    const rows = Object.entries(connections).flatMap(([key, row]) => {
      const card = integrations[key.split("/")[0]!];
      return row.status && row.status.kind !== "ok"
        ? [
            {
              key,
              title: `${card?.title || key.split("/")[0]}: ${row.account}`,
              text: row.status.text,
              kind: row.status.kind,
            },
          ]
        : [];
    });
    return [...cards, ...rows];
  } catch {
    return [];
  }
}

// ── one context as an agent ──

/** ANY CONTEXT AS AN AGENT. Its header names the path and links to the raw view of the same
 *  context. What draws it is its kind's: iterate's chat, or a kind's own view in a frame. */
function AgentView({ itx, pages, page, agents, path }: DashPageProps & { path: string }) {
  const kinds = use(kindFilesOf(itx));
  const kindInUrl = usePageParam("kind");
  const row = agents?.find((agent) => agent.path === path);
  // an agent New agent just started has no row yet: `?kind=` names its kind until it does
  const kind = row?.kind || kindInUrl;
  const file = kind && kind !== "iterate" ? kinds.find((one) => one.kind === kind) : undefined;
  const contexts = pages.find((one) => one.id === "contexts");
  return (
    <>
      <AppShellPageHeader>
        <ContextPathText path={path} truncate className="min-w-0 flex-1 text-sm" />
        {contexts ? (
          <a
            {...linkTo(rawViewHref(contexts.id, path))}
            className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Raw view
          </a>
        ) : null}
      </AppShellPageHeader>
      {file ? (
        <KindChat itx={itx} path={path} file={file} />
      ) : (
        <IterateChat itx={itx} path={path} row={row} opener={page.openers?.[path]} />
      )}
    </>
  );
}

/** Anything said in a chat: by a person, by the agent, or by an opener. Words that raise no turn
 *  (iterate Cloud's handover) are context, not a start. */
const Said = z.union([
  z.object({ type: z.literal("events.iterate.com/agent/message-received") }),
  z.object({
    type: z.literal("events.iterate.com/agent/context-added"),
    payload: z.object({
      role: z.string().refine((role) => role !== "system"),
      llmRequestPolicy: z
        .object({ behaviour: z.string().refine((said) => said !== "dont-trigger-request") })
        .optional(),
    }),
  }),
]);

/** ITERATE'S CHAT for any context: the page holds the context and reads it live. An agent of
 *  another kind that has no file opens on the Events tab: the chat draws an iterate agent's
 *  events. The chat's state is `?view`. */
function IterateChat({
  itx,
  path,
  row,
  opener,
}: {
  itx: Itx;
  path: string;
  row: AgentRow | undefined;
  /** What the mind says first, if the chat is empty: a developer's note, which starts a turn. */
  opener: string | undefined;
}) {
  const { AgentChat } = use(chatPart());
  const { view, patchView } = useView();
  const agent = useContextStub(() => itx.cd(path), [itx, path]);
  const context = useIterateContext(agent.stub, AgentChat.contextOptions);
  const state = AgentChatState.safeParse(view).data || {};
  const shown =
    state.view || !row?.kind || row.kind === "iterate"
      ? state
      : { ...state, view: "events" as const };
  // THE MIND SPEAKS FIRST: once the whole log is read and nothing was said in it, the opener is
  // appended once for the mind (its key), whatever reloads or tabs
  const { stub } = agent;
  const empty =
    context.caughtUp &&
    context.older.exhausted &&
    !context.events.some((event) => Said.safeParse(event).success);
  useEffect(() => {
    if (!opener || !stub || !empty) return;
    stub
      .append({
        type: "events.iterate.com/agent/context-added",
        idempotencyKey: `opener:${path}`,
        payload: { role: "developer", content: opener },
      })
      .catch(() => {}); // another tab said it first, or the chat is not empty after all
  }, [opener, stub, empty, path]);
  return (
    <AgentChat
      path={path}
      context={context}
      error={agent.error}
      state={shown}
      onStateChange={patchView}
      onMessage={async ({ message, files }) => {
        await messageAgent(itx, path, { message, files });
      }}
      onAppend={stub ? (events) => appendEvents(stub, events) : undefined}
      signedUrl={async (file) => {
        if (!stub) throw new Error("not connected");
        return (await stub.files.get(file).url()).url;
      }}
    />
  );
}

/** The page's theme is the class on its root element: the frame follows it when it changes. */
function watchDocumentClass(changed: () => void) {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** AN AGENT OF A KIND THAT BRINGS ITS OWN VIEW. The view is a file of the config repo, which any
 *  member or any member's agent can change, so it does not run in this page: it runs in a
 *  sandboxed frame. The page reads the agent's log live, hands it to the frame, and answers the
 *  frame's few verbs for this one agent. */
function KindChat({ itx, path, file }: { itx: Itx; path: string; file: KindFile }) {
  const { view, patchView } = useView();
  const agent = useContextStub(() => itx.cd(path), [itx, path]);
  const { link, loaded } = useAgentKindViewLink(file.name, file.source);
  // every durable event (the frame's Events tab is the whole log) and, by name, the ephemeral
  // ones the view reads, which a wildcard never matches; nothing until the frame has said which
  const options = useMemo(
    () => ({
      consumes: ["*", ...(loaded && "ephemeralEvents" in loaded ? loaded.ephemeralEvents : [])],
    }),
    [loaded],
  );
  const log = useIterateContext(loaded ? agent.stub : undefined, options);
  const documentClass = useSyncExternalStore(
    watchDocumentClass,
    () => document.documentElement.className,
    () => "",
  );
  const { loading, exhausted } = log.older;
  const older = useMemo(() => (exhausted ? null : { loading, exhausted }), [loading, exhausted]);
  const { stub } = agent;
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
    hostError: agent.error || (loaded && "error" in loaded ? loaded.error : undefined),
    // the chat's own keys checked, and a kind's own keys kept (AgentKindViewState): its controls
    // keep what was picked in them
    state: AgentChatState.loose().safeParse(view).data || {},
    // the page's theme, for the frame's own
    documentClass,
  };
  // everything the frame may do, to this agent alone: never the agent's stub, which reaches the
  // whole mind
  const verbs: AgentKindViewVerbs = {
    message: ({ message, files }) => messageAgent(itx, path, { message, files }),
    append: async (events) => {
      if (!stub) throw new Error("not connected");
      await appendEvents(stub, events);
    },
    fileUrl: async (filePath) => {
      if (!stub) throw new Error("not connected");
      if (!filePath.startsWith(`${path}/`)) throw new Error(`${filePath} is not a file of ${path}`);
      return (await stub.files.get(filePath).url()).url;
    },
    setState: patchView,
    loadOlder: log.older.loadOlder,
  };
  return (
    <AgentKindViewFrame
      link={link}
      frameScript={frameScriptOfPage()}
      inputs={inputs}
      verbs={verbs}
    />
  );
}

/** The time, read again every `everyMs`: what "3 min" is counted from. */
function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
