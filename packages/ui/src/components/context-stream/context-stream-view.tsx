// Base stream view for any context (`ContextStream`):
// - Zero knowledge of LLMs, `<codemode>`, turns, or `#offset` numbers on the 0-click surface:
//   actors (people, guests, minds, subcontexts, apps) post messages, react, and open nested
//   subcontexts (`SubcontextPreview`) in a single virtualized log.
// - Every actor — including the viewer — shares the same `2rem` (`size-8`) Slack-proportioned left
//   attribution gutter: circular faces for people/guests, rounded-square (`rounded-[22.37%]`) faces for minds.
// - Consecutive messages from the same actor stack tightly without repeating the face or header,
//   highlighting individually on hover while revealing a gutter timestamp and a corner hover bar.
// - A faint right-aligned `•••` menu on every message (reachable on touch and hover) opens a
//   configurable 1-level-deep menu (`messageMenu`) for copying text/ranges and inspecting provenance.
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  MessageSquareTextIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { cn } from "cn";
import {
  actorFaceProps,
  computeContinuesRunFlags,
  defaultActorIdentity,
  estimateContextStreamItemSize,
  formatGutterHoverTime,
  formatShortTime,
  MAX_INLINE_SUBCONTEXT_BARS,
  type ContextStreamActorIdentity,
  type ContextStreamActorRef,
  type ContextStreamCopyItem,
  type ContextStreamCustomItem,
  type ContextStreamItem,
  type ContextStreamLiveEntry,
  type ContextStreamMenuAction,
  type ContextStreamMessageItem,
  type ContextStreamMessageMenu,
  type ContextStreamOpenTarget,
  type SubcontextPreview,
} from "./context-stream-model.ts";
import { Face } from "#/components/call/face.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import {
  NEWER_EXHAUSTED,
  OLDER_EXHAUSTED,
  type NewerPages,
  type OlderPages,
} from "#/components/virtual-log/older-pages.ts";
import { LogReading } from "#/components/virtual-log/read-progress.tsx";
import { VirtualLog, type VirtualLogRowInfo } from "#/components/virtual-log/virtual-log.tsx";

/** `2rem` (`size-8` = 32px) Slack avatar gutter beside the content column. */
const GUTTER_GRID = "grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2.5";

const ROW_INFO: VirtualLogRowInfo<ContextStreamItem> = {
  key: (item) => item.key,
  estimateSize: estimateContextStreamItemSize,
  offset: (item) => (item.kind === "day" ? undefined : item.offset),
  span: (item) => (item.kind !== "day" && "span" in item ? item.span : undefined),
};

export function ContextStream({
  items,
  live,
  older = OLDER_EXHAUSTED,
  newer = NEWER_EXHAUSTED,
  arrivals,
  actor = defaultActorIdentity,
  agentName = "iterate",
  reveal,
  followTail,
  onOpen,
  onToggleReaction,
  onJumpToLatest,
  messageMenu,
  rows,
  liveRows,
  under,
  composer,
  aboveComposer,
  belowComposer,
  empty,
  label = "Context stream",
  columnClassName = "mx-auto w-full max-w-3xl px-4 md:px-6",
  className,
}: {
  items: readonly ContextStreamItem[];
  live?: readonly ContextStreamLiveEntry[];
  older?: OlderPages;
  newer?: NewerPages;
  arrivals?: readonly { offset: number }[];
  actor?: (ref: ContextStreamActorRef) => ContextStreamActorIdentity;
  agentName?: string;
  reveal?: number;
  followTail?: number;
  onOpen?: (target: ContextStreamOpenTarget) => void;
  onToggleReaction?: (offset: number, emoji: string) => void;
  onJumpToLatest?: () => void;
  messageMenu?: (item: ContextStreamMessageItem) => ContextStreamMessageMenu | undefined;
  rows?: Readonly<Record<string, (item: ContextStreamCustomItem) => ReactNode>>;
  liveRows?: Readonly<Record<string, (entry: ContextStreamLiveEntry) => ReactNode>>;
  under?: (item: ContextStreamItem) => ReactNode;
  composer?: ReactNode;
  aboveComposer?: ReactNode;
  belowComposer?: ReactNode;
  empty?: ReactNode;
  label?: string;
  columnClassName?: string;
  className?: string;
}) {
  const continuesRunFlags = useMemo(() => computeContinuesRunFlags(items), [items]);

  const renderRow = useCallback(
    (item: ContextStreamItem, index: number) => (
      <ContextStreamRow
        item={item}
        continuesRun={continuesRunFlags[index] ?? false}
        actor={actor}
        agentName={agentName}
        onOpen={onOpen}
        onToggleReaction={onToggleReaction}
        messageMenu={messageMenu}
        rows={rows}
        under={under}
      />
    ),
    [continuesRunFlags, actor, agentName, onOpen, onToggleReaction, messageMenu, rows, under],
  );

  let emptyNode: ReactNode = (
    <div className="py-3">
      <LogReading label="Loading stream" />
    </div>
  );
  if (older.failed) {
    emptyNode = null;
  } else if (older.exhausted) {
    emptyNode = empty;
  }

  const tailNode =
    live && live.length > 0 ? (
      <ContextStreamTail live={live} actor={actor} agentName={agentName} liveRows={liveRows} />
    ) : undefined;

  const hasFooter = Boolean(aboveComposer || composer || belowComposer);

  return (
    <VirtualLog
      rows={items}
      rowInfo={ROW_INFO}
      renderRow={renderRow}
      older={older}
      newer={newer}
      arrivals={arrivals}
      reveal={reveal}
      followTail={followTail}
      onJumpToLatest={onJumpToLatest}
      empty={emptyNode}
      tail={tailNode}
      label={label}
      footer={
        hasFooter ? (
          <ContextStreamFooter
            aboveComposer={aboveComposer}
            composer={composer}
            belowComposer={belowComposer}
          />
        ) : undefined
      }
      paddingStart={8}
      paddingEnd={8}
      columnClassName={columnClassName}
      className={className}
    />
  );
}

function ContextStreamFooter({
  aboveComposer,
  composer,
  belowComposer,
}: {
  aboveComposer: ReactNode;
  composer: ReactNode;
  belowComposer: ReactNode;
}) {
  return (
    <div
      data-slot="context-stream-footer"
      className="pointer-events-none bg-linear-to-t from-background from-80% to-transparent px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6"
    >
      <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col">
        {aboveComposer ? (
          <div data-slot="context-stream-above-composer" className="pb-1.5 empty:hidden">
            {aboveComposer}
          </div>
        ) : null}
        {composer}
        {belowComposer ? (
          <div data-slot="context-stream-below-composer" className="px-1 pt-1.5 empty:hidden">
            {belowComposer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContextStreamTail({
  live,
  actor,
  agentName,
  liveRows,
}: {
  live: readonly ContextStreamLiveEntry[];
  actor: (ref: ContextStreamActorRef) => ContextStreamActorIdentity;
  agentName: string;
  liveRows: Readonly<Record<string, (entry: ContextStreamLiveEntry) => ReactNode>> | undefined;
}) {
  return (
    <div data-slot="context-stream-tail" className="flex flex-col gap-2 py-2">
      {live.map((entry) => {
        const resolved = actor(entry.by);
        const custom = liveRows?.[entry.kind]?.(entry);
        return (
          <div
            key={entry.key}
            data-live-actor={entry.by.id}
            data-live-kind={entry.kind}
            className={cn(
              GUTTER_GRID,
              "group/msg relative -mx-2 gap-y-0.5 rounded-md px-2 py-1 transition-colors hover:bg-muted/55 focus-within:bg-muted/55",
            )}
          >
            {entry.kind !== "typing" ? <LiveEntryCornerMenu entry={entry} /> : null}
            <span className="relative col-start-1 row-start-1 row-span-2 inline-flex size-8 self-start pt-0.5">
              <Face {...actorFaceProps(resolved, agentName)} label={resolved.label} />
              <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-success ring-2 ring-background" />
            </span>
            <span className="col-start-2 row-start-1 truncate pr-7 text-sm font-semibold text-foreground">
              {resolved.name}
            </span>
            <div className="col-start-2 row-start-2 min-w-0 pr-7">
              {custom ?? <DefaultLiveEntryBody entry={entry} label={resolved.label} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LiveEntryCornerMenu({ entry }: { entry: ContextStreamLiveEntry }) {
  const [open, setOpen] = useState(false);
  const menuConfig = entry.menu;
  const copyItems: readonly ContextStreamCopyItem[] =
    menuConfig?.copyItems || (entry.text ? [{ label: "Copy status text", value: entry.text }] : []);
  const actions: readonly ContextStreamMenuAction[] = menuConfig?.actions || [];

  return (
    <div
      data-slot="message-hover-actions"
      className={cn(
        "absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-md transition-all",
        open
          ? "border border-border bg-background p-0.5 shadow-xs"
          : "group-hover/msg:-top-2.5 group-hover/msg:border group-hover/msg:border-border group-hover/msg:bg-background group-hover/msg:p-0.5 group-hover/msg:shadow-xs group-focus-within/msg:-top-2.5 group-focus-within/msg:border group-focus-within/msg:border-border group-focus-within/msg:bg-background group-focus-within/msg:p-0.5 group-focus-within/msg:shadow-xs",
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              data-slot="message-more-trigger"
              aria-label="In-progress message options and details"
              className={cn(
                "inline-flex size-6 cursor-pointer items-center justify-center rounded transition-opacity hover:bg-muted hover:text-foreground",
                open
                  ? "text-foreground opacity-100"
                  : "text-muted-foreground opacity-35 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100",
              )}
            />
          }
        >
          <MoreHorizontalIcon className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          data-slot="message-more-menu"
          className="flex w-64 flex-col gap-1.5 p-2 text-xs"
        >
          {copyItems.map((item) => (
            <MenuCopyRow key={item.label} entry={item} />
          ))}
          {menuConfig?.provenance ? (
            <div
              data-slot="message-provenance"
              className="mt-0.5 rounded-md border border-border/70 bg-muted/35 p-2 text-2xs leading-relaxed text-muted-foreground"
            >
              {menuConfig.provenance}
            </div>
          ) : (
            <div
              data-slot="message-provenance"
              className="mt-0.5 rounded-md border border-border/70 bg-muted/35 p-2 text-2xs leading-relaxed text-muted-foreground"
            >
              Response in progress…
            </div>
          )}
          {actions.map((actItem) => (
            <button
              key={actItem.label}
              type="button"
              onClick={() => {
                setOpen(false);
                actItem.onSelect();
              }}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-medium text-foreground hover:bg-muted"
            >
              <span className="truncate">{actItem.label}</span>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function DefaultLiveEntryBody({ entry, label }: { entry: ContextStreamLiveEntry; label: string }) {
  if (entry.kind === "typing") {
    return (
      <span className="flex h-5 items-center gap-1" aria-label={`${label} is typing`}>
        <span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse" />
        <span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse [animation-delay:150ms]" />
        <span className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse [animation-delay:300ms]" />
      </span>
    );
  }
  if (entry.text) {
    return <span className="shimmer block truncate text-sm font-medium">{entry.text}</span>;
  }
  return null;
}

const ContextStreamRow = memo(function ContextStreamRow({
  item,
  continuesRun,
  actor,
  agentName,
  onOpen,
  onToggleReaction,
  messageMenu,
  rows,
  under,
}: {
  item: ContextStreamItem;
  continuesRun: boolean;
  actor: (ref: ContextStreamActorRef) => ContextStreamActorIdentity;
  agentName: string;
  onOpen: ((target: ContextStreamOpenTarget) => void) | undefined;
  onToggleReaction: ((offset: number, emoji: string) => void) | undefined;
  messageMenu:
    | ((item: ContextStreamMessageItem) => ContextStreamMessageMenu | undefined)
    | undefined;
  rows: Readonly<Record<string, (item: ContextStreamCustomItem) => ReactNode>> | undefined;
  under: ((item: ContextStreamItem) => ReactNode) | undefined;
}) {
  if (item.kind === "day") {
    return (
      <div className="flex items-center gap-3 py-2.5" data-slot="context-stream-day">
        <div className="h-px flex-1 bg-border/70" />
        <span className="shrink-0 whitespace-nowrap text-xs font-medium text-muted-foreground">
          {item.label}
        </span>
        <div className="h-px flex-1 bg-border/70" />
      </div>
    );
  }

  if (item.kind === "subcontext") {
    const resolved = actor(item.by);
    return (
      <div className={cn(GUTTER_GRID, "items-center py-1.5")} data-slot="context-stream-subcontext">
        <span className="inline-flex size-8 items-center justify-center self-start">
          <Face small {...actorFaceProps(resolved, agentName)} label={resolved.label} />
        </span>
        <div className="min-w-0">
          <SubcontextBar
            preview={item.subcontext}
            actor={actor}
            agentName={agentName}
            onOpen={onOpen}
          />
        </div>
      </div>
    );
  }

  if (item.kind !== "message") {
    const customRenderer = rows?.[item.kind];
    if (!customRenderer) return null;
    const resolved = actor(item.by);
    return (
      <div
        className={cn(GUTTER_GRID, "items-start py-1.5")}
        data-slot="context-stream-custom"
        data-item-kind={item.kind}
      >
        <span className="inline-flex size-8 items-center justify-center self-start pt-0.5">
          <Face small {...actorFaceProps(resolved, agentName)} label={resolved.label} />
        </span>
        <div className="min-w-0">{customRenderer(item)}</div>
      </div>
    );
  }

  return (
    <ContextStreamMessageRow
      item={item}
      continuesRun={continuesRun}
      actor={actor}
      agentName={agentName}
      onOpen={onOpen}
      onToggleReaction={onToggleReaction}
      messageMenu={messageMenu}
      under={under}
    />
  );
});

function ContextStreamMessageRow({
  item,
  continuesRun,
  actor,
  agentName,
  onOpen,
  onToggleReaction,
  messageMenu,
  under,
}: {
  item: ContextStreamMessageItem;
  continuesRun: boolean;
  actor: (ref: ContextStreamActorRef) => ContextStreamActorIdentity;
  agentName: string;
  onOpen: ((target: ContextStreamOpenTarget) => void) | undefined;
  onToggleReaction: ((offset: number, emoji: string) => void) | undefined;
  messageMenu:
    | ((item: ContextStreamMessageItem) => ContextStreamMessageMenu | undefined)
    | undefined;
  under: ((item: ContextStreamItem) => ReactNode) | undefined;
}) {
  const resolved = actor(item.by);
  const underNode = under?.(item);
  const subcontexts = item.subcontexts || [];
  const menuConfig = messageMenu?.(item);

  return (
    <div
      data-slot="context-stream-message"
      data-actor={item.by.id}
      data-continues-run={continuesRun ? "true" : undefined}
      className={cn(
        GUTTER_GRID,
        "group/msg relative -mx-2 gap-y-0.5 rounded-md px-2 transition-colors hover:bg-muted/55 focus-within:bg-muted/55",
        continuesRun ? "py-1" : "pt-2.5 pb-1",
      )}
    >
      <MessageCornerControls
        item={item}
        primarySubcontextPath={subcontexts[0]?.path}
        menuConfig={menuConfig}
        onOpen={onOpen}
        onToggleReaction={onToggleReaction}
      />

      {continuesRun ? (
        <StackedGutterTimestamp at={item.at} />
      ) : (
        <MessageRunHeader resolved={resolved} agentName={agentName} item={item} />
      )}

      <div
        className={cn(
          "col-start-2 flex min-w-0 flex-col gap-1 pr-7",
          !continuesRun && "row-start-2",
        )}
      >
        <span className="sr-only">{`${resolved.label}:`}</span>
        <MessageBody item={item} />
        <MessageUnderBar
          offset={item.offset}
          reactions={item.reactions}
          underNode={underNode}
          onToggleReaction={onToggleReaction}
        />
        {subcontexts.length > 0 ? (
          <MessageSubcontextStack
            anchorOffset={item.offset}
            subcontexts={subcontexts}
            actor={actor}
            agentName={agentName}
            onOpen={onOpen}
          />
        ) : null}
      </div>
    </div>
  );
}

function StackedGutterTimestamp({ at }: { at: number }) {
  const short = formatGutterHoverTime(at);
  if (!short) return null;
  return (
    <time
      data-slot="stacked-hover-time"
      className="pointer-events-none col-start-1 row-start-1 self-start pt-1 text-right text-2xs leading-none text-muted-foreground tabular-nums opacity-0 transition-opacity select-none group-hover/msg:opacity-100 group-focus-within/msg:opacity-100"
    >
      {short}
    </time>
  );
}

function MessageRunHeader({
  resolved,
  agentName,
  item,
}: {
  resolved: ContextStreamActorIdentity;
  agentName: string;
  item: ContextStreamMessageItem;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="col-start-1 row-start-1 row-span-2 inline-flex size-8 self-start pt-0.5"
      >
        <Face {...actorFaceProps(resolved, agentName)} />
      </span>
      <div className="col-start-2 row-start-1 flex items-baseline gap-2 pr-7">
        <span
          data-said-by
          title={resolved.label}
          className="truncate text-sm font-bold text-foreground"
        >
          {resolved.name}
        </span>
        <time className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {formatShortTime(item.at)}
        </time>
        {item.editedAt ? (
          <span className="shrink-0 whitespace-nowrap text-2xs text-muted-foreground">
            (edited)
          </span>
        ) : null}
      </div>
    </>
  );
}

/** Faint right-aligned `•••` at rest (always tappable on mobile) that expands into a Slack-style
 *  corner hover toolbar (`👍`, `🚀`, `Reply in thread`, `•••`) on hover or while open. */
function MessageCornerControls({
  item,
  primarySubcontextPath,
  menuConfig,
  onOpen,
  onToggleReaction,
}: {
  item: ContextStreamMessageItem;
  primarySubcontextPath: string | undefined;
  menuConfig: ContextStreamMessageMenu | undefined;
  onOpen: ((target: ContextStreamOpenTarget) => void) | undefined;
  onToggleReaction: ((offset: number, emoji: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const targetSubcontext = primarySubcontextPath || `t/${String(item.offset)}`;

  return (
    <div
      data-slot="message-hover-actions"
      className={cn(
        "absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-md transition-all",
        open
          ? "border border-border bg-background p-0.5 shadow-xs"
          : "group-hover/msg:-top-2.5 group-hover/msg:border group-hover/msg:border-border group-hover/msg:bg-background group-hover/msg:p-0.5 group-hover/msg:shadow-xs group-focus-within/msg:-top-2.5 group-focus-within/msg:border group-focus-within/msg:border-border group-focus-within/msg:bg-background group-focus-within/msg:p-0.5 group-focus-within/msg:shadow-xs",
      )}
    >
      <HoverQuickButtons
        visible={open}
        offset={item.offset}
        targetSubcontext={targetSubcontext}
        onOpen={onOpen}
        onToggleReaction={onToggleReaction}
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              data-slot="message-more-trigger"
              aria-label="Message options and details"
              className={cn(
                "inline-flex size-6 cursor-pointer items-center justify-center rounded transition-opacity hover:bg-muted hover:text-foreground",
                open
                  ? "text-foreground opacity-100"
                  : "text-muted-foreground opacity-35 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100",
              )}
            />
          }
        >
          <MoreHorizontalIcon className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          data-slot="message-more-menu"
          className="flex w-64 flex-col gap-1.5 p-2 text-xs"
        >
          <MessageMoreMenuBody
            item={item}
            targetSubcontext={targetSubcontext}
            menuConfig={menuConfig}
            onOpen={onOpen}
            onClose={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function HoverQuickButtons({
  visible,
  offset,
  targetSubcontext,
  onOpen,
  onToggleReaction,
}: {
  visible: boolean;
  offset: number;
  targetSubcontext: string;
  onOpen: ((target: ContextStreamOpenTarget) => void) | undefined;
  onToggleReaction: ((offset: number, emoji: string) => void) | undefined;
}) {
  const showClass = visible
    ? "inline-flex"
    : "hidden group-hover/msg:inline-flex group-focus-within/msg:inline-flex";

  return (
    <>
      {onToggleReaction ? (
        <>
          <button
            type="button"
            aria-label="React with thumbs up"
            onClick={() => onToggleReaction(offset, "👍")}
            className={cn(
              showClass,
              "size-6 cursor-pointer items-center justify-center rounded text-xs hover:bg-muted",
            )}
          >
            👍
          </button>
          <button
            type="button"
            aria-label="React with rocket"
            onClick={() => onToggleReaction(offset, "🚀")}
            className={cn(
              showClass,
              "size-6 cursor-pointer items-center justify-center rounded text-xs hover:bg-muted",
            )}
          >
            🚀
          </button>
        </>
      ) : null}
      {onOpen ? (
        <button
          type="button"
          aria-label="Reply in thread"
          title="Reply in thread"
          onClick={() => onOpen({ subcontext: targetSubcontext, anchor: offset })}
          className={cn(
            showClass,
            "size-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <MessageSquareTextIcon className="size-3.5" />
        </button>
      ) : null}
    </>
  );
}

function MessageMoreMenuBody({
  item,
  targetSubcontext,
  menuConfig,
  onOpen,
  onClose,
}: {
  item: ContextStreamMessageItem;
  targetSubcontext: string;
  menuConfig: ContextStreamMessageMenu | undefined;
  onOpen: ((target: ContextStreamOpenTarget) => void) | undefined;
  onClose: () => void;
}) {
  const copyItems: readonly ContextStreamCopyItem[] = menuConfig?.copyItems || [
    { label: "Copy message text", value: item.text },
  ];
  const actions: readonly ContextStreamMenuAction[] = menuConfig?.actions || [];

  return (
    <>
      {onOpen ? (
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpen({ subcontext: targetSubcontext, anchor: item.offset });
          }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-muted"
        >
          <MessageSquareTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span>Reply in thread</span>
        </button>
      ) : null}

      {copyItems.map((entry) => (
        <MenuCopyRow key={entry.label} entry={entry} />
      ))}

      {menuConfig?.provenance ? (
        <div
          data-slot="message-provenance"
          className="mt-0.5 rounded-md border border-border/70 bg-muted/35 p-2 text-2xs leading-relaxed text-muted-foreground"
        >
          {menuConfig.provenance}
        </div>
      ) : null}

      {actions.map((actItem) => (
        <button
          key={actItem.label}
          type="button"
          onClick={() => {
            onClose();
            actItem.onSelect();
          }}
          className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-medium text-foreground hover:bg-muted"
        >
          <span className="truncate">{actItem.label}</span>
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      ))}
    </>
  );
}

function MenuCopyRow({ entry }: { entry: ContextStreamCopyItem }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(entry.value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1_200);
      }}
      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-muted"
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        {copied ? (
          <CheckIcon className="size-3.5 shrink-0 text-success" />
        ) : (
          <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("truncate", entry.mono && "font-mono text-2xs")}>{entry.label}</span>
      </span>
    </button>
  );
}

function MessageBody({ item }: { item: ContextStreamMessageItem }) {
  if (item.deleted) {
    return <p className="m-0 text-sm italic text-muted-foreground">This message was deleted.</p>;
  }
  return (
    <Streamdown
      className="min-w-0 max-w-full text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      mode="static"
      parseIncompleteMarkdown={false}
    >
      {item.text}
    </Streamdown>
  );
}

function MessageUnderBar({
  offset,
  reactions,
  underNode,
  onToggleReaction,
}: {
  offset: number;
  reactions: ContextStreamMessageItem["reactions"];
  underNode: ReactNode;
  onToggleReaction: ((offset: number, emoji: string) => void) | undefined;
}) {
  const hasReactions = Boolean(reactions && reactions.length > 0);
  if (!hasReactions && !underNode) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
      {reactions?.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggleReaction?.(offset, r.emoji)}
          className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border border-border/70 bg-background px-2 text-2xs text-foreground hover:bg-muted"
        >
          <span>{r.emoji}</span>
          <span className="font-mono tabular-nums text-muted-foreground">{r.by.length}</span>
        </button>
      ))}
      {underNode}
    </div>
  );
}

function MessageSubcontextStack({
  anchorOffset,
  subcontexts,
  actor,
  agentName,
  onOpen,
}: {
  anchorOffset: number;
  subcontexts: readonly SubcontextPreview[];
  actor: (ref: ContextStreamActorRef) => ContextStreamActorIdentity;
  agentName: string;
  onOpen: ((target: ContextStreamOpenTarget) => void) | undefined;
}) {
  const shown = subcontexts.slice(0, MAX_INLINE_SUBCONTEXT_BARS);
  const overflow = Math.max(0, subcontexts.length - shown.length);
  return (
    <div className="flex flex-col items-start gap-1 pt-0.5" data-slot="subcontext-bars">
      {shown.map((sub) => (
        <SubcontextBar
          key={sub.path}
          preview={sub}
          actor={actor}
          agentName={agentName}
          onOpen={onOpen}
        />
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          onClick={() =>
            onOpen?.({
              subcontext: subcontexts[MAX_INLINE_SUBCONTEXT_BARS]!.path,
              anchor: anchorOffset,
            })
          }
          className="cursor-pointer px-1 text-2xs text-muted-foreground hover:text-foreground"
        >
          +{overflow} more threads
        </button>
      ) : null}
    </div>
  );
}

/** Slack-style thread reply bar (`[i] [face] 5 replies • Unread`). */
function SubcontextBar({
  preview,
  actor,
  agentName,
  onOpen,
}: {
  preview: SubcontextPreview;
  actor: (ref: ContextStreamActorRef) => ContextStreamActorIdentity;
  agentName: string;
  onOpen: ((target: ContextStreamOpenTarget) => void) | undefined;
}) {
  const faces = preview.participants.slice(0, 4);
  const summaryText = preview.live?.text || preview.last?.text || preview.title;
  const countLabel = preview.replies === 1 ? "1 reply" : `${String(preview.replies)} replies`;

  return (
    <button
      type="button"
      data-slot="subcontext-bar"
      data-subcontext-path={preview.path}
      onClick={() => onOpen?.({ subcontext: preview.path, anchor: preview.anchor })}
      className="group/sub inline-flex h-7 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 -ml-1.5 text-left text-xs transition-colors hover:bg-background hover:ring-1 hover:ring-border"
    >
      {faces.length > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-1">
          {faces.map((p) => {
            const resolved = actor(p);
            return (
              <Face
                key={`${p.kind}:${p.id}`}
                small
                {...actorFaceProps(resolved, agentName)}
                className="size-5"
              />
            );
          })}
        </span>
      ) : (
        <MessageSquareTextIcon className="size-3.5 shrink-0 text-primary" />
      )}
      <span className="shrink-0 whitespace-nowrap font-semibold text-primary group-hover/sub:underline">
        {preview.title ? `${preview.title} · ${countLabel}` : countLabel}
      </span>
      <SubcontextSecondaryLabel
        unread={preview.unread}
        live={Boolean(preview.live)}
        summaryText={summaryText}
      />
      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/sub:opacity-100" />
    </button>
  );
}

function SubcontextSecondaryLabel({
  unread,
  live,
  summaryText,
}: {
  unread: boolean | undefined;
  live: boolean;
  summaryText: string | undefined;
}) {
  if (unread) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-destructive">
        <span className="size-1.5 rounded-full bg-destructive" />
        <span>Unread</span>
      </span>
    );
  }
  if (!summaryText) return null;
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-muted-foreground",
        live && "shimmer text-foreground/90",
      )}
    >
      {summaryText}
    </span>
  );
}
