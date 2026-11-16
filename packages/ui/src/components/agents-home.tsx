// The Agents app's home page: a composer whose first message starts a new agent, and the agents
// that were active most recently, each opening its chat. The rows are the sidebar's
// (lib/agent-summary.ts). It imports no router: see agents-nav.tsx for `agentHref` and `onOpen`.
// Its two halves are parts of their own (`NewAgentComposer`, `RecentAgents`), for a page that puts
// something between them (a Dash's home), and `AllAgents` is every agent, for a page of them all.
//
// A new agent is iterate's unless the picker above the composer says otherwise
// (new-agent-picker.tsx: other kinds' choices, the picked choice's fields, the kind's line about
// it). Sending then starts that kind's agent on a new path, in the folder of the person signed in
// (lib/agent-summary.ts `newAgentPath`), and sends the message after. Nothing here knows any kind
// but iterate.
import { useMemo, useRef, useState, type ComponentProps } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BotIcon } from "lucide-react";
import { cn } from "cn";
import { AgentComposer } from "#/components/agent-chat/composer.tsx";
import { useComposerDraft } from "#/components/agent-chat/use-composer-attachments.ts";
import { AgentLink, StatusDot, type AgentHref, type OpenAgent } from "#/components/agents-nav.tsx";
import { kindIcon } from "#/components/agent-look.ts";
import { timeAgo } from "#/components/context-catalog/context-catalog-rows.ts";
import { ContextPathText } from "#/components/context-path-text.tsx";
import { NewAgentPicker } from "#/components/new-agent-picker.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  agentDoing,
  agentGroups,
  agentTitle,
  byRecentActivity,
  mineFirst,
  newAgentPath,
  subagentsLine,
  topLevelAgents,
  type AgentRow,
} from "#/lib/agent-summary.ts";
import type { NewAgentOffer } from "#/lib/new-agent.ts";

export function AgentsHome({
  agents,
  ...composer
}: Parameters<typeof NewAgentComposer>[0] & {
  agents: AgentRow[];
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 pt-8 md:p-8 md:pt-16">
      <NewAgentComposer {...composer} />
      <RecentAgents
        agents={agents}
        person={composer.person}
        agentHref={composer.agentHref}
        onOpen={composer.onOpen}
      />
    </div>
  );
}

/** THE COMPOSER WHOSE FIRST MESSAGE STARTS A NEW AGENT, with the picker of other kinds above it. */
export function NewAgentComposer({
  person,
  offers,
  offersLoading,
  choice,
  values,
  line,
  onChoice,
  onField,
  onStart,
  onStarted,
  onCreate,
  onMessage,
  agentHref,
  onOpen,
}: {
  /** The folder of the person signed in (lib/agent-summary.ts `personOf`): a new agent is born in
   *  it, and their agents come first. None: a new agent has no person's folder. */
  person?: string;
  /** Other kinds' choices for a new agent, each `<kind>/<choice>`. */
  offers: NewAgentOffer[];
  /** Whether other kinds are still saying what they offer: the picker's place is kept for them,
   *  and a choice the page names waits for them. */
  offersLoading?: boolean;
  /** The picked offer's value, or `undefined` for iterate: the page's URL. */
  choice: string | undefined;
  /** The picked offer's fields, each by its name (lib/new-agent.ts `newAgentValues`): what
   *  its start is given. The page keeps what the person typed. */
  values: Record<string, string>;
  /** The kind's line about the choice as typed (its `newAgent.describe`), which the page asks. */
  line?: string | null;
  onChoice: (choice: string | undefined) => void;
  onField: (name: string, value: string) => void;
  /** Starts the picked offer's agent at `path`, with its fields' values. */
  onStart: (offer: NewAgentOffer, path: string, fields: Record<string, string>) => Promise<unknown>;
  /** Opens an agent another kind just started, at a path the catalog may not list yet. */
  onStarted: (path: string, kind: string) => void;
  /** Births an agent at `path`. */
  onCreate: (path: string) => Promise<unknown>;
  /** Says the first message to the agent at `path`. */
  onMessage: (
    path: string,
    input: Parameters<ComponentProps<typeof AgentComposer>["onSubmit"]>[0],
  ) => Promise<unknown>;
  agentHref: AgentHref;
  /** A page with a client router navigates here; without it the page loads the agent's link. */
  onOpen?: OpenAgent;
}) {
  const draft = useComposerDraft();
  const picked = offers.find((offer) => offer.value === choice);
  // the agent born for a first message that then failed to send: sending again goes to it, so a
  // retry leaves no empty agent behind
  const born = useRef<string | undefined>(undefined);
  return (
    <div className="flex flex-col gap-2">
      {offers.length > 0 ? (
        <NewAgentPicker
          offers={offers}
          picked={picked}
          values={values}
          onChoice={onChoice}
          onField={onField}
          line={line}
        />
      ) : offersLoading ? (
        // the picker's place, while the kinds say what they offer
        <div className="flex items-center gap-2">
          <NativeSelect size="sm" aria-label="Kind of agent" disabled value="">
            <NativeSelectOption value="">iterate</NativeSelectOption>
          </NativeSelect>
        </div>
      ) : null}
      <AgentComposer
        draft={draft}
        placeholder="Message a new agent"
        autoFocusMessage
        interrupt={null}
        onSubmit={async (input) => {
          if (choice && !picked)
            throw new Error(`The kind of agent ${choice} has not said what it offers yet.`);
          if (picked) {
            // another kind's agent: its start events, then the message, on a path of its own
            const path = newAgentPath(
              picked.kind,
              new Date(),
              picked.byPerson ? person : undefined,
            );
            await onStart(picked, path, values);
            await onMessage(path, input);
            onStarted(path, picked.kind);
            return;
          }
          // An agent is its path; a new one is born at this moment's path.
          let path = born.current;
          if (!path) {
            path = newAgentPath("web", new Date(), person);
            await onCreate(path);
            born.current = path;
          }
          await onMessage(path, input);
          born.current = undefined;
          if (onOpen) onOpen(path);
          else location.assign(agentHref(path));
        }}
        onAppendRaw={undefined}
      />
    </div>
  );
}

/** A few agents to pick up again, of those the sidebar lists (no folders or sub-agents), the
 *  person's own first: a card each. */
export function RecentAgents({
  agents,
  person,
  agentHref,
  onOpen,
  limit = 8,
}: {
  agents: readonly AgentRow[];
  person?: string;
  agentHref: AgentHref;
  onOpen?: OpenAgent;
  limit?: number;
}) {
  const recent = useMemo(
    () => mineFirst(byRecentActivity(topLevelAgents(agents)), person).slice(0, limit),
    [agents, person, limit],
  );
  if (recent.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="recent-agents">
      <h2 id="recent-agents" className="text-sm font-medium text-muted-foreground">
        Recently active
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {recent.map((row) => (
          <li key={row.path} className="min-w-0">
            <AgentLink
              path={row.path}
              agentHref={agentHref}
              onOpen={onOpen}
              data-agent-path={row.path}
              className="block rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card size="sm" className="transition-colors hover:bg-accent/40">
                <CardHeader>
                  {/* an agent with no title is its path, once, as the card's title */}
                  <CardTitle className="flex min-w-0 items-center gap-2">
                    <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    {row.title ? (
                      <span className="min-w-0 truncate">{agentTitle(row)}</span>
                    ) : (
                      <ContextPathText path={row.path} className="min-w-0" />
                    )}
                  </CardTitle>
                  {row.title ? (
                    <CardDescription className="min-w-0">
                      <ContextPathText path={row.path} className="text-2xs" />
                    </CardDescription>
                  ) : null}
                  {agentDoing(row) ? (
                    <CardDescription
                      className="min-w-0 line-clamp-2 md:line-clamp-1"
                      data-agent-doing
                    >
                      {agentDoing(row)}
                    </CardDescription>
                  ) : null}
                </CardHeader>
              </Card>
            </AgentLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A row's height in `AllAgents`: two lines, in rem (`h-13`, 52 px at the usual 16 px), as its text
 *  is. A browser set to a larger default font makes the text taller, and the row with it. */
const ROW_REM = 3.25;

/** The row's height in px, which the virtual list positions by: the root's font size times the
 *  rem. Read once, when the list mounts. A server render has no page to ask, and takes 16 px. */
const rowHeightOfPage = () =>
  ROW_REM *
  (import.meta.env.SSR
    ? 16
    : Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);

/** EVERY AGENT, as a virtual list: the agents at the top, the most recently active first, each
 *  followed by the agents below its path, indented. Only the rows in view are in the DOM. It fills
 *  its parent, a flex column with a bounded height, and scrolls itself. */
export function AllAgents({
  agents,
  nowMs,
  agentHref,
  onOpen,
  className,
}: {
  agents: readonly AgentRow[];
  /** What "3 min" is counted from. */
  nowMs: number;
  agentHref: AgentHref;
  onOpen?: OpenAgent;
  className?: string;
}) {
  const rows = useMemo(
    () =>
      agentGroups(agents).flatMap(({ row, subagents }) => [
        { row, subagents: subagents.length, depth: 0 },
        ...subagents.map((sub) => ({ row: sub, subagents: 0, depth: 1 })),
      ]),
    [agents],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rowHeight] = useState(rowHeightOfPage);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => rows[index]!.row.path,
    overscan: 12,
  });
  return (
    <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
      <ul
        aria-label="Every agent"
        className="relative mx-auto w-full max-w-3xl"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const { row, subagents, depth } = rows[item.index]!;
          const KindIcon = kindIcon(row.kind);
          const at = row.lastActivityAt || row.createdAt;
          const line = [subagentsLine(subagents), agentDoing(row, nowMs)]
            .filter(Boolean)
            .join(" · ");
          return (
            <li
              key={item.key}
              className="absolute top-0 left-0 h-13 w-full px-4 md:px-8"
              style={{ transform: `translateY(${String(item.start)}px)` }}
            >
              <AgentLink
                path={row.path}
                agentHref={agentHref}
                onOpen={onOpen}
                data-agent-path={row.path}
                className={cn(
                  "flex h-full items-center gap-3 rounded-md px-2 outline-hidden hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                  depth && "pl-9",
                )}
              >
                <span className="relative shrink-0 [&>svg]:size-4 [&>svg]:text-muted-foreground">
                  <KindIcon aria-hidden />
                  {row.status ? <StatusDot status={row.status} /> : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("truncate", depth ? "text-xs" : "text-sm")}>
                    {agentTitle(row)}
                  </span>
                  <span className="truncate text-2xs text-muted-foreground">
                    {line || <ContextPathText path={row.path} truncate />}
                  </span>
                </span>
                <time dateTime={at} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {timeAgo(at, nowMs)}
                </time>
              </AgentLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
