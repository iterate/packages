// dash-agents.tsx — THE DASH'S AGENT PAGES, for a mind's own no-build Dash: rows of its `pages`
// (components/dash/dash.tsx), with the Dash's props (`DashPageProps`).
//
//   DashHome    a composer that starts a new agent, what waits for the member, and the agents
//               active most recently.
//   DashAgents  the Agents page (its row's id is `agents`): the composer and every agent, or, with
//               `/agents/<path>`, ANY context seen as an agent. iterate's own agents are its chat
//               (`AgentChat`); an agent of a kind with a file of its own (`agent-kinds/<kind>.ts`
//               in the config repo) is that kind's view, in a sandboxed frame (./host.ts). Its
//               header is the kit's one row (components/agent-chat/agent-page-header.tsx): the
//               agent's title and path, who is here and can use the conversation (the mind's
//               face first, always; the people with presence on), the call's controls (with
//               `call` on: ./dash-call.tsx, an iterate agent's chat alone), Share (with `share`
//               on), and Chat | Events. The row's `openers` are what the mind says first in an
//               empty chat.
//
// They live here, out of the shadcn registry, because they host kinds' frames: a registry item may
// not import this folder. Each loads its larger part when it first draws (the composer, the chat),
// and reads the kinds once for the page's life: which kind has which file (the mind's KV,
// `agent-kinds`, which worker.ts writes at every publish), and each file's source.
import {
  createContext,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";
import { z } from "zod";
import type { AuthenticatedApp } from "iterate/app";
import { facetSnapshotOf } from "iterate/react";
import type { AgentKindViewInputs, AgentKindViewLoaded } from "./bridge.ts";
import {
  appendEvents,
  appendTo,
  fileUrl,
  messageAgent,
  storeAgentFiles,
  widgetCallsOf,
  withAgents,
} from "./dash-agent-calls.ts";
import {
  AgentKindStarterFrame,
  AgentKindViewFrame,
  AgentKindViewLink,
  useAgentKindViewLink,
  type AgentKindViewVerbs,
} from "./host.ts";
import {
  defaultKindCandidates,
  defaultKindOf,
  newAgentStartOf,
  sendFirstMessage,
  type DefaultKind,
  type KindFile,
  type KindStarter,
} from "./default-kind.ts";
import { useHeldContext } from "#/hooks/use-itx-session.ts";
import { useHasSavedTail, useSavedContext, type TailsOfMember } from "#/lib/saved-context.ts";
import { AgentChatState } from "#/components/agent-chat/agent-chat-search.ts";
import { AgentReading } from "#/components/agent-chat/agent-reading.tsx";
import {
  AgentPageHeader as AgentPageHeaderOfKit,
  heldRowsOf,
  type AgentPageHeaderProps,
  type MindFace,
} from "#/components/agent-chat/agent-page-header.tsx";
import {
  DashNote,
  DashScroll,
  type DashCall,
  type DashPage,
  type DashPageProps,
  type DashShare,
} from "#/components/dash/dash.tsx";
import { agentViewHref } from "#/components/dash/dash-href.ts";
import { servesOf } from "#/components/dash/serves.ts";
import {
  agentGroups,
  draftOfAddress,
  findAgents,
  newAgentPath,
  personOf,
  type AgentRow,
} from "#/lib/agent-summary.ts";
import { itxSessionOf, keptRead, versionOf, type KeptRead } from "#/lib/itx-session.ts";
import { sameView, savedLogTails, type SavedView } from "#/lib/saved-log-tail.ts";
import { go, hrefOf, linkTo, pageHref, usePageParam, useView } from "#/lib/page-url.ts";

type Itx = AuthenticatedApp["itx"];

/** A module, imported the first time a page asks for it and kept: the same promise after. */
function once<T>(load: () => Promise<T>) {
  let loading: Promise<T> | undefined;
  return () => (loading ||= load());
}

const homePart = once(() => import("#/components/agents-home.tsx"));
const chatPart = once(() => import("#/components/agent-chat/agent-chat.tsx"));
// only where the Agents page's row turns the page's tools on
const toolsPart = once(() => import("#/components/page-tools.tsx"));
// only where the Agents page's row turns calls on: the call's view, who is in it, and Share
const callPart = once(async () => {
  // the two modules load at once
  const people = import("./call-presence.ts");
  const share = import("./dash-share.tsx");
  const { AgentCall } = await import("./dash-call.tsx");
  const { inCallOf } = await people;
  const { AgentShare } = await share;
  return { AgentCall, AgentShare, inCallOf };
});

// ── the kinds ──

const KindPaths = z.record(z.string(), z.string());

/** Every kind's file, read once for the page's life, whoever asks: one promise at every render.
 *  No key, or a key that is not JSON, is no kind, and a file that cannot be read has no source.
 *  Those answers stand. They are read again only when the session they failed with was gone and a
 *  new one has opened (`keptRead`). */
const kindFiles = new WeakMap<object, KeptRead<KindFile[]>>();
/** What each read of the kinds answered, once it has: a view that is drawn already reads it
 *  without suspending. */
const answeredKinds = new WeakMap<Promise<KindFile[]>, KindFile[]>();
function kindFilesOf(itx: Itx): Promise<KindFile[]> {
  const files = keptRead(itx, kindFiles.get(itx), (failed) =>
    (async () => {
      const forget = () => {
        failed();
        return null;
      };
      const text = await Promise.resolve(itx.kv.get("agent-kinds")).catch(forget);
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
            forget,
          ),
        })),
      );
    })(),
  );
  // a new read: its answer is kept for the renders that do not suspend on it
  if (files !== kindFiles.get(itx))
    files.answer.then(
      (kinds) => void answeredKinds.set(files.answer, kinds),
      () => {},
    );
  kindFiles.set(itx, files);
  return files.answer;
}

/** The kinds of `itx`, or undefined while they are read. Never suspends: the view drawn from what
 *  the page remembered stays the same element when they come. */
function useKindFiles(itx: Itx) {
  const files = kindFilesOf(itx);
  const subscribe = useCallback(
    (changed: () => void) => {
      let current = true;
      // a read that fails is `use`'s to throw: here it only leaves the view as it is
      files.then(
        () => {
          if (current) changed();
        },
        () => {},
      );
      return () => {
        current = false;
      };
    },
    [files],
  );
  return { files, kinds: useSyncExternalStore(subscribe, () => answeredKinds.get(files)) };
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
  const { RecentAgents } = use(homePart());
  const links = useAgentLinks(pages);
  return (
    <DashScroll>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-8 pb-12 md:px-8 md:pt-16">
        <NewAgent itx={itx} principal={principal} links={links} />
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
// holds nothing of a session: the composer's draft stays over a new one
DashHome.staysOverReconnect = true;

/** THE AGENTS PAGE: every agent, or one context as an agent (`/agents/<path>`). */
export function DashAgents(props: DashPageProps) {
  const path = usePageParam("agent");
  if (path) return <AgentView key={path} {...props} path={path} />;
  return <AgentsOverview {...props} />;
}
// an agent view holds its context with `useHeldContext` and keeps its rows (`useSavedContext`)
DashAgents.staysOverReconnect = true;

function AgentsOverview({ itx, principal, pages, agents }: DashPageProps) {
  const { AllAgents } = use(homePart());
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
        <NewAgent itx={itx} principal={principal} links={links} />
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

/** THE COMPOSER whose first message starts a new agent, in the folder of the person signed in: an
 *  iterate agent, or an agent of the mind's default kind (default-kind.ts). While the Dash does
 *  not know yet who that is (`principal` undefined), a first message asks the mind before the
 *  agent is born: no agent lands outside its person's folder because the page drew before the
 *  account was there. */
function NewAgent({
  itx,
  principal,
  links,
}: {
  itx: Itx;
  principal: DashPageProps["principal"];
  links: ReturnType<typeof useAgentLinks>;
}) {
  const { NewAgentComposer } = use(homePart());
  const { frames, resolve, chosen } = useDefaultKind(itx);
  // the draft that the address brought (`#draft=`), read once: the box holds it, unsent
  const [initialDraft] = useState(() => draftOfAddress(globalThis.location?.hash));
  return (
    <>
      {frames}
      <NewAgentComposer
        initialDraft={initialDraft}
        person={
          // oxlint-disable-next-line iterate/simple-truthiness-check -- undefined is not known yet, null is signed in as someone with no address
          principal === undefined
            ? async () => personOf((await itx.whoami()).principal?.email)
            : personOf(principal?.email)
        }
        pathFor={async (person, date) => {
          const found = await resolve();
          if (!found) return newAgentPath("web", date, person);
          const start = newAgentStartOf(found, person, date);
          chosen.set(start.path, { found, start });
          return start.path;
        }}
        onCreate={async (path) => {
          const kind = chosen.get(path);
          if (!kind) return await withAgents(itx).agents.create(path);
          await appendTo(itx, path, await kind.found.starter.start(kind.start));
        }}
        onMessage={(path, { message, files }) =>
          chosen.has(path)
            ? sendFirstMessage(
                path,
                { message, files },
                {
                  storeFiles: (at, stored) => storeAgentFiles(itx, at, stored),
                  append: (at, events) => appendTo(itx, at, events),
                },
              )
            : messageAgent(itx, path, { message, files })
        }
        {...links}
      />
    </>
  );
}

/** THE MIND'S DEFAULT KIND, for New agent: a hidden starter frame for each kind file that may be
 *  it (default-kind.ts), the way to find it when a first message is sent, and the kind each new
 *  path was born of. A link is kept for each file and source, so its frame loads once. */
function useDefaultKind(itx: Itx) {
  const { files, kinds } = useKindFiles(itx);
  const [links] = useState(() => new Map<string, AgentKindViewLink>());
  const [chosen] = useState(
    () => new Map<string, { found: DefaultKind; start: ReturnType<typeof newAgentStartOf> }>(),
  );
  const linkOf = useCallback(
    (file: KindFile) => {
      const key = `${file.name}\n${file.source || ""}`;
      const held = links.get(key);
      if (held) return held;
      const link = new AgentKindViewLink(file.name, file.source);
      links.set(key, link);
      return link;
    },
    [links],
  );
  const candidates = useMemo(() => defaultKindCandidates(kinds || []), [kinds]);
  const frames = candidates.map((file) => (
    <AgentKindStarterFrame key={file.name} link={linkOf(file)} frameScript={frameScriptOfPage()} />
  ));
  const resolve = useCallback(async () => {
    const read = await files.catch((): KindFile[] => []);
    return defaultKindOf(defaultKindCandidates(read).map((file) => starterOf(file, linkOf(file))));
  }, [files, linkOf]);
  return { frames, resolve, chosen };
}

/** A starter frame's link as default-kind.ts reads it. */
function starterOf(file: KindFile, link: AgentKindViewLink): KindStarter {
  return {
    file,
    loaded: link.loaded,
    subscribe: link.subscribe,
    start: (input) => link.start(input),
  };
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
      <Suspense fallback={<Looking />}>
        <NeedsYouRows
          integrations={integrations}
          approvals={waiting}
          approvalsHref={`https://${mind}/secrets/approvals`}
          integrationsHref={integrationsPage && pageHref(integrationsPage.id)}
        />
      </Suspense>
    </section>
  );
}

/** The line in the section's place while it is read. */
function Looking() {
  return <p className="font-readme text-sm text-muted-foreground">Looking…</p>;
}

function NeedsYouRows({
  integrations,
  approvals,
  approvalsHref,
  integrationsHref,
}: {
  integrations: Promise<Attention[]>;
  /** Undefined until the mind has answered: nothing is said of what waits before that. */
  approvals: number | undefined;
  approvalsHref: string;
  integrationsHref: string | undefined;
}) {
  const asking = use(integrations);
  if (approvals === undefined) return <Looking />;
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

/** ANY CONTEXT AS AN AGENT. Its header is one row: the agent's title and path, and Chat | Events,
 *  which the view under it draws no strip for (its status is a line at the feed's foot). What
 *  draws it is its kind's: iterate's chat, or a kind's own view in a frame. One loading state
 *  stands from the first paint to the view's own, under a header of the same shape whose tabs
 *  cannot be pressed yet: the kinds, the catalog and the chat's part are all read behind it. When
 *  the member's store remembers the view that drew the saved rows, that view is drawn at once,
 *  and the kinds and the catalog only correct it. */
function AgentView({
  itx,
  mind,
  mindFace,
  principal,
  page,
  agents,
  path,
}: DashPageProps & { path: string }) {
  // the mind's own face in the header, named by its hostname where the Dash has no name for it
  const face = useMemo(() => mindFace || { name: mind }, [mindFace, mind]);
  // the member's saved rows, once the mind has said who the member is: none are read or saved
  // before, so one member never sees another's
  // not known yet who that is: the store is pending, and the view's read waits for it
  const tails: TailsOfMember =
    // oxlint-disable-next-line iterate/simple-truthiness-check -- undefined is not known yet; null is a member the page cannot name
    principal === undefined
      ? "pending"
      : principal?.actor
        ? savedLogTails({ mind, actor: principal.actor })
        : undefined;
  // Saved rows of this log wait for the view: the page then says nothing of a read, because
  // none holds the reader up. It says so only once the store has answered that it has none.
  const saved = useHasSavedTail(tails, path);
  const quiet = saved !== false;
  // The view that drew the saved rows, from the member's own store alone. The store has answered
  // when `saved` is known, so its memory holds the view.
  const remembered = saved && tails && tails !== "pending" ? tails.peek(path)?.view : undefined;
  return (
    <PageMind value={face}>
      <Suspense
        fallback={
          <AgentPageReading
            path={path}
            agents={agents}
            quiet={quiet}
            presence={Boolean(page.presence)}
            call={Boolean(page.call)}
            share={Boolean(page.call && page.share)}
          />
        }
      >
        <AgentViewOfKind
          itx={itx}
          path={path}
          agents={agents}
          opener={page.openers?.[path]}
          presence={Boolean(page.presence)}
          call={page.call}
          share={page.call ? page.share : undefined}
          me={principal?.actor}
          tails={tails}
          quiet={quiet}
          remembered={remembered}
        />
      </Suspense>
      {page.pageTools && principal ? (
        <AgentPageTools
          itx={itx}
          path={path}
          me={principal}
          agent={
            agents?.find((row) => row.path === path)?.title ||
            path.split("/").findLast(Boolean) ||
            path
          }
          tools={page.pageTools === true ? undefined : page.pageTools.tools}
        />
      ) : null}
    </PageMind>
  );
}

/** The tools this page lends the agent it shows (the Agents page's `pageTools`). They load beside
 *  the chat and never hold it up: their part is asked for after the page has drawn, and a part
 *  that does not load lends nothing and says so in the console. `open(path)` changes the Dash's
 *  page in place. */
function AgentPageTools(props: Omit<ComponentProps<PageToolsPart["PageTools"]>, "onOpen">) {
  const [part, setPart] = useState<PageToolsPart>();
  useEffect(() => {
    toolsPart().then(setPart, (error: unknown) =>
      console.error({
        event: "page-tools.load-failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }, []);
  return part ? <part.PageTools {...props} onOpen={go} /> : null;
}
type PageToolsPart = Awaited<ReturnType<typeof toolsPart>>;

/** The mind of the agent page: the first face of the stack of who is here, in its header and in
 *  the chat's. */
const PageMind = createContext<MindFace | undefined>(undefined);

/** The kit's agent page header, with the mind's face. */
function AgentPageHeader(props: Omit<AgentPageHeaderProps, "mind">) {
  return <AgentPageHeaderOfKit {...props} mind={use(PageMind)} />;
}

/** The page while it does not know yet which view the agent has: the header, and the chat's
 *  loading line where the first row will stand. */
function AgentPageReading({
  path,
  agents,
  quiet,
  presence,
  call,
  share,
}: {
  path: string;
  agents: readonly AgentRow[] | undefined;
  /** Saved rows wait for the view: no loading line (`AgentReading`). */
  quiet: boolean;
  /** The header keeps the place of who is here and can use the conversation. */
  presence: boolean;
  /** The header draws the call's controls, which cannot be pressed yet. */
  call: boolean;
  /** The header draws Share, which cannot be pressed yet. */
  share: boolean;
}) {
  return (
    <>
      <AgentPageHeader path={path} agents={agents} presence={presence} call={call} share={share} />
      <AgentReading strip={false} quiet={quiet} />
    </>
  );
}

/** The view of the agent's kind. With none remembered, none until the catalog has said the kind:
 *  iterate's chat over the log of another kind holds no row, and would say that nothing was said.
 *  A remembered view is drawn at once, and stays the same element when the kinds and the catalog
 *  say the same view; when they say another, that one is mounted in its place. A path that the
 *  catalog does not list draws as iterate's. */
function AgentViewOfKind({
  itx,
  path,
  agents,
  opener,
  presence,
  call,
  share,
  me,
  tails,
  quiet,
  remembered,
}: Pick<DashPageProps, "itx" | "agents"> & {
  path: string;
  opener: string | undefined;
  /** The page shows who else has the agent's conversation open (the Agents page's `presence`). */
  presence: boolean;
  /** The Agents page's `call`: an iterate agent's chat has the call's controls. */
  call: DashCall | undefined;
  /** The Agents page's `share`, where `call` is on too: Share beside the call's controls. */
  share: DashShare | undefined;
  me: string | undefined;
  tails: TailsOfMember;
  quiet: boolean;
  /** The view that drew the saved rows of `path`, in the member's own store. */
  remembered: SavedView | undefined;
}) {
  const { files, kinds } = useKindFiles(itx);
  // the view the mind's answer says, once the kinds and the catalog have both answered
  const said = useMemo(() => kinds && agents && viewOf(path, agents, kinds), [path, agents, kinds]);
  // What is drawn, and its mount: a view the mind's answer changes is another element.
  const [drawn, setDrawn] = useState<{ view: SavedView; mount: number } | undefined>();
  const shown = drawn || (remembered && { view: remembered, mount: 0 });
  const next =
    said && !(shown && sameView(shown.view, said))
      ? { view: said, mount: (shown?.mount ?? 0) + 1 }
      : shown;
  if (next !== drawn) setDrawn(next);
  // the mind's answer replaces the saved view, so the next reload mounts it
  useEffect(() => {
    if (said && tails && tails !== "pending") tails.saveView(path, said);
  }, [said, tails, path]);
  if (!next) {
    // nothing to draw yet: the kinds are waited for as the page waits for the chat's part
    use(files);
    return (
      <AgentPageReading
        path={path}
        agents={agents}
        quiet={quiet}
        presence={presence}
        call={Boolean(call)}
        share={Boolean(share)}
      />
    );
  }
  const { view, mount } = next;
  return view.file ? (
    <KindChat
      key={mount}
      itx={itx}
      path={path}
      file={view.file}
      agents={agents}
      presence={presence}
      call={Boolean(call)}
      share={Boolean(share)}
      me={me}
      tails={tails}
    />
  ) : (
    <IterateChat
      key={mount}
      itx={itx}
      path={path}
      kind={view.kind}
      agents={agents}
      opener={opener}
      presence={presence}
      call={call}
      share={share}
      me={me}
      tails={tails}
    />
  );
}

/** The view that the catalog and the kinds say for `path`. */
function viewOf(path: string, agents: readonly AgentRow[], kinds: KindFile[]): SavedView {
  // a row with no kind, and a path with no row, are drawn alike: as iterate's
  const kind = agents.find((agent) => agent.path === path)?.kind || undefined;
  const file = kind && kind !== "iterate" ? kinds.find((one) => one.kind === kind) : undefined;
  return { kind, file: file && { name: file.name, source: file.source } };
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
 *  events. The chat's state is `?view`. Drawn from a remembered view, the catalog may not have
 *  answered yet: the header then has no title, and `kind` is the remembered one. */
function IterateChat({
  itx,
  path,
  kind,
  agents,
  opener,
  presence,
  call,
  share,
  me,
  tails,
}: {
  itx: Itx;
  path: string;
  /** The agent's kind; undefined for a path that the catalog does not list. */
  kind: string | undefined;
  agents: readonly AgentRow[] | undefined;
  /** What the mind says first, if the chat is empty: a developer's note, which starts a turn. */
  opener: string | undefined;
  /** The chat shows who else is here, and says the page's own status. */
  presence: boolean;
  /** The agent's call: its controls in the header, its tiles over the feed. */
  call: DashCall | undefined;
  /** Links for guests: Share beside the call's controls. */
  share: DashShare | undefined;
  /** The signed-in member's actor id: their own messages have no line under them. */
  me: string | undefined;
  tails: TailsOfMember;
}) {
  // the call's part loads beside the chat's, behind the same loading state
  const calling = call && callPart();
  const { AgentChat } = use(chatPart());
  const callKit = calling && use(calling);
  // the header's place for the call's controls, once the header has drawn it
  const [callIn, setCallIn] = useState<HTMLElement | null>(null);
  // Share's place in the header, once the header has drawn it
  const [shareIn, setShareIn] = useState<HTMLElement | null>(null);
  const { view, patchView } = useView();
  // `call=join`: the page was opened to join the call (a Mac's Accept opens it so)
  const joinOnArrival = usePageParam("call") === "join";
  // the header's place for who is here and can use the conversation, once the header has drawn it
  const [aside, setAside] = useState<HTMLElement | null>(null);
  // held and read again at each new session: the rows of the last one, or of the last page load,
  // stay until then
  const session = itxSessionOf(itx);
  const agent = useHeldContext(session, () => itx.cd(path), [itx, path]);
  const context = useSavedContext({
    held: agent,
    options: AgentChat.contextOptions,
    path,
    session,
    tails,
  });
  const state = AgentChatState.safeParse(view).data || {};
  const shown =
    state.view || !kind || kind === "iterate" ? state : { ...state, view: "events" as const };
  // THE MIND SPEAKS FIRST: once the whole log is read and nothing was said in it, the opener is
  // appended once for the mind (its key), whatever reloads or tabs. Never by a saved copy: it may
  // be of a log made again under the same path, and only the mind's answer says it is empty.
  const { stub } = agent;
  // one function while `itx` is the same: each mounted row and attachment keeps its signed URL
  const signedUrl = useCallback((file: string) => fileUrl(itx, file), [itx]);
  const empty =
    !context.savedCopy &&
    context.caughtUp &&
    context.older.exhausted &&
    !context.events.some((event) => Said.safeParse(event).success);
  const callLive = context.liveState.call?.value;
  // one function while the agent is the same: Share turns the call on at most once by it
  const enableCall = useCallback(() => call!.enable(itx, path), [call, itx, path]);
  const widgetCalls = useMemo(() => widgetCallsOf(itx, path), [itx, path]);
  const inCall = useMemo(() => callKit && callKit.inCallOf(callLive), [callKit, callLive]);
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
    <>
      <AgentPageHeader
        path={path}
        agents={agents}
        tabs={{
          view: shown.view,
          hasChat: true,
          // no count until the first read has answered
          held: context.caughtUp || context.events.length ? heldRowsOf(context.events) : undefined,
          wholeLogHeld: context.older.exhausted,
          onStateChange: patchView,
        }}
        presence={presence}
        aside={setAside}
        call={Boolean(call)}
        callIn={setCallIn}
        share={Boolean(share)}
        shareIn={setShareIn}
      />
      {call && share && callKit ? (
        <callKit.AgentShare
          share={share}
          itx={itx}
          path={path}
          title={agents?.find((row) => row.path === path)?.title || path.split("/").at(-1) || path}
          pageUrl={new URL(agentViewHref(path), location.href).href}
          context={context}
          enable={enableCall}
          shareIn={shareIn}
        />
      ) : null}
      {call && callKit ? (
        <callKit.AgentCall
          stub={stub}
          context={context}
          enable={() => call.enable(itx, path)}
          barIn={callIn}
          joinOnArrival={joinOnArrival}
          arrived={leaveTheJoinKey}
        />
      ) : null}
      <AgentChat
        path={path}
        context={context}
        error={agent.error}
        state={shown}
        onStateChange={patchView}
        tabsInHeader
        asideIn={aside}
        onMessage={async ({ message, files, key }) => {
          await messageAgent(itx, path, { message, files }, key);
        }}
        onAppend={stub ? (events) => appendEvents(stub, events) : undefined}
        signedUrl={signedUrl}
        me={me}
        presence={presence}
        inCall={inCall}
        mind={use(PageMind)}
        widgetCalls={widgetCalls}
      />
    </>
  );
}

/** The join on arrival began: `call=join` leaves the address, in place. */
function leaveTheJoinKey() {
  go(hrefOf({ call: undefined }), true);
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
 *  frame's few verbs for this one agent. The frame is another document, which loads its script and
 *  the kind's file before it draws: the page's own loading state stands over it until the frame
 *  has loaded and the first read has answered, so the wait is one state, whatever the kind's view
 *  draws meanwhile. */
function KindChat({
  itx,
  path,
  file,
  agents,
  presence,
  call,
  share,
  me,
  tails,
}: {
  itx: Itx;
  path: string;
  /** The kind's file: a view of another file is another frame (`AgentViewOfKind` keys it). */
  file: { name: string; source: string | null };
  agents: readonly AgentRow[] | undefined;
  /** The page shows who else is here, for a view that draws AgentChat. */
  presence: boolean;
  /** The header keeps the call's place as the loading header had it, and empty: a kind's own view
   *  has no call controls. */
  call: boolean;
  /** The header keeps Share's place, empty, as the call's. */
  share: boolean;
  /** The signed-in member's actor id, for a view that draws AgentChat. */
  me: string | undefined;
  tails: TailsOfMember;
}) {
  const { view, patchView } = useView();
  const session = itxSessionOf(itx);
  const agent = useHeldContext(session, () => itx.cd(path), [itx, path]);
  const { link, loaded } = useAgentKindViewLink(file.name, file.source);
  const load = useMemo(() => frameLoadOf(loaded), [loaded]);
  // every durable event (the frame's Events tab is the whole log) and, by name, the ephemeral
  // ones the view reads, which a wildcard never matches; nothing until the frame has said which
  const options = useMemo(
    () => ({ consumes: ["*", ...load.ephemeralEvents] }),
    [load.ephemeralEvents],
  );
  // read again at each new session: the frame keeps the rows of the last one, or of the last page
  // load, until then. The saved rows are in `inputs` from the first render, and the link sends
  // the latest inputs when the frame says it is ready (`AgentKindViewLink.push`): the frame
  // draws them with its first message.
  const log = useSavedContext({
    held: { stub: loaded ? agent.stub : undefined, error: agent.error },
    options,
    path,
    session,
    tails,
  });
  const documentClass = useSyncExternalStore(
    watchDocumentClass,
    () => document.documentElement.className,
    () => "",
  );
  const { loading, exhausted } = log.older;
  const older = useMemo(() => (exhausted ? null : { loading, exhausted }), [loading, exhausted]);
  const { stub } = agent;
  const hostError = agent.error || load.error;
  // the cover stands until the frame has drawn (its own document loads first) and the log has
  // answered: a saved copy answers at once, so the frame's load is said outright
  const reading =
    (!loaded || (!log.caughtUp && log.events.length === 0)) && !log.error && !hostError;
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
    // the version a read said, never a saved copy's: the frame's chat starts a new conversation
    // at a new one
    version: versionOf(log),
    hostError,
    // the chat's own keys checked, and a kind's own keys kept (AgentKindViewState): its controls
    // keep what was picked in them
    state: AgentChatState.loose().safeParse(view).data || {},
    // the page's theme, for the frame's own
    documentClass,
    // Chat | Events are the page's header's
    tabsInHeader: true,
    // oxlint-disable-next-line iterate/simple-truthiness-check -- the wire view: an absent optional field stays absent
    ...(me && { me }),
    presenceOn: presence,
  };
  // the view's state, as the frame reads it
  const state = inputs.state;
  const verbs = kindViewVerbs({
    itx,
    path,
    stub,
    setState: patchView,
    loadOlder: log.older.loadOlder,
  });
  const { hasChat } = load;
  return (
    <>
      <AgentPageHeader
        path={path}
        agents={agents}
        tabs={{
          view: hasChat ? state.view : "events",
          hasChat,
          // no count until the first read has answered
          held: loaded && !reading ? heldRowsOf(log.events) : undefined,
          wholeLogHeld: log.older.exhausted,
          onStateChange: patchView,
        }}
        // The call's and Share's places stay as the loading header had them: the kind's view runs
        // in a frame, which draws nothing into this page. So who is here is the mind's face alone:
        // the frame says nothing of the viewer to this page.
        presence={false}
        call={call}
        share={share}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <AgentKindViewFrame
          link={link}
          frameScript={frameScriptOfPage()}
          inputs={inputs}
          verbs={verbs}
        />
        {reading ? (
          <div className="absolute inset-0 bg-background">
            {/* with saved rows the wait is for the frame's own document, not for a read */}
            <AgentReading strip={false} quiet={log.events.length > 0} />
          </div>
        ) : null}
      </div>
    </>
  );
}

/** What a frame's load says: the ephemeral types its view reads, its failure, and whether it has
 *  a chat. A kind with no view, or one that failed to load, is the Events tab alone; a frame that
 *  has not loaded yet is drawn as a chat. */
function frameLoadOf(loaded: AgentKindViewLoaded | undefined): {
  ephemeralEvents: readonly string[];
  error: string | undefined;
  hasChat: boolean;
} {
  if (!loaded) return { ephemeralEvents: [], error: undefined, hasChat: true };
  if ("ephemeralEvents" in loaded)
    return { ephemeralEvents: loaded.ephemeralEvents, error: undefined, hasChat: true };
  return {
    ephemeralEvents: [],
    error: "error" in loaded ? loaded.error : undefined,
    hasChat: false,
  };
}

/** Everything a kind's frame may do, to this agent alone: never the agent's stub, which reaches
 *  the whole mind. */
function kindViewVerbs({
  itx,
  path,
  stub,
  setState,
  loadOlder,
}: Pick<AgentKindViewVerbs, "setState" | "loadOlder"> & {
  itx: Itx;
  path: string;
  stub: Parameters<typeof appendEvents>[0] | undefined;
}): AgentKindViewVerbs {
  return {
    message: ({ message, files, key }) => messageAgent(itx, path, { message, files }, key),
    append: async (events) => {
      if (!stub) throw new Error("not connected");
      await appendEvents(stub, events);
    },
    fileUrl: async (filePath) => {
      if (!filePath.startsWith(`${path}/`)) throw new Error(`${filePath} is not a file of ${path}`);
      return fileUrl(itx, filePath);
    },
    // under this agent's path alone: the frame names no path
    storeFiles: (files, key) => storeAgentFiles(itx, path, files, key),
    // as this agent alone: a call that names another path is refused (widget-mcp.ts)
    callTool: (call) => widgetCallsOf(itx, path).callTool(call),
    readResource: (read) => widgetCallsOf(itx, path).readResource(read),
    setState,
    loadOlder,
  };
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
