// context-icon.tsx — A CONTEXT'S ICON AT ANY SIZE (`xs`..`xl`), WITH LIVE STATUS, CURRENT ACTIVITY
// OVERLAY, AND HOVER TOOLTIP (title + catalog facts + current activity stack).
//
// Each context may set `metadata.icon` via `events.iterate.com/itx/described` (`describeContext`):
//   - an emoji (`"🧭"`, `"🚀"`, `"🛡️"`),
//   - a symbolic icon name (`"terminal"`, `"shield"`, `"globe"`, `"git-branch"`, …), or
//   - an image / favicon URL (`"https://…"`, `"/…"`, `"data:image/…"`).
// When unset, `ContextIcon` falls back to the agent kind's icon (`kindIcon`) or the context's
// primary processor (`repo`, `call`, `email`, `agent`).
//
// At `size="xs"` (`16px`), `ContextIcon` matches shadcn `<SidebarMenuButton>`'s exact icon slot so
// the collapsed sidebar icon rail (`collapsible="icon"`) stays pixel-identical while showing custom
// context icons and rich tooltips. At `md`..`xl`, active items on the Context Activity Stack show
// as a live corner activity badge.
import { useState, type ComponentType } from "react";
import {
  ActivityIcon,
  BotIcon,
  BugIcon,
  CloudIcon,
  CodeIcon,
  CompassIcon,
  DatabaseIcon,
  FileTextIcon,
  GitBranchIcon,
  GlobeIcon,
  LayersIcon,
  MailIcon,
  PhoneIcon,
  SettingsIcon,
  ShieldIcon,
  SparklesIcon,
  SquareTerminalIcon,
  UsersIcon,
} from "lucide-react";
import { cn } from "cn";
import {
  activeAtOf,
  contextActivitiesOf,
  contextIcon,
  contextTitle,
  formatBytes,
  timeAgo,
  type ContextIconSize,
  type ContextListing,
} from "./context-catalog-rows.ts";
import { activeContextActivities, type ContextActivity } from "./context-activity-stack.ts";
import { ContextActivityIcon, ContextActivityStack } from "./context-activity-stack-view.tsx";
import { kindIcon, STATUS_DOT } from "#/components/agent-look.ts";
import { ContextPathText } from "#/components/context-path-text.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";
import {
  agentDoing,
  agentTitle,
  subagentsLine,
  type AgentRow,
  type AgentStatus,
} from "#/lib/agent-summary.ts";

type IconComponent = ComponentType<{ className?: string; "data-agent-kind"?: string }>;

const SYMBOLIC_ICONS: Record<string, IconComponent> = {
  bot: BotIcon,
  agent: BotIcon,
  bug: BugIcon,
  cloud: CloudIcon,
  compass: CompassIcon,
  terminal: SquareTerminalIcon,
  cli: SquareTerminalIcon,
  code: CodeIcon,
  "git-branch": GitBranchIcon,
  git: GitBranchIcon,
  repo: GitBranchIcon,
  globe: GlobeIcon,
  web: GlobeIcon,
  database: DatabaseIcon,
  db: DatabaseIcon,
  shield: ShieldIcon,
  security: ShieldIcon,
  audit: ShieldIcon,
  sparkles: SparklesIcon,
  mail: MailIcon,
  email: MailIcon,
  phone: PhoneIcon,
  call: PhoneIcon,
  "file-text": FileTextIcon,
  doc: FileTextIcon,
  docs: FileTextIcon,
  layers: LayersIcon,
  activity: ActivityIcon,
  users: UsersIcon,
  settings: SettingsIcon,
};

const BOX_CLASSES: Record<ContextIconSize, string> = {
  xs: "size-4 rounded-[5px]",
  sm: "size-5 rounded-md bg-muted/60 ring-1 ring-border/75",
  md: "size-7 rounded-lg bg-muted/60 ring-1 ring-border/75",
  lg: "size-9 rounded-xl bg-muted/60 ring-1 ring-border/75",
  xl: "size-11 rounded-xl bg-muted/60 ring-1 ring-border/75",
};

function statusOutlineClasses(size: ContextIconSize, status: AgentStatus | null): string {
  if (!status) return "";
  if (status === "working") {
    return size === "xs"
      ? "bg-success/12 text-success ring-1 ring-success/75 shadow-xs shadow-success/35"
      : "bg-success/10 text-success ring-[1.5px] ring-success/75 shadow-sm shadow-success/35";
  }
  if (status === "waiting") {
    return size === "xs"
      ? "bg-warning/12 text-warning ring-1 ring-warning/80 shadow-xs shadow-warning/35"
      : "bg-warning/12 text-warning ring-[1.5px] ring-warning/80 shadow-sm shadow-warning/35";
  }
  if (status === "ended") {
    return size === "xs" ? "opacity-65" : "bg-muted/35 ring-border/50 opacity-75";
  }
  return "";
}

const GLYPH_CLASSES: Record<ContextIconSize, string> = {
  xs: "size-4",
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
  xl: "size-6",
};

const EMOJI_CLASSES: Record<ContextIconSize, string> = {
  xs: "text-xs leading-none",
  sm: "text-xs leading-none",
  md: "text-sm leading-none",
  lg: "text-lg leading-none",
  xl: "text-xl leading-none",
};

const DOT_CLASSES: Record<ContextIconSize, string> = {
  xs: "size-2 -right-0.5 -bottom-0.5 ring-2 ring-sidebar",
  sm: "size-2 -right-0.5 -bottom-0.5 ring-2 ring-background",
  md: "size-2.5 -right-0.5 -bottom-0.5 ring-2 ring-background",
  lg: "size-3 -right-0.5 -bottom-0.5 ring-2 ring-background",
  xl: "size-3.5 -right-0.5 -bottom-0.5 ring-2 ring-background",
};

const ACTIVITY_BADGE_CLASSES: Record<ContextIconSize, string> = {
  xs: "size-2.5 -right-1 -bottom-1",
  sm: "size-3 -right-1 -bottom-1",
  md: "size-3.5 -right-1 -bottom-1",
  lg: "size-4 -right-1 -bottom-1",
  xl: "size-5 -right-1 -bottom-1",
};

function isImageIconHref(value: string): boolean {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("/") ||
    value.startsWith("data:image/")
  );
}

function effectiveStatusOf(
  agent: AgentRow | undefined,
  row: ContextListing | undefined,
  hasActiveStack: boolean,
): AgentStatus | null {
  if (agent?.status) return agent.status;
  if (row?.awake || hasActiveStack) return "working";
  return null;
}

function inferSlugIcon(path: string | undefined): IconComponent | undefined {
  if (!path) return undefined;
  const lower = path.toLowerCase();
  if (lower.includes("engineering-manager") || lower.includes("coordinator")) return CompassIcon;
  if (lower.includes("sysadmin") || lower.includes("deploy") || lower.includes("ops")) {
    return SquareTerminalIcon;
  }
  if (
    lower.includes("error") ||
    lower.includes("bug") ||
    lower.includes("crash") ||
    lower.includes("fix")
  ) {
    return BugIcon;
  }
  if (
    lower.includes("audit") ||
    lower.includes("security") ||
    lower.includes("smoke") ||
    lower.includes("vault") ||
    lower.includes("passkey") ||
    lower.includes("verified") ||
    lower.includes("oauth")
  ) {
    return ShieldIcon;
  }
  if (
    lower.includes("cloud") ||
    lower.includes("zone") ||
    lower.includes("rollout") ||
    lower.includes("gateway")
  ) {
    return CloudIcon;
  }
  if (lower.includes("standup") || lower.includes("slack") || lower.includes("member")) {
    return UsersIcon;
  }
  if (
    lower.includes("r2") ||
    lower.includes("d1") ||
    lower.includes("sqlite") ||
    lower.includes("db")
  ) {
    return DatabaseIcon;
  }
  if (lower.includes("note") || lower.includes("doc") || lower.includes("task")) {
    return FileTextIcon;
  }
  return undefined;
}

function fallbackSymbolicIcon(
  agent: AgentRow | undefined,
  row: ContextListing | undefined,
  path: string | undefined,
): IconComponent {
  if (agent && agent.kind && agent.kind !== "agent") return kindIcon(agent.kind);
  const bySlug = inferSlugIcon(path);
  if (bySlug) return bySlug;
  if (agent) return kindIcon(agent.kind);
  const procs = row?.processors || [];
  if (procs.includes("repo") || path?.startsWith("/repos/")) return GitBranchIcon;
  if (procs.includes("call")) return PhoneIcon;
  if (procs.includes("email")) return MailIcon;
  if (procs.includes("agent") || path?.startsWith("/agents/")) return BotIcon;
  if (path?.startsWith("/audit")) return ShieldIcon;
  return LayersIcon;
}

export function ContextIcon({
  path: givenPath,
  icon: givenIcon,
  row,
  agent,
  activities: givenActivities,
  subagentCount,
  size = "md",
  showStatus = true,
  showActivityBadge,
  showTooltip = false,
  faviconForHost,
  nowMs = Date.now(),
  className,
}: {
  path?: string;
  /** Explicit icon override; otherwise read from `row.metadata.icon`. */
  icon?: string;
  row?: ContextListing;
  agent?: AgentRow;
  /** Explicit activity stack override; otherwise read from `row`. */
  activities?: readonly ContextActivity[];
  /** Number of subagents / child contexts, for the hover tooltip. */
  subagentCount?: number;
  size?: ContextIconSize;
  showStatus?: boolean;
  /** Shows the top active Activity Stack item's icon on the corner (defaults to `true` for `md`..`xl`). */
  showActivityBadge?: boolean;
  /** Wraps the icon in a hover tooltip showing title + catalog facts + current activity. */
  showTooltip?: boolean;
  faviconForHost?: (hostname: string) => string;
  nowMs?: number;
  className?: string;
}) {
  const path = givenPath || agent?.path || row?.path;
  const resolvedIcon = (givenIcon || contextIcon(row))?.trim() || undefined;
  const activeStack = resolveStack(givenActivities, row, nowMs);
  const status = effectiveStatusOf(agent, row, activeStack.length > 0);
  const topActivity = activeStack[0];
  const wantsActivityBadge = showActivityBadge ?? (size !== "xs" && size !== "sm");

  const visual = (
    <span
      data-slot="context-icon"
      data-size={size}
      data-context-status={status || undefined}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center transition-shadow select-none",
        BOX_CLASSES[size],
        showStatus && statusOutlineClasses(size, status),
        className,
      )}
    >
      <ContextIconGraphic
        resolvedIcon={resolvedIcon}
        agent={agent}
        row={row}
        path={path}
        size={size}
        tinted={showStatus && (status === "working" || status === "waiting")}
      />
      <ContextIconCornerBadge
        size={size}
        topActivity={wantsActivityBadge ? topActivity : undefined}
        status={showStatus ? status : null}
        faviconForHost={faviconForHost}
      />
    </span>
  );

  if (!showTooltip) return visual;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>{visual}</TooltipTrigger>
      <TooltipContent side="right" align="center" className="p-2.5">
        <ContextIconTooltipContent
          path={path}
          icon={givenIcon}
          row={row}
          agent={agent}
          activities={activeStack}
          subagentCount={subagentCount}
          faviconForHost={faviconForHost}
          nowMs={nowMs}
        />
      </TooltipContent>
    </Tooltip>
  );
}

function ContextIconGraphic({
  resolvedIcon,
  agent,
  row,
  path,
  size,
  tinted = false,
}: {
  resolvedIcon: string | undefined;
  agent: AgentRow | undefined;
  row: ContextListing | undefined;
  path: string | undefined;
  size: ContextIconSize;
  tinted?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const glyphClass = cn(GLYPH_CLASSES[size], !tinted && size !== "xs" && "text-foreground/85");
  if (resolvedIcon && isImageIconHref(resolvedIcon) && failedSrc !== resolvedIcon) {
    return (
      <img
        src={resolvedIcon}
        alt=""
        aria-hidden
        onError={() => setFailedSrc(resolvedIcon)}
        className={cn(
          "object-cover",
          size === "xs" ? "size-4 rounded-sm" : "size-full rounded-[inherit]",
        )}
      />
    );
  }
  const lower = resolvedIcon?.toLowerCase();
  const Symbolic =
    lower && Object.hasOwn(SYMBOLIC_ICONS, lower) ? SYMBOLIC_ICONS[lower] : undefined;
  if (Symbolic) return <Symbolic className={glyphClass} />;
  if (resolvedIcon) {
    return (
      <span aria-hidden className={EMOJI_CLASSES[size]}>
        {resolvedIcon}
      </span>
    );
  }
  const Fallback = fallbackSymbolicIcon(agent, row, path);
  return <Fallback data-agent-kind={agent?.kind || undefined} className={glyphClass} />;
}

function ContextIconCornerBadge({
  size,
  topActivity,
  status,
  faviconForHost,
}: {
  size: ContextIconSize;
  topActivity: ContextActivity | undefined;
  status: AgentStatus | null;
  faviconForHost: ((hostname: string) => string) | undefined;
}) {
  if (topActivity) {
    return (
      <span
        data-slot="context-icon-activity"
        title={topActivity.text}
        className={cn(
          "pointer-events-none absolute inline-flex items-center justify-center rounded-full bg-background ring-1 ring-background",
          ACTIVITY_BADGE_CLASSES[size],
        )}
      >
        <ContextActivityIcon
          item={topActivity}
          faviconForHost={faviconForHost}
          className="size-full"
        />
      </span>
    );
  }
  if (!status) return null;
  return (
    <span
      aria-hidden
      data-agent-status={status}
      title={status}
      className={cn(
        "pointer-events-none absolute rounded-full",
        DOT_CLASSES[size],
        STATUS_DOT[status],
      )}
    />
  );
}

/** Rich hover tooltip body for any context icon or collapsed sidebar rail button:
 *  shows icon + raw title + status, current activity & Activity Stack, and catalog facts. */
export function ContextIconTooltipContent({
  path: givenPath,
  icon,
  row,
  agent,
  activities: givenActivities,
  subagentCount = 0,
  line: explicitLine,
  faviconForHost,
  nowMs = Date.now(),
}: {
  path?: string;
  icon?: string;
  row?: ContextListing;
  agent?: AgentRow;
  activities?: readonly ContextActivity[];
  subagentCount?: number;
  /** Optional precomputed subtitle line (preserves `AgentTooltip` behavior when catalog is absent). */
  line?: string | null;
  faviconForHost?: (hostname: string) => string;
  nowMs?: number;
}) {
  const activeStack = resolveStack(givenActivities, row, nowMs);
  const { path, title, status } = resolveTooltipHeader({
    givenPath,
    row,
    agent,
    hasActiveStack: activeStack.length > 0,
  });
  const doing = resolveDoingLine(explicitLine, subagentCount, agent, nowMs);
  const catalogStats = row ? formatCatalogStats(row, nowMs) : null;

  return (
    <div
      data-agent-tooltip
      data-slot="context-icon-tooltip"
      className="flex max-w-72 min-w-48 flex-col gap-1.5 text-xs"
    >
      <div className="flex items-center gap-2">
        <ContextIcon
          path={path}
          icon={icon}
          row={row}
          agent={agent}
          activities={activeStack}
          size="md"
          faviconForHost={faviconForHost}
          nowMs={nowMs}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <span className="line-clamp-1 font-medium">{title}</span>
            {status ? (
              <span className="shrink-0 rounded bg-background/20 px-1 py-0.5 font-mono text-2xs opacity-80">
                {status}
              </span>
            ) : null}
          </div>
          <ContextPathText path={path} truncate className="text-2xs opacity-70" />
        </div>
      </div>
      {doing ? <div className="truncate text-2xs opacity-85">{doing}</div> : null}
      {activeStack.length > 0 ? (
        <div className="rounded bg-background/15 px-1.5 py-1">
          <ContextActivityStack
            activities={activeStack}
            nowMs={nowMs}
            mode="inline"
            faviconForHost={faviconForHost}
            className="text-background"
          />
        </div>
      ) : null}
      {row?.description ? (
        <p className="m-0 line-clamp-2 text-2xs opacity-75">{row.description}</p>
      ) : null}
      {catalogStats ? <div className="font-mono text-2xs opacity-65">{catalogStats}</div> : null}
    </div>
  );
}

function resolveStack(
  given: readonly ContextActivity[] | undefined,
  row: ContextListing | undefined,
  nowMs: number,
): ContextActivity[] {
  return given ? activeContextActivities(given, nowMs) : contextActivitiesOf(row, nowMs);
}

function resolveTooltipHeader({
  givenPath,
  row,
  agent,
  hasActiveStack,
}: {
  givenPath: string | undefined;
  row: ContextListing | undefined;
  agent: AgentRow | undefined;
  hasActiveStack: boolean;
}) {
  const path = givenPath || agent?.path || row?.path || "/";
  const title =
    (row && contextTitle(row)) ||
    (agent && agentTitle(agent)) ||
    path.split("/").filter(Boolean).at(-1) ||
    path;
  const status = effectiveStatusOf(agent, row, hasActiveStack);
  return { path, title, status };
}

function resolveDoingLine(
  explicitLine: string | null | undefined,
  subagentCount: number,
  agent: AgentRow | undefined,
  nowMs: number,
): string | null {
  if (explicitLine) return explicitLine;
  const joined = [subagentsLine(subagentCount), agent ? agentDoing(agent, nowMs) : null]
    .filter(Boolean)
    .join(" · ");
  return joined || null;
}

function formatCatalogStats(row: ContextListing, nowMs: number): string {
  const activeAgo = timeAgo(activeAtOf(row), nowMs);
  return [
    row.processors.length > 0 ? row.processors.join(" · ") : null,
    `${String(row.eventCount)} ${row.eventCount === 1 ? "event" : "events"}`,
    row.storageBytes !== undefined ? formatBytes(row.storageBytes) : null,
    row.awake ? "awake" : activeAgo ? `${activeAgo} ago` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
