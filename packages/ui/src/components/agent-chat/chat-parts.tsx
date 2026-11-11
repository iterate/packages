// THE PARTS a kind's chat view builds with (agent-kind-view/kit.ts hands them over as `ui`), beside
// `AgentShell` (agent-shell.tsx): a scrolling `Feed` with a footer, a `MessageBubble`, `Markdown`
// and a `Composer`. iterate's own chat (agent-chat.tsx) is built from the same pieces, with its own
// fold. A kind whose model doesn't fit their props copies this file: the package is public.
import { useCallback, type ReactNode } from "react";
import { cn } from "cn";
import { Message, MessageContent, MessageResponse } from "./message.tsx";
import { AgentComposer } from "./composer.tsx";
import { useComposerDraft } from "./use-composer-attachments.ts";
import { VirtualLog, type VirtualLogRowInfo } from "#/components/virtual-log/virtual-log.tsx";
import { OLDER_EXHAUSTED, type OlderPages } from "#/components/virtual-log/older-pages.ts";

/** One row of a `Feed`: its identity, and where it sits in the log when it is an event's. */
export type FeedRow = { key: string; offset?: number };

const ROWS: VirtualLogRowInfo<FeedRow> = {
  key: (row) => row.key,
  estimateSize: () => 72,
  offset: (row) => row.offset,
};

/** Rows that scroll, newest at the bottom, the view staying at the end as rows arrive, with a
 *  footer (the composer) always in front. Older pages load as the reader scrolls up. */
export function Feed<Row extends FeedRow>({
  rows,
  renderRow,
  footer,
  empty,
  tail,
  older = OLDER_EXHAUSTED,
}: {
  rows: readonly Row[];
  renderRow: (row: Row) => ReactNode;
  footer?: ReactNode;
  /** What shows with no rows. */
  empty?: ReactNode;
  /** What is not in the log yet and ends the list: work in flight. */
  tail?: ReactNode;
  older?: OlderPages;
}) {
  // the row type is the caller's; the log only reads its key and offset
  const render = useCallback((row: FeedRow) => renderRow(row as Row), [renderRow]);
  return (
    <VirtualLog
      rows={rows}
      rowInfo={ROWS}
      renderRow={render}
      older={older}
      empty={empty}
      tail={tail}
      label="Chat"
      footer={
        footer ? (
          <div className="pointer-events-none bg-linear-to-t from-background from-80% to-transparent px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6">
            <div className="pointer-events-auto mx-auto w-full max-w-3xl">{footer}</div>
          </div>
        ) : undefined
      }
      paddingStart={8}
      paddingEnd={8}
      columnClassName="mx-auto w-full max-w-3xl px-4 md:px-6"
    />
  );
}

/** Markdown, as a chat draws an agent's words. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return <MessageResponse className={className}>{children}</MessageResponse>;
}

/** Someone's words: a person's on the right in a bubble, an agent's on the left as markdown. */
export function MessageBubble({
  from,
  text,
  footer,
  className,
}: {
  from: "user" | "agent";
  text: string;
  /** A line under the words: a time, who sent it. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Message from={from === "user" ? "user" : "assistant"} className={cn("py-2", className)}>
      <MessageContent>
        {from === "user" ? (
          <div className="whitespace-pre-wrap leading-6">{text}</div>
        ) : (
          <Markdown>{text}</Markdown>
        )}
      </MessageContent>
      {footer ? <div className="text-xs text-muted-foreground">{footer}</div> : null}
    </Message>
  );
}

/** The message box: words and attachments go to `onMessage` (the view's prop, the mind's
 *  `itx.agents.get(path).message(…)`), and with `onAppend` a raw mode appends events as written. */
export function Composer({
  onMessage,
  onAppend,
  placeholder = "Message this agent",
}: {
  onMessage: (input: {
    message: string;
    files: { contentType: string; filename: string; data: string }[];
  }) => Promise<void>;
  onAppend?: ((events: unknown[]) => Promise<unknown>) | undefined;
  placeholder?: string;
}) {
  const draft = useComposerDraft();
  return (
    <AgentComposer
      draft={draft}
      placeholder={placeholder}
      autoFocusMessage
      interrupt={null}
      onSubmit={onMessage}
      onAppendRaw={
        onAppend
          ? async (events) => {
              await onAppend(events);
            }
          : undefined
      }
    />
  );
}
