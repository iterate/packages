// The Agents app's home page: a composer whose first message starts a new agent, and the agents
// that were active most recently, each opening its chat. The rows are the sidebar's
// (lib/agent-summary.ts). It imports no router: see agents-nav.tsx for `agentHref` and `onOpen`.
//
// A new agent is iterate's unless the picker above the composer says otherwise
// (new-agent-picker.tsx: other kinds' choices, the picked choice's fields, the kind's line about
// it). Sending then starts that kind's agent on a new path, in the folder of the person signed in
// (lib/agent-summary.ts `newAgentPath`), and sends the message after. Nothing here knows any kind
// but iterate.
import { useMemo, useRef, type ComponentProps } from "react";
import { BotIcon } from "lucide-react";
import { AgentComposer } from "#/components/agent-chat/composer.tsx";
import { useComposerDraft } from "#/components/agent-chat/use-composer-attachments.ts";
import { AgentLink, type AgentHref, type OpenAgent } from "#/components/agents-nav.tsx";
import { NewAgentPicker } from "#/components/new-agent-picker.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import {
  agentTitle,
  byRecentActivity,
  mineFirst,
  newAgentPath,
  topLevelAgents,
  type AgentRow,
} from "#/lib/agent-summary.ts";
import type { NewAgentOffer } from "#/lib/new-agent.ts";

export function AgentsHome({
  agents,
  person,
  offers,
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
  agents: AgentRow[];
  /** The folder of the person signed in (lib/agent-summary.ts `personOf`): a new agent is born in
   *  it, and their agents come first. None: a new agent has no person's folder. */
  person?: string;
  /** Other kinds' choices for a new agent, each `<kind>/<choice>`. */
  offers: NewAgentOffer[];
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
  // a few to pick up again, of those the sidebar lists (no folders or sub-agents); it lists them all
  const recent = useMemo(
    () => mineFirst(byRecentActivity(topLevelAgents(agents)), person).slice(0, 8),
    [agents, person],
  );
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 pt-8 md:p-8 md:pt-16">
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
        ) : null}
        <AgentComposer
          draft={draft}
          placeholder="Message a new agent"
          autoFocusMessage
          interrupt={null}
          onSubmit={async (input) => {
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
