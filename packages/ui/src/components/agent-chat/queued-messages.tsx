// The queued-messages panel: messages that landed while a turn was running, rendered as
// PART OF THE COMPOSER — input that has not reached the agent yet belongs with the input surface,
// not in the feed's history. A rounded card tucked behind the pill; on phones only the newest
// message stays pinned, with a "+N more" toggle.
//
// The panel is the PEOPLE's queue. Several people can write to one agent, so each waiting message
// says whose it is: a face and a name, or "You". Another agent's words can wait for the next turn
// too (a helper's report that comes in while the agent works): they are no person's input, so they
// are not drawn here. The feed shows them as a report row once a request has taken them up.
// Everyone in the conversation is trusted alike: anyone may interrupt, whoever's answer runs.
import { useState } from "react";
import { BanIcon } from "lucide-react";
import { cn } from "cn";
import type { AgentUiMessageItem } from "./agent-ui-reducer.ts";
import { UserMessageBody, type SignedUrl } from "./agent-feed.tsx";
import { sentByMe } from "./stream-event.ts";
import { Face } from "#/components/call/face.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { Button } from "#/components/ui/button.tsx";

export function QueuedMessagesPanel({
  messages: queued,
  isInterrupting,
  onInterrupt,
  signedUrl,
  me,
}: {
  messages: AgentUiMessageItem[];
  isInterrupting: boolean;
  onInterrupt?: () => Promise<void> | void;
  signedUrl: SignedUrl;
  /** The viewer's address or actor id: their own waiting words read "You". */
  me?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const messages = queued.filter((message) => !message.from);
  if (messages.length === 0) return null;
  const hiddenCount = messages.length - 1;
  return (
    <div
      className="-mb-4 rounded-t-3xl border border-b-0 bg-muted/40 px-3 pb-6 pt-1.5"
      data-testid="queued-messages-panel"
    >
      <div className="flex items-center gap-2 px-1.5 py-1">
        <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
          Queued for the next agent turn
        </span>
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="shrink-0 font-mono text-2xs text-muted-foreground underline-offset-2 hover:underline sm:hidden"
          >
            {expanded ? "collapse" : `+${String(hiddenCount)} more`}
          </button>
        ) : null}
        {onInterrupt ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onInterrupt()}
            disabled={isInterrupting}
            className="ml-auto h-6 shrink-0 gap-1 px-2 text-2xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {isInterrupting ? (
              <Spinner className="size-3" />
            ) : (
              <BanIcon className="size-3 text-current" />
            )}
            Interrupt & send now
          </Button>
        ) : null}
      </div>
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {messages.map((message, index) => (
          <div
            key={message.id}
            className={cn(
              "rounded-xl border bg-background/80 px-3 py-1.5 text-sm",
              // The mobile push-out: only the newest message stays pinned to the composer while
              // collapsed.
              !expanded && index < messages.length - 1 && "hidden sm:block",
            )}
          >
            <QueuedBy message={message} me={me} />
            <UserMessageBody item={message} signedUrl={signedUrl} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Whose waiting words these are, as the platform stamped them. Nothing for words that name
 *  nobody (the mind's own code sent them). */
function QueuedBy({ message, me }: { message: AgentUiMessageItem; me: string | undefined }) {
  const { sender, saidBy } = message;
  if (!sender || !saidBy) return null;
  const who = sender.email || sender.actor;
  return (
    <span className="font-readme mb-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
      <Face small who={who} />
      <span data-queued-by title={who}>
        {sentByMe(sender, me) ? "You" : saidBy}
      </span>
    </span>
  );
}
