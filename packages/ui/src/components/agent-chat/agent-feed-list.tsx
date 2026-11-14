// The chat, on the virtual log (virtual-log/virtual-log.tsx): the feed's settled items are its rows,
// the work in flight is its tail (with the chat's own status row after it, if any), and the
// composer is its footer.
import { useCallback, type ComponentProps, type ReactNode } from "react";
import { AgentFeedItemRow, AgentLiveActivity } from "./agent-feed.tsx";
import type { AgentUiItem, AgentUiState } from "./agent-ui-reducer.ts";
import type { OlderPages } from "#/components/virtual-log/older-pages.ts";
import { ReadProgress } from "#/components/virtual-log/read-progress.tsx";
import { VirtualLog, type VirtualLogRowInfo } from "#/components/virtual-log/virtual-log.tsx";

/** A row's height until it is measured. */
const ESTIMATED_HEIGHT: Record<AgentUiItem["kind"], number> = {
  user: 96,
  assistant: 72,
  activity: 36,
  background: 36,
  "stream-paused": 48,
  "stream-resumed": 48,
};

const CHAT_ROWS: VirtualLogRowInfo<AgentUiItem> = {
  key: (row) => row.id,
  estimateSize: (row) => ESTIMATED_HEIGHT[row.kind],
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
}) {
  const { items, state } = feed;
  const renderRow = useCallback(
    (row: AgentUiItem) => (
      <>
        <AgentFeedItemRow
          item={row}
          expanded={toggledIds.has(row.id)}
          onToggle={onToggle}
          inspect={inspect}
          traceOffset={row.kind === "assistant" ? traceOffsets.get(row.id) : undefined}
          signedUrl={signedUrl}
        />
        {itemFooter?.(row)}
      </>
    ),
    [toggledIds, onToggle, inspect, traceOffsets, signedUrl, itemFooter],
  );
  return (
    <VirtualLog
      rows={items}
      rowInfo={CHAT_ROWS}
      renderRow={renderRow}
      tail={
        state.live || after ? (
          <>
            {state.live ? (
              <AgentLiveActivity
                state={state}
                toggledIds={toggledIds}
                onToggle={onToggle}
                inspect={inspect}
              />
            ) : null}
            {after}
          </>
        ) : undefined
      }
      older={older}
      readingOlder={<ReadProgress label="Loading older messages" value={logShare} />}
      empty={empty}
      label="Chat"
      footer={footer}
      followTail={followTail}
      paddingStart={8}
      paddingEnd={8}
      columnClassName="mx-auto w-full max-w-3xl px-4 md:px-6"
    />
  );
}
