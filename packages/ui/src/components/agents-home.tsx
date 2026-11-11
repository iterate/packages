// The Agents app's home page: a composer whose first message starts a new agent, and the agents
// that were active most recently, each opening its chat. The rows are the sidebar's
// (lib/agent-summary.ts). It imports no router: see agents-nav.tsx for `agentHref` and `onOpen`.
import { useMemo, useRef, type ComponentProps } from "react";
import { BotIcon } from "lucide-react";
import { AgentComposer } from "#/components/agent-chat/composer.tsx";
import { useComposerDraft } from "#/components/agent-chat/use-composer-attachments.ts";
import { AgentLink, type AgentHref, type OpenAgent } from "#/components/agents-nav.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import {
  agentTitle,
  byRecentActivity,
  topLevelAgents,
  type AgentRow,
} from "#/lib/agent-summary.ts";

/** A browser-created agent lives at `/agents/web/<moment>`. An agent is its path; there is no
 *  separate name. */
export function newWebAgentPath(date: Date) {
  const slug = date
    .toISOString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `/agents/web/${slug}`;
}

export function AgentsHome({
  agents,
  onCreate,
  onMessage,
  agentHref,
  onOpen,
}: {
  agents: AgentRow[];
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
  // a few to pick up again, of those the sidebar lists (no folders or sub-agents); it lists them all
  const recent = useMemo(() => byRecentActivity(topLevelAgents(agents)).slice(0, 8), [agents]);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 pt-8 md:p-8 md:pt-16">
      <AgentComposer
        draft={draft}
        placeholder="Message a new agent"
        autoFocusMessage
        interrupt={null}
        onSubmit={async (input) => {
          // An agent is its path; a new one is born at this moment's path.
          let path = born.current;
          if (!path) {
            path = newWebAgentPath(new Date());
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
      {recent.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="recent-agents">
          <h2 id="recent-agents" className="text-sm font-medium text-muted-foreground">
            Recently active
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {recent.map((row) => (
              <li key={row.path}>
                <AgentLink
                  path={row.path}
                  agentHref={agentHref}
                  onOpen={onOpen}
                  data-agent-path={row.path}
                  className="block rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card size="sm" className="transition-colors hover:bg-accent/40">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">{agentTitle(row)}</span>
                      </CardTitle>
                      <CardDescription className="truncate font-mono text-2xs">
                        {row.path}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </AgentLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
