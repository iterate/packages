// Renders a context's live Activity Stack (`ContextActivity[]`):
// - `mode="pill"` (default): compact capsule with deduplicated site favicons / symbolic / emoji icons,
//   a smooth ticker cycling through active parallel items, a quiet count (`1/3`),
//   and a click popover listing active work with targets and expiration countdowns.
// - `mode="lip"`: single slim composer-attached strip merging agent status (`Thinking · <model>`)
//   and active parallel activities (`0px` when Idle and stack empty).
// - `mode="inline"`: single-line summary for ContextCatalogRow and compact headers.
import { memo, useEffect, useMemo, useState } from "react";
import {
  BlocksIcon,
  BotIcon,
  ChevronUpIcon,
  CircleIcon,
  CodeIcon,
  ExternalLinkIcon,
  GlobeIcon,
  SearchIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { cn } from "cn";
import {
  activeContextActivities,
  activityFaviconHref,
  activitySymbolicKind,
  type ContextActivity,
} from "./context-activity-stack.ts";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";

/** How often the pill advances to the next active item on the stack while multiple run at once. */
const TICKER_INTERVAL_MS = 2_200;

export type ActivityLipStatus = {
  text: string;
  tone: "live" | "amber" | "muted";
  detail?: string;
};

/** Reactively filters `activities` to items still live now, scheduling a single `setTimeout` for
 *  the next `expiresAt` boundary instead of polling on an interval. */
export function useActiveContextActivities(
  activities: readonly ContextActivity[] | undefined,
  givenNowMs?: number,
): ContextActivity[] {
  const [clock, setClock] = useState(() => Date.now());
  const nowMs = givenNowMs ?? clock;
  const active = useMemo(() => activeContextActivities(activities, nowMs), [activities, nowMs]);

  useEffect(() => {
    if (givenNowMs !== undefined || !activities || activities.length === 0) return;
    const now = Date.now();
    let earliestExpiry = Infinity;
    let alreadyExpired = false;
    for (const item of activities) {
      if (!item.expiresAt) continue;
      const at = Date.parse(item.expiresAt);
      if (!Number.isFinite(at)) continue;
      if (at <= now) alreadyExpired = true;
      else if (at < earliestExpiry) earliestExpiry = at;
    }
    if (alreadyExpired) {
      setClock(now);
      return;
    }
    if (!Number.isFinite(earliestExpiry)) return;
    const delayMs = Math.min(Math.max(1, earliestExpiry - now + 5), 2_147_483_647);
    const timer = setTimeout(() => setClock(Date.now()), delayMs);
    return () => clearTimeout(timer);
  }, [activities, givenNowMs, clock]);

  return active;
}

export const ContextActivityStack = memo(function ContextActivityStack({
  activities,
  nowMs: givenNowMs,
  mode = "pill",
  compact = false,
  status,
  faviconForHost,
  onOpenPath,
  className,
}: {
  activities: readonly ContextActivity[] | undefined;
  /** Clock override for deterministic tests; when omitted, wakes at each item's `expiresAt`. */
  nowMs?: number;
  mode?: "pill" | "inline" | "lip";
  /** Hides tag rollup chips on narrow pills (sidebar rows, compact cards) while keeping the popover. */
  compact?: boolean;
  /** Optional agent/context turn status folded into `mode="lip"` (hiding `"Idle"`). */
  status?: ActivityLipStatus;
  /** Optional custom hostname → favicon URL resolver. */
  faviconForHost?: (hostname: string) => string;
  /** Navigates in-page when an item's `url` is a context path (`/agents/...`). */
  onOpenPath?: (path: string) => void;
  className?: string;
}) {
  const active = useActiveContextActivities(activities, givenNowMs);
  const nowMs = givenNowMs ?? Date.now();
  const visibleStatus = status?.text && status.text !== "Idle" ? status : undefined;

  if (active.length === 0) {
    if (mode === "lip" && visibleStatus) {
      return <LipStatusOnly status={visibleStatus} className={className} />;
    }
    return null;
  }

  if (mode === "inline") {
    return (
      <InlineActivitySummary
        active={active}
        faviconForHost={faviconForHost}
        className={className}
      />
    );
  }

  return (
    <InteractiveActivityStack
      active={active}
      givenNowMs={givenNowMs}
      nowMs={nowMs}
      mode={mode}
      compact={compact}
      visibleStatus={visibleStatus}
      faviconForHost={faviconForHost}
      onOpenPath={onOpenPath}
      className={className}
    />
  );
});

function LipStatusOnly({ status, className }: { status: ActivityLipStatus; className?: string }) {
  return (
    <div
      data-slot="agent-foot-status"
      data-composer-lip="status"
      data-status={status.tone}
      title={status.detail}
      className={cn(
        "flex h-5 min-w-0 items-center gap-1.5 text-2xs text-muted-foreground",
        className,
      )}
    >
      <StatusToneDot tone={status.tone} />
      <span className={cn("truncate", status.tone === "live" && "shimmer")}>{status.text}</span>
    </div>
  );
}

function StatusToneDot({ tone }: { tone: ActivityLipStatus["tone"] }) {
  return (
    <CircleIcon
      className={cn(
        "size-1.5 shrink-0",
        tone === "live" && "animate-pulse fill-success text-success",
        tone === "amber" && "fill-warning text-warning",
        tone === "muted" && "fill-muted-foreground/40 text-muted-foreground/40",
      )}
    />
  );
}

function InlineActivitySummary({
  active,
  faviconForHost,
  className,
}: {
  active: readonly ContextActivity[];
  faviconForHost: ((hostname: string) => string) | undefined;
  className?: string;
}) {
  const current = active[0]!;
  const stackPreview = deduplicatedIcons(active, faviconForHost).slice(0, 3);
  return (
    <span
      data-slot="context-activity-inline"
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-2xs text-foreground/90",
        className,
      )}
    >
      <span className="inline-flex shrink-0 -space-x-1">
        {stackPreview.map((item) => (
          <ContextActivityIcon
            key={item.key}
            item={item}
            faviconForHost={faviconForHost}
            className="size-3.5 ring-1 ring-background"
          />
        ))}
      </span>
      <span className="shimmer min-w-0 truncate">{current.text}</span>
      {active.length > 1 ? (
        <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-1.5 text-2xs text-muted-foreground tabular-nums">
          +{active.length - 1}
        </span>
      ) : null}
    </span>
  );
}

function InteractiveActivityStack({
  active,
  givenNowMs,
  nowMs,
  mode,
  compact,
  visibleStatus,
  faviconForHost,
  onOpenPath,
  className,
}: {
  active: readonly ContextActivity[];
  givenNowMs: number | undefined;
  nowMs: number;
  mode: "pill" | "lip";
  compact: boolean;
  visibleStatus: ActivityLipStatus | undefined;
  faviconForHost: ((hostname: string) => string) | undefined;
  onOpenPath: ((path: string) => void) | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const tick = useTickerIndex(active.length > 1 && !hovered && !open);

  const currentIndex = active.length > 1 ? tick % active.length : 0;
  const current = active[currentIndex]!;
  const stackPreview = useMemo(
    () => deduplicatedIcons(active, faviconForHost).slice(0, 3),
    [active, faviconForHost],
  );

  const liveCountdown = useExpiringClock(
    givenNowMs === undefined &&
      open &&
      active.some((item) => Boolean(item.pushedAt || item.expiresAt)),
  );
  const popoverNowMs = givenNowMs ?? (open ? liveCountdown : nowMs);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <ActivityTriggerButton
            mode={mode}
            compact={compact}
            open={open}
            activeCount={active.length}
            currentIndex={currentIndex}
            current={current}
            stackPreview={stackPreview}
            visibleStatus={visibleStatus}
            faviconForHost={faviconForHost}
            onHoverChange={setHovered}
            className={className}
          />
        }
      />
      <PopoverContent
        align="start"
        className="flex max-h-80 w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 overflow-y-auto p-2.5 text-xs"
      >
        <ActivityPopoverBody
          active={active}
          visibleStatus={visibleStatus}
          nowMs={popoverNowMs}
          faviconForHost={faviconForHost}
          onNavigate={
            onOpenPath
              ? (target) => {
                  setOpen(false);
                  onOpenPath(target);
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}

function ActivityTriggerButton({
  mode,
  compact,
  open,
  activeCount,
  currentIndex,
  current,
  stackPreview,
  visibleStatus,
  faviconForHost,
  onHoverChange,
  className,
  ...triggerProps
}: {
  mode: "pill" | "lip";
  compact: boolean;
  open: boolean;
  activeCount: number;
  currentIndex: number;
  current: ContextActivity;
  stackPreview: readonly ContextActivity[];
  visibleStatus: ActivityLipStatus | undefined;
  faviconForHost: ((hostname: string) => string) | undefined;
  onHoverChange: (hovered: boolean) => void;
  className?: string;
} & React.ComponentPropsWithoutRef<"button">) {
  const isLip = mode === "lip";
  const compactStatusBadge = visibleStatus?.text.replace(/^Thinking\s*·\s*/i, "");
  return (
    <button
      {...triggerProps}
      type="button"
      data-slot="context-activity-pill"
      data-composer-lip={isLip ? "stack" : undefined}
      onMouseEnter={(event) => {
        triggerProps.onMouseEnter?.(event);
        onHoverChange(true);
      }}
      onMouseLeave={(event) => {
        triggerProps.onMouseLeave?.(event);
        onHoverChange(false);
      }}
      aria-label={`Active stack: ${String(activeCount)} ${activeCount === 1 ? "activity" : "activities"}`}
      className={cn(
        isLip
          ? "group flex h-5 w-full min-w-0 items-center gap-2 text-left text-2xs text-foreground/90 transition-colors hover:text-foreground"
          : "group inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border/80 bg-background/95 px-2.5 text-xs text-foreground shadow-2xs transition-colors hover:bg-muted/70",
        compact && !isLip && "h-6 px-2 text-2xs shadow-none",
        className,
      )}
    >
      <span
        className="inline-flex shrink-0 items-center -space-x-1.5"
        data-slot="activity-icon-stack"
      >
        {stackPreview.map((item) => (
          <ContextActivityIcon
            key={item.key}
            item={item}
            faviconForHost={faviconForHost}
            className={
              isLip || compact ? "size-3.5 ring-1 ring-background" : "size-4 ring-2 ring-background"
            }
          />
        ))}
      </span>
      <span
        key={current.key}
        data-slot="activity-ticker-item"
        className="shimmer min-w-0 flex-1 truncate font-medium"
      >
        {current.text}
      </span>
      {isLip && visibleStatus ? (
        <span
          data-slot="agent-foot-status"
          data-status={visibleStatus.tone}
          title={visibleStatus.text}
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-2xs text-muted-foreground"
        >
          <StatusToneDot tone={visibleStatus.tone} />
          <span className="max-w-28 truncate">{compactStatusBadge}</span>
        </span>
      ) : null}
      {activeCount > 1 ? (
        <span className="shrink-0 whitespace-nowrap font-mono text-2xs text-muted-foreground tabular-nums">
          {currentIndex + 1}/{activeCount}
        </span>
      ) : null}
      <ChevronUpIcon
        aria-hidden
        className={cn(
          "size-3 shrink-0 text-muted-foreground transition-transform",
          open && "rotate-180",
        )}
      />
    </button>
  );
}

function ActivityPopoverBody({
  active,
  visibleStatus,
  nowMs,
  faviconForHost,
  onNavigate,
}: {
  active: readonly ContextActivity[];
  visibleStatus: ActivityLipStatus | undefined;
  nowMs: number;
  faviconForHost: ((hostname: string) => string) | undefined;
  onNavigate: ((path: string) => void) | undefined;
}) {
  return (
    <>
      {visibleStatus ? (
        <div className="px-2 pt-0.5 text-2xs text-muted-foreground">{visibleStatus.text}</div>
      ) : null}
      <ul className="flex flex-col gap-0.5" data-slot="activity-stack-list">
        {active.map((item) => (
          <ActivityStackRow
            key={item.key}
            item={item}
            nowMs={nowMs}
            faviconForHost={faviconForHost}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </>
  );
}

function ActivityStackRow({
  item,
  nowMs,
  faviconForHost,
  onNavigate,
}: {
  item: ContextActivity;
  nowMs: number;
  faviconForHost: ((hostname: string) => string) | undefined;
  onNavigate: ((path: string) => void) | undefined;
}) {
  const elapsed = elapsedDurationLabel(item.pushedAt, nowMs);
  const ttlLabel = remainingTtlLabel(item.expiresAt, nowMs);
  const timingLabel = elapsed || ttlLabel;
  const subtitle = activityTargetLabel(item);
  return (
    <li
      data-activity-key={item.key}
      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60"
    >
      <ContextActivityIcon
        item={item}
        faviconForHost={faviconForHost}
        className="size-4 shrink-0"
      />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <ActivityItemTitle item={item} onNavigate={onNavigate} />
        {subtitle ? (
          <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </div>
      {timingLabel ? (
        <span
          title={
            item.expiresAt
              ? `Expires at ${item.expiresAt}`
              : item.pushedAt
                ? `Started at ${item.pushedAt}`
                : undefined
          }
          className="shrink-0 font-mono text-2xs text-muted-foreground tabular-nums"
        >
          {timingLabel}
        </span>
      ) : null}
    </li>
  );
}

function activityTargetLabel(item: ContextActivity): string | undefined {
  if (!item.url) return undefined;
  if (item.url.startsWith("/")) return item.url;
  try {
    return new URL(item.url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function ActivityItemTitle({
  item,
  onNavigate,
}: {
  item: ContextActivity;
  onNavigate: ((path: string) => void) | undefined;
}) {
  if (item.url?.startsWith("/") && onNavigate) {
    const target = item.url;
    return (
      <button
        type="button"
        onClick={() => onNavigate(target)}
        className="truncate text-left font-medium hover:underline"
      >
        {item.text}
      </button>
    );
  }
  if (item.url && /^https?:\/\//i.test(item.url)) {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-w-0 items-center gap-1 truncate font-medium hover:underline"
      >
        <span className="truncate">{item.text}</span>
        <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      </a>
    );
  }
  return <span className="truncate font-medium">{item.text}</span>;
}

/** Renders the website favicon (falling back to a symbolic icon if the image fails) or the
 *  activity's symbolic/emoji icon inside a crisp circular badge. */
export function ContextActivityIcon({
  item,
  faviconForHost,
  className,
}: {
  item: Pick<ContextActivity, "key" | "icon" | "url" | "tags">;
  faviconForHost?: (hostname: string) => string;
  className?: string;
}) {
  const favicon = activityFaviconHref(item, faviconForHost);
  const [failedHref, setFailedHref] = useState<string>();
  if (favicon && failedHref !== favicon) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center overflow-hidden rounded-full bg-background",
          className,
        )}
      >
        <img
          src={favicon}
          alt=""
          className="size-full object-contain"
          onError={() => setFailedHref(favicon)}
        />
      </span>
    );
  }
  const symbolic = activitySymbolicKind(item);
  if (symbolic.kind === "emoji") {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-background text-2xs leading-none",
          className,
        )}
      >
        {symbolic.glyph}
      </span>
    );
  }
  const Icon = SYMBOLIC_ICON_MAP[symbolic.kind];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-background text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-2.5" />
    </span>
  );
}

const SYMBOLIC_ICON_MAP = {
  agent: BotIcon,
  claude: SquareTerminalIcon,
  mcp: BlocksIcon,
  code: CodeIcon,
  search: SearchIcon,
  web: GlobeIcon,
} as const;

function deduplicatedIcons(
  items: readonly ContextActivity[],
  faviconForHost: ((hostname: string) => string) | undefined,
): ContextActivity[] {
  const seen = new Set<string>();
  const picked: ContextActivity[] = [];
  for (const item of items) {
    const signature =
      activityFaviconHref(item, faviconForHost) || JSON.stringify(activitySymbolicKind(item));
    if (seen.has(signature)) continue;
    seen.add(signature);
    picked.push(item);
  }
  return picked;
}

function elapsedDurationLabel(pushedAt: string | undefined, nowMs: number): string | null {
  if (!pushedAt) return null;
  const elapsedSec = Math.floor((nowMs - Date.parse(pushedAt)) / 1_000);
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return null;
  if (elapsedSec < 60) return `${String(elapsedSec)}s`;
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  if (minutes < 60)
    return seconds === 0
      ? `${String(minutes)}m`
      : `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function remainingTtlLabel(expiresAt: string | undefined, nowMs: number): string | null {
  if (!expiresAt) return null;
  const remainingSec = Math.ceil((Date.parse(expiresAt) - nowMs) / 1_000);
  if (!Number.isFinite(remainingSec) || remainingSec <= 0) return null;
  if (remainingSec < 60) return `${String(remainingSec)}s`;
  return `${String(Math.ceil(remainingSec / 60))}m`;
}

function useTickerIndex(enabled: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setTick((count) => count + 1), TICKER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return tick;
}

function useExpiringClock(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}
