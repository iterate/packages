// A context's live stack of short activities: what it is doing in parallel right now (visiting
// websites, calling MCP servers, messaging other agents), folded from two events on its log:
//
//   events.iterate.com/itx/activity-pushed  push one activity, or `items` for several at once
//   events.iterate.com/itx/activity-popped  pop one activity by `key`, `keys`, or `tag`
//
// Pushing an existing `key` updates it in place and moves it to the top of the stack (`stack[0]`).
// An item with `expiresAt` (or `ttlMs`, resolved from the push event's `createdAt`) drops out on
// its own once `nowMs` passes that instant, so work whose caller died leaves no stuck badge.
import { z } from "zod";

export const CONTEXT_ACTIVITIES_FACET = "activities";
export const CONTEXT_ACTIVITY_PUSHED_TYPE = "events.iterate.com/itx/activity-pushed";
export const CONTEXT_ACTIVITY_POPPED_TYPE = "events.iterate.com/itx/activity-popped";

/** How many active items a stack keeps: oldest at the bottom are dropped past this ceiling so a
 *  context summary stays small on the wire. */
export const CONTEXT_ACTIVITY_STACK_LIMIT = 32;

const ActivityTag = z.string().trim().min(1).max(40);

export const ContextActivity = z.object({
  key: z.string().min(1).max(120),
  text: z.string().min(1).max(160),
  /** A website origin or URL (for its favicon), an image/data URL, a symbolic kind (`agent`,
   *  `claude`, `mcp`, `code`, `search`, `web`), or an emoji glyph. */
  icon: z.string().min(1).max(500).optional(),
  /** Where the activity points: an external `https:` URL (also supplies a favicon when `icon` is
   *  absent) or a context path (`/agents/...`). */
  url: z.string().min(1).max(500).optional(),
  /** Short labels for grouping and rollups (`web`, `agent`, `mcp`, `cloudflare`, …). */
  tags: z.array(ActivityTag).max(8).optional(),
  pushedAt: z.string().optional(),
  expiresAt: z.string().optional(),
});
export type ContextActivity = z.infer<typeof ContextActivity>;

const PushedEntry = ContextActivity.omit({ pushedAt: true }).extend({
  /** Convenience TTL in ms from the push event's `createdAt` when `expiresAt` is not given. */
  ttlMs: z.number().int().positive().max(86_400_000).optional(),
});

export const ContextActivityPushedPayload = z.union([
  PushedEntry,
  z.object({ items: z.array(PushedEntry).min(1).max(CONTEXT_ACTIVITY_STACK_LIMIT) }),
]);
export type ContextActivityPushedPayload = z.infer<typeof ContextActivityPushedPayload>;

export const ContextActivityPoppedPayload = z.union([
  z.object({ key: z.string().min(1).max(120) }),
  z.object({ keys: z.array(z.string().min(1).max(120)).min(1).max(CONTEXT_ACTIVITY_STACK_LIMIT) }),
  z.object({ tag: ActivityTag }),
]);
export type ContextActivityPoppedPayload = z.infer<typeof ContextActivityPoppedPayload>;

const StackEvent = z.object({
  type: z.string(),
  createdAt: z.string().optional(),
  payload: z.unknown().optional(),
});

function isStackEventCandidate(raw: unknown): boolean {
  if (!(raw instanceof Object)) return false;
  const type: unknown = Reflect.get(raw, "type");
  return type === CONTEXT_ACTIVITY_PUSHED_TYPE || type === CONTEXT_ACTIVITY_POPPED_TYPE;
}

/** Incremental fold state for `remembered(foldContextActivityLog)`. */
export type ContextActivityLogFold = {
  log: readonly unknown[];
  initial: readonly ContextActivity[] | undefined;
  stack: readonly ContextActivity[];
};

const EMPTY_ACTIVITY_STACK: readonly ContextActivity[] = [];

/** Incremental `remembered()`-compatible reducer over a growing event log: when `log` only grew at
 *  its tail with the same `initial` seed, scans only the newly appended slice and preserves the
 *  exact `stack` array reference when no activity event arrived. */
export function foldContextActivityLog(
  held: ContextActivityLogFold | undefined,
  log: readonly unknown[],
  initial?: readonly ContextActivity[],
): ContextActivityLogFold {
  const grewAtEnd =
    held &&
    held.initial === initial &&
    held.log.length > 0 &&
    log[0] === held.log[0] &&
    log[held.log.length - 1] === held.log.at(-1);
  if (grewAtEnd && log.length === held.log.length) return held;
  const fresh = grewAtEnd ? log.slice(held.log.length) : log;
  const base = grewAtEnd ? held.stack : initial || EMPTY_ACTIVITY_STACK;
  if (!fresh.some(isStackEventCandidate)) {
    return { log, initial, stack: base };
  }
  return {
    log,
    initial,
    stack: foldContextActivities(fresh, { initial: base }),
  };
}

/** Whether `item` is still live at `nowMs`. Invalid or absent `expiresAt` does not expire. */
export function isContextActivityLive(item: ContextActivity, nowMs: number): boolean {
  if (!item.expiresAt) return true;
  const at = Date.parse(item.expiresAt);
  return !Number.isFinite(at) || at > nowMs;
}

const LiveStateActivities = z.array(ContextActivity);

/** Parses `context.liveState.activities?.value` (from `itx.facets.get("activities")`) into the
 *  validated `ContextActivity[]` array, or `undefined` while not yet loaded. */
export function contextActivitiesFromLiveState(
  value: unknown,
  nowMs?: number,
): ContextActivity[] | undefined {
  if (value === undefined) return undefined;
  const parsed = LiveStateActivities.safeParse(value);
  if (!parsed.success) return [];
  return nowMs !== undefined ? activeContextActivities(parsed.data, nowMs) : parsed.data;
}

/** `items` that have not expired at `nowMs`, keeping stack order (newest pushed first). */
export function activeContextActivities(
  items: readonly ContextActivity[] | undefined,
  nowMs = Date.now(),
): ContextActivity[] {
  if (!items || items.length === 0) return [];
  return items.filter((item) => isContextActivityLive(item, nowMs));
}

/** Folds `activity-pushed` and `activity-popped` events (durable or ephemeral) onto `initial`.
 *  `stack[0]` is the newest pushed item. Pass `nowMs` to drop items already expired at read time. */
export function foldContextActivities(
  events: readonly unknown[],
  options: { initial?: readonly ContextActivity[]; nowMs?: number } = {},
): ContextActivity[] {
  let stack = options.initial ? [...options.initial] : [];
  for (const raw of events) {
    if (!isStackEventCandidate(raw)) continue;
    const parsed = StackEvent.safeParse(raw);
    if (!parsed.success) continue;
    const { type, createdAt, payload } = parsed.data;
    if (type === CONTEXT_ACTIVITY_PUSHED_TYPE) {
      const pushed = ContextActivityPushedPayload.safeParse(payload);
      if (!pushed.success) continue;
      const entries = "items" in pushed.data ? pushed.data.items : [pushed.data];
      for (const entry of entries) {
        const normalized = toStoredActivity(entry, createdAt);
        stack = [normalized, ...stack.filter((existing) => existing.key !== normalized.key)];
      }
      if (stack.length > CONTEXT_ACTIVITY_STACK_LIMIT)
        stack = stack.slice(0, CONTEXT_ACTIVITY_STACK_LIMIT);
      continue;
    }
    if (type === CONTEXT_ACTIVITY_POPPED_TYPE) {
      const popped = ContextActivityPoppedPayload.safeParse(payload);
      if (!popped.success) continue;
      if ("key" in popped.data) {
        const target = popped.data.key;
        stack = stack.filter((item) => item.key !== target);
      } else if ("keys" in popped.data) {
        const targets = new Set(popped.data.keys);
        stack = stack.filter((item) => !targets.has(item.key));
      } else {
        const targetTag = popped.data.tag;
        stack = stack.filter((item) => !item.tags?.includes(targetTag));
      }
    }
  }
  return options.nowMs !== undefined ? activeContextActivities(stack, options.nowMs) : stack;
}

/** Groups active items by their first tag (or `"activity"` when untagged), preserving first-seen
 *  order so tag rollup chips stay stable while items update. */
export function groupContextActivitiesByTag(
  items: readonly ContextActivity[],
): { tag: string; items: ContextActivity[] }[] {
  const byTag = new Map<string, ContextActivity[]>();
  for (const item of items) {
    const tag = item.tags?.[0] || "activity";
    const bucket = byTag.get(tag);
    if (bucket) bucket.push(item);
    else byTag.set(tag, [item]);
  }
  return [...byTag.entries()].map(([tag, grouped]) => ({ tag, items: grouped }));
}

const SYMBOLIC_ICONS = new Set([
  "agent",
  "claude",
  "codex",
  "opencode",
  "mcp",
  "code",
  "search",
  "web",
]);

/** Resolves an image or favicon URL for `item`, or undefined when it names a symbolic icon or emoji.
 *  - Explicit image/data/relative asset URLs (`data:image/…`, `/favicons/…`, `https://…/icon.svg`)
 *    are used directly.
 *  - Website origins, URLs or bare domains (`https://developers.cloudflare.com/…`, `github.com`)
 *    resolve to Google's s2 favicon service for that hostname. */
export function activityFaviconHref(
  item: Pick<ContextActivity, "icon" | "url">,
  faviconForHost: (hostname: string) => string = (hostname) =>
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`,
): string | undefined {
  const rawIcon = item.icon?.trim();
  if (rawIcon) {
    if (SYMBOLIC_ICONS.has(rawIcon.toLowerCase()) || isSingleEmoji(rawIcon)) return undefined;
    if (rawIcon.startsWith("data:image/") || rawIcon.startsWith("/")) return rawIcon;
    if (/\.(svg|png|ico|webp|jpg|jpeg)(\?.*)?$/i.test(rawIcon)) return rawIcon;
    const hostFromIcon = hostnameOf(rawIcon);
    if (hostFromIcon) return faviconForHost(hostFromIcon);
  }
  const hostFromUrl = item.url ? hostnameOf(item.url) : undefined;
  return hostFromUrl ? faviconForHost(hostFromUrl) : undefined;
}

/** Symbolic fallback kind when `activityFaviconHref` is undefined (or if its image fails to load). */
export function activitySymbolicKind(
  item: Pick<ContextActivity, "icon" | "url" | "tags">,
):
  | { kind: "emoji"; glyph: string }
  | { kind: "agent" | "claude" | "mcp" | "code" | "search" | "web" } {
  const rawIcon = item.icon?.trim();
  if (rawIcon && isSingleEmoji(rawIcon)) return { kind: "emoji", glyph: rawIcon };
  const token = (rawIcon || item.tags?.[0] || "").toLowerCase();
  if (token === "claude" || token === "codex" || token === "opencode") return { kind: "claude" };
  if (token === "agent" || item.url?.startsWith("/agents/")) return { kind: "agent" };
  if (token === "mcp") return { kind: "mcp" };
  if (token === "code") return { kind: "code" };
  if (token === "search") return { kind: "search" };
  return { kind: "web" };
}

function hostnameOf(input: string): string | undefined {
  if (input.startsWith("/")) return undefined;
  try {
    const candidate = input.includes("://") ? input : `https://${input}`;
    const { hostname } = new URL(candidate);
    return hostname.includes(".") ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function isSingleEmoji(value: string): boolean {
  return value.length <= 8 && /^\p{Extended_Pictographic}/u.test(value);
}

function toStoredActivity(
  entry: z.infer<typeof PushedEntry>,
  createdAt: string | undefined,
): ContextActivity {
  const baseMs = createdAt ? Date.parse(createdAt) : Date.now();
  const computedExpiresAt =
    entry.expiresAt ||
    (entry.ttlMs !== undefined && Number.isFinite(baseMs)
      ? new Date(baseMs + entry.ttlMs).toISOString()
      : undefined);
  return {
    key: entry.key,
    text: entry.text,
    icon: entry.icon,
    url: entry.url,
    tags: entry.tags?.length ? entry.tags : undefined,
    pushedAt: createdAt,
    expiresAt: computedExpiresAt,
  };
}
