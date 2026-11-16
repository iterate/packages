// The mind's catalog of its contexts as a page reads it: what `itx.contexts.list()` answers, parsed,
// and the plain functions every view of it shares: the filter and the words of a row. No React
// here.
import { z } from "zod";

/** One context as the catalog lists it (iterate/api `ContextListing`). */
export const ContextListing = z.object({
  path: z.string(),
  awake: z.object({ since: z.number() }).optional(),
  createdAt: z.string().optional(),
  lastEventAt: z.string().optional(),
  lastActivityAt: z.string().optional(),
  eventCount: z.number(),
  eventTypes: z.record(z.string(), z.number()),
  recentTypes: z.array(z.string()),
  processors: z.array(z.string()),
  storageBytes: z.number().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ContextListing = z.infer<typeof ContextListing>;

/** The rows of an answer; a row that is no listing is left out. */
export function contextListingsOf(answer: unknown): ContextListing[] {
  const rows = z.array(z.unknown()).safeParse(answer).data || [];
  return rows.flatMap((row) => {
    const listing = ContextListing.safeParse(row);
    return listing.success ? [listing.data] : [];
  });
}

/** When the context was last active: its newest activity, or its newest event when it has had
 *  none of its own. */
export function activeAtOf(row: ContextListing): string | undefined {
  return row.lastActivityAt || row.lastEventAt;
}

/** The rows in which every word of `query` occurs: in the path, the description, an event type,
 *  a processor's name or the metadata. The order stays. */
export function filterContextListings(
  rows: readonly ContextListing[],
  query: string,
): ContextListing[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => {
    const haystack = [
      row.path,
      row.description || "",
      ...Object.keys(row.eventTypes),
      ...row.processors,
      row.metadata ? JSON.stringify(row.metadata) : "",
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** An event type without the platform's prefix: `agent/turn-started`. */
export function shortEventType(type: string): string {
  const prefix = "events.iterate.com/";
  return type.startsWith(prefix) ? type.slice(prefix.length) : type;
}

/** How long ago `at` was, in one short word: `now`, `40 s`, `3 min`, `5 h`, `12 d`. */
export function timeAgo(at: string | number | undefined, nowMs: number): string {
  if (at === undefined) return "";
  const seconds = Math.round((nowMs - (typeof at === "number" ? at : Date.parse(at))) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 5) return "now";
  if (seconds < 60) return `${String(seconds)} s`;
  if (seconds < 3_600) return `${String(Math.floor(seconds / 60))} min`;
  if (seconds < 86_400) return `${String(Math.floor(seconds / 3_600))} h`;
  return `${String(Math.floor(seconds / 86_400))} d`;
}

/** A size in bytes, in the largest unit that keeps it above 1: `812 B`, `4.2 kB`, `1.3 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${String(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/** The longest title a row shows. */
const TITLE_LIMIT = 80;

/** A context's short stable title: `metadata.title` of its newest `itx/described`, trimmed and cut
 *  to 80 characters; undefined when it has none. Its description says what it is for. */
export function contextTitle(row: ContextListing): string | undefined {
  const title = row.metadata?.title;
  if (typeof title !== "string") return undefined;
  return title.trim().slice(0, TITLE_LIMIT).trim() || undefined;
}

/** The catalog keeps a context's metadata only while it prints this short
 *  (core/itx/src/context/context-summary.ts): a longer record is dropped whole, its title too. */
const METADATA_MAX_CHARS = 4_000;

/** The payload of the `events.iterate.com/itx/described` that writes `description` and, when it
 *  is given, `title`. Without a title it names no metadata, so the metadata stays. `metadata` is
 *  one record and the newest stands, so a title goes in with the rest of the row's metadata, and
 *  an empty title takes the `title` key out. It throws for a context with no row, whose metadata
 *  is not known here, and for a record the catalog would drop. */
export function describedPayload(
  row: ContextListing | undefined,
  description: string,
  title?: string,
): { description: string | null; metadata?: Record<string, unknown> | null } {
  // oxlint-disable-next-line iterate/simple-truthiness-check -- an empty title removes it; absent keeps the metadata
  if (title === undefined) return { description: description || null };
  if (!row)
    throw new Error("The catalog does not list this context yet, so its title cannot be set here.");
  const { title: _title, ...rest } = row.metadata || {};
  const metadata = title.trim() ? { ...rest, title: title.trim() } : rest;
  if (JSON.stringify(metadata).length > METADATA_MAX_CHARS)
    throw new Error("This context's metadata is too long for the catalog to keep with a title.");
  // a record with nothing left is cleared (null), not kept as an empty one
  return {
    description: description || null,
    metadata: Object.keys(metadata).length ? metadata : null,
  };
}

/** A row's last line: its description, or else its last few event types, the newest first. */
export function contextRowDetail(row: ContextListing): string {
  return row.description || row.recentTypes.map(shortEventType).toReversed().join(" · ");
}

/** The newest event types first, each run of one type as one entry with its count: the last
 *  events of a context in a few words. `at` is where the run's newest event is in
 *  `recentTypes`, which names the run among the others. */
export function eventRunsOf(
  recentTypes: readonly string[],
): { type: string; count: number; at: number }[] {
  const runs: { type: string; count: number; at: number }[] = [];
  for (let at = recentTypes.length - 1; at >= 0; at--) {
    const type = recentTypes[at]!;
    const last = runs.at(-1);
    if (last?.type === type) last.count += 1;
    else runs.push({ type, count: 1, at });
  }
  return runs;
}
