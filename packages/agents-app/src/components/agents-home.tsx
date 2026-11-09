// The project's home page in this app: a composer whose first message starts a new agent, and the
// agents that were active most recently, each opening its chat. The rows are the sidebar's
// (agent-summary.ts), so the list is there in the first render, from the loader's snapshot.
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, type ComponentProps } from "react";
import { BotIcon } from "lucide-react";
import { AgentComposer } from "@iterate-com/ui/components/agent-chat/composer";
import { useComposerDraft } from "@iterate-com/ui/components/agent-chat/use-composer-attachments";
import { Card, CardDescription, CardHeader, CardTitle } from "@iterate-com/ui/components/ui/card";
import {
  agentTitle,
  byRecentActivity,
  topLevelAgents,
  type AgentRow,
} from "../lib/agent-summary.ts";
import { newWebAgentPath } from "../lib/web-agent.ts";

export function AgentsHome({
  slug,
  agents,
  onCreate,
  onMessage,
}: {
  /** the project's slug — its URL (`/projects/<slug>`) */
  slug: string;
  agents: AgentRow[];
  /** Births an agent at `path`. */
  onCreate: (path: string) => Promise<void>;
  /** Says the first message to the agent at `path`. */
  onMessage: (
    path: string,
    input: Parameters<ComponentProps<typeof AgentComposer>["onSubmit"]>[0],
  ) => Promise<void>;
}) {
  const navigate = useNavigate();
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
          await navigate({ to: "/projects/$slug", params: { slug }, search: { agent: path } });
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
                <Link
                  to="/projects/$slug"
                  params={{ slug }}
                  search={{ agent: row.path }}
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
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
