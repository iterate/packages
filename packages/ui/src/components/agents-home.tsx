// The Agents app's home page: a composer whose first message starts a new agent, and the agents
// that were active most recently, each opening its chat. The rows are the sidebar's
// (lib/agent-summary.ts). It imports no router: see agents-nav.tsx for `agentHref` and `onOpen`.
// Its two halves are parts of their own (`NewAgentComposer`, `RecentAgents`), for a page that puts
// something between them (a Dash's home), and `AllAgents` is every agent, for a page of them all.
//
// A new agent is iterate's: sending starts one on a new path, in the folder of the person signed
// in (lib/agent-summary.ts `newAgentPath`), and sends the message after.
import { useMemo, useRef, useState, type ComponentProps } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BotIcon } from "lucide-react";
import { cn } from "cn";
import { agentAtWork } from "iterate/agents/mind-now";
import { AgentComposer } from "#/components/agent-chat/composer.tsx";
import { useComposerDraft } from "#/components/agent-chat/use-composer-attachments.ts";
import { AgentLink, StatusDot, type AgentHref, type OpenAgent } from "#/components/agents-nav.tsx";
import { kindIcon } from "#/components/agent-look.ts";
import { timeAgo } from "#/components/context-catalog/context-catalog-rows.ts";
import { ContextPathText } from "#/components/context-path-text.tsx";
import { ListRowText } from "#/components/list-row-text.tsx";
import { pxPerRem } from "#/lib/px-per-rem.ts";
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
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
        // the person's own first, once the page knows who is signed in
        person={typeof composer.person === "string" ? composer.person : undefined}
        agentHref={composer.agentHref}
        onOpen={composer.onOpen}
      />
    </div>
  );
}

/** THE COMPOSER WHOSE FIRST MESSAGE STARTS A NEW AGENT: an iterate agent. */
export function NewAgentComposer({
  person,
  onCreate,
  onMessage,
  agentHref,
  onOpen,
}: {
  /** The folder of the person signed in (lib/agent-summary.ts `personOf`): a new agent is born in
   *  it, and their agents come first. None: a new agent has no person's folder. A function, for a
   *  page that does not know yet who is signed in: it is asked when a first message is sent, and
   *  the agent is born once it has answered. */
  person?: string | (() => Promise<string | undefined>);
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
  // the agent born for a first message that then failed to send: sending again goes to it, so a
  // retry leaves no empty agent behind
  const born = useRef<string | undefined>(undefined);
  return (
    <AgentComposer
      draft={draft}
      placeholder="Message a new agent"
      autoFocusMessage
      interrupt={null}
      onSubmit={async (input) => {
        // An agent is its path; a new one is born at this moment's path.
        let path = born.current;
        if (!path) {
          path = newAgentPath(
            "web",
            new Date(),
            typeof person === "function" ? await person() : person,
          );
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

/** EVERY AGENT, as a virtual list: the agents at the top, the most recently active first, each
 *  followed by its subagents that are at work now (`agentAtWork`), indented. A row is the agent's
 *  title when it has one, its path, and its summary while it is at work, else its description
 *  (`ListRowText`). A subagent that is not at work is in its agent's "and 5 subagents" only. Only
 *  the rows in view are in the DOM. It fills its parent, a flex column with a bounded height, and
 *  scrolls itself. */
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
        // a subagent has a row of its own only while it is at work: the others are in the count
        ...subagents
          .filter((sub) => agentAtWork(sub, nowMs))
          .map((sub) => ({ row: sub, subagents: 0, depth: 1 })),
      ]),
    [agents, nowMs],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // the rem in px, read once, when the list mounts
  const [rem] = useState(pxPerRem);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rowRem(rows[index]!.row) * rem,
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
          // what it does now while it is at work; otherwise what it is for
          const line = [subagentsLine(subagents), agentDoing(row, nowMs) || row.description]
            .filter(Boolean)
            .join(" · ");
          return (
            <li
              key={item.key}
              className="absolute top-0 left-0 w-full px-4 md:px-8"
              style={{
                height: `${String(rowRem(row))}rem`,
                transform: `translateY(${String(item.start)}px)`,
              }}
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
                <ListRowText
                  title={row.title}
                  path={row.path}
                  line={line}
                  className={depth ? "text-xs" : "text-sm"}
                  time={
                    <time
                      dateTime={at}
                      className="shrink-0 text-xs text-muted-foreground tabular-nums"
                    >
                      {timeAgo(at, nowMs)}
                    </time>
                  }
                />
              </AgentLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A row's height in `AllAgents`, in rem, as its text is: a title (`text-sm`, 1.25rem), the path
 *  and the last line (`text-2xs`, 1rem each) and 1rem of space. A row without a title has the path
 *  on its first line, so it is one line shorter. A browser set to a larger default font makes the
 *  text taller, and the row with it. */
function rowRem(row: AgentRow): number {
  return row.title ? 4.25 : 3.25;
}
