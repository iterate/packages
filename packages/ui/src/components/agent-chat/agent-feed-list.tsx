// The chat, on the virtual log (virtual-log/virtual-log.tsx): the feed's settled items are its rows,
// the work in flight is its tail (with the dots of who else is typing and the chat's own status row
// after it, if any), and the composer is its footer. In a chat where nothing was said, the dots of
// who types stand over the empty greeting, at the foot of its box: the greeting stays where it is.
import { useCallback, type ComponentProps, type ReactNode } from "react";
import { AgentFeedItemRow, AgentLiveActivity } from "./agent-feed.tsx";
import type { AgentUiItem, AgentUiState } from "./agent-ui-reducer.ts";
import { TypingInStream } from "./participant.tsx";
import type { PresentPrincipal } from "#/lib/presence.ts";
import type { OlderPages } from "#/components/virtual-log/older-pages.ts";
import { ReadProgress } from "#/components/virtual-log/read-progress.tsx";
import { VirtualLog, type VirtualLogRowInfo } from "#/components/virtual-log/virtual-log.tsx";

/** A row's height until it is measured. Another agent's words are one quiet row, as tall as an
 *  activity's. */
const ESTIMATED_HEIGHT: Record<AgentUiItem["kind"], number> = {
  user: 96,
  assistant: 72,
  activity: 36,
  background: 36,
  note: 32,
  "stream-paused": 48,
  "stream-resumed": 48,
};

const CHAT_ROWS: VirtualLogRowInfo<AgentUiItem> = {
  key: (row) => row.id,
  estimateSize: (row) =>
    row.kind === "user" && row.from ? ESTIMATED_HEIGHT.activity : ESTIMATED_HEIGHT[row.kind],
  // a message's; what the agent did is counted by the words around it
  offset: (row) => (row.kind === "user" || row.kind === "assistant" ? row.offset : undefined),
};

export function AgentFeedList({
  feed,
  older,
  logShare,
  followTail,
  empty,
  after,
  footer,
  toggledIds,
  onToggle,
  inspect,
  traceOffsets,
  signedUrl,
  itemFooter,
  me,
  agentPath,
  typing,
}: {
  feed: { state: AgentUiState; items: readonly AgentUiItem[] };
  older: OlderPages;
  /** How much of the log is held, from 0 to 1. */
  logShare: number;
  /** Each change pins the view to the tail again, wherever the reader was (the person's own words:
   *  they land in view). */
  followTail: number;
  /** What shows when there are no rows: the empty log, the first read. */
  empty: ReactNode;
  /** A row after the work in flight, the last of the list: the chat's status, when it has no strip. */
  after?: ReactNode;
  /** The composer, under the rows. */
  footer: ReactNode;
  toggledIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  inspect: ComponentProps<typeof AgentFeedItemRow>["inspect"];
  traceOffsets: ReadonlyMap<string, number>;
  signedUrl: ComponentProps<typeof AgentFeedItemRow>["signedUrl"];
  itemFooter?: (item: AgentUiItem) => ReactNode;
  me: string | undefined;
  /** This chat's agent, which tells its helpers' words from another agent's. */
  agentPath: string;
  /** Everyone but the viewer who is typing now: their faces with dots end the tail. None with
   *  presence off. */
  typing: readonly PresentPrincipal[];
}) {
  const { items, state } = feed;
  const last = items.at(-1);
  const dots =
    typing.length > 0 ? (
      <TypingInStream
        typing={typing}
        // their next bubble goes on the run the stream ends with, unless work in flight is between
        runOf={state.live ? undefined : runSenderOf(last)}
      />
    ) : null;
  const renderRow = useCallback(
    (row: AgentUiItem, index: number) => (
      <>
        <AgentFeedItemRow
          item={row}
          expanded={toggledIds.has(row.id)}
          onToggle={onToggle}
          inspect={inspect}
          traceOffset={row.kind === "assistant" ? traceOffsets.get(row.id) : undefined}
          signedUrl={signedUrl}
          me={me}
          agentPath={agentPath}
          continuesRun={continuesRun(items[index - 1], row)}
        />
        {itemFooter?.(row)}
      </>
    ),
    [toggledIds, onToggle, inspect, traceOffsets, signedUrl, itemFooter, me, agentPath, items],
  );
  return (
    <VirtualLog
      rows={items}
      rowInfo={CHAT_ROWS}
      renderRow={renderRow}
      tail={
        state.live || (dots && last) || after ? (
          <>
            {state.live ? (
              <AgentLiveActivity
                state={state}
                toggledIds={toggledIds}
                onToggle={onToggle}
                inspect={inspect}
                me={me}
              />
            ) : null}
            {dots}
            {after}
          </>
        ) : undefined
      }
      older={older}
      readingOlder={<ReadProgress label="Loading older messages" value={logShare} />}
      empty={
        dots ? (
          <div className="relative h-full">
            {empty}
            <div className="absolute inset-x-0 bottom-0">{dots}</div>
          </div>
        ) : (
          empty
        )
      }
      label="Chat"
      footer={footer}
      followTail={followTail}
      paddingStart={8}
      paddingEnd={8}
      columnClassName="mx-auto w-full max-w-3xl px-4 md:px-6"
    />
  );
}

/** Whether a message goes on the run of the row before it: both are messages that name the same
 *  sender, both written by that sender or both by their script, with no other row between them.
 *  Decided from the two rows alone, as each row is drawn: a boolean prop keeps the row memoised,
 *  and older rows read in above a run change only the run's first row. */
function continuesRun(previous: AgentUiItem | undefined, item: AgentUiItem): boolean {
  if (previous?.kind !== "user" || item.kind !== "user" || previous.from || item.from) return false;
  const [before, now] = [previous.sender, item.sender];
  return Boolean(before && now && before.actor === now.actor && before.script === now.script);
}

/** The actor whose own run of messages a row ends, if it does: a message they wrote, not their
 *  script. Their typed message goes on that run. */
function runSenderOf(row: AgentUiItem | undefined): string | undefined {
  if (row?.kind !== "user" || row.from || row.sender?.script !== false) return undefined;
  return row.sender.actor;
}
