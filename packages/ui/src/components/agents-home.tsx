// The Agents app's home page: a composer whose first message starts a new agent, and the agents
// that were active most recently, each opening its chat. The rows are the sidebar's
// (lib/agent-summary.ts). It imports no router: see agents-nav.tsx for `agentHref` and `onOpen`.
//
// A new agent is iterate's unless the picker above the composer says otherwise. The page offers
// other kinds' choices ("opencode (acp)", from each kind file's `newAgent`), and a choice shows its
// fields beside the picker. Sending then starts that kind's agent on a new path,
// `/agents/<kind>/<moment>`, and sends the message after. Nothing here knows any kind but iterate.
import { useMemo, useRef, type ComponentProps } from "react";
import { BotIcon } from "lucide-react";
import { AgentComposer } from "#/components/agent-chat/composer.tsx";
import { useComposerDraft } from "#/components/agent-chat/use-composer-attachments.ts";
import { AgentLink, type AgentHref, type OpenAgent } from "#/components/agents-nav.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  agentTitle,
  byRecentActivity,
  topLevelAgents,
  type AgentRow,
} from "#/lib/agent-summary.ts";

/** A browser-created agent lives at `/agents/<folder>/<moment>`: an iterate agent's folder is
 *  `web`, another kind's its name. An agent is its path; there is no separate name. */
export function newAgentPath(folder: string, date: Date) {
  const slug = date
    .toISOString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `/agents/${folder}/${slug}`;
}

/** Another kind's choice for a new agent, as the picker lists it. */
export type NewAgentOffer = {
  /** `<kind>/<choice>` */
  value: string;
  /** "opencode (acp)" */
  label: string;
  kind: string;
  /** The kind's own id for the choice. */
  choice: string;
  fields: { name: string; label: string; defaultValue: string }[];
};

export function AgentsHome({
  agents,
  offers,
  choice,
  onChoice,
  onStart,
  onStarted,
  onCreate,
  onMessage,
  agentHref,
  onOpen,
}: {
  agents: AgentRow[];
  /** Other kinds' choices for a new agent, each `<kind>/<choice>`. */
  offers: NewAgentOffer[];
  /** The picked offer's value, or `undefined` for iterate: the page's URL. */
  choice: string | undefined;
  onChoice: (choice: string | undefined) => void;
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
  // the picked choice's fields, read when the message is sent
  const fields = useRef<HTMLDivElement>(null);
  // the agent born for a first message that then failed to send: sending again goes to it, so a
  // retry leaves no empty agent behind
  const born = useRef<string | undefined>(undefined);
  // a few to pick up again, of those the sidebar lists (no folders or sub-agents); it lists them all
  const recent = useMemo(() => byRecentActivity(topLevelAgents(agents)).slice(0, 8), [agents]);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 pt-8 md:p-8 md:pt-16">
      <div className="flex flex-col gap-2">
        {offers.length > 0 ? (
          <div ref={fields} className="flex flex-wrap items-center gap-2">
            <NativeSelect
              size="sm"
              aria-label="Kind of agent"
              value={picked?.value || ""}
              onChange={(event) => onChoice(event.target.value || undefined)}
            >
              <NativeSelectOption value="">iterate</NativeSelectOption>
              {offers.map((offer) => (
                <NativeSelectOption key={offer.value} value={offer.value}>
                  {offer.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {picked?.fields.map((field) => (
              <Input
                key={`${picked.value}/${field.name}`}
                name={field.name}
                aria-label={field.label}
                placeholder={field.label}
                defaultValue={field.defaultValue}
                className="h-7 w-40 font-mono text-xs"
              />
            ))}
          </div>
        ) : null}
        <AgentComposer
          draft={draft}
          placeholder="Message a new agent"
          autoFocusMessage
          interrupt={null}
          onSubmit={async (input) => {
            if (picked) {
              // another kind's agent: its start events, then the message, on a path of its own
              const path = newAgentPath(picked.kind, new Date());
              const values = Object.fromEntries(
                [...(fields.current?.querySelectorAll("input[name]") || [])].map((element) => {
                  const field = element as HTMLInputElement;
                  return [field.name, field.value];
                }),
              );
              await onStart(picked, path, values);
              await onMessage(path, input);
              onStarted(path, picked.kind);
              return;
            }
            // An agent is its path; a new one is born at this moment's path.
            let path = born.current;
            if (!path) {
              path = newAgentPath("web", new Date());
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
