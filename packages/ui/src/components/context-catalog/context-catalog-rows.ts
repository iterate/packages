// The mind's catalog of its contexts as a page reads it: what `itx.contexts.list()` answers, parsed,
// and the plain functions every view of it shares: the filter, the words of a row and the rows a
// command palette lists. No React here.
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

/** What a row says under its path: its description, or else its last few event types. */
export function contextRowDetail(row: ContextListing): string {
  return row.description || row.recentTypes.map(shortEventType).toReversed().join(" · ");
}

/** The rows a command palette lists for the catalog, the most recently active first, under the
 *  heading "Contexts" (`AppShell`'s `paletteEntries`). A row's detail is what the palette also
 *  searches: when it was active, and its description or last event types. */
export function contextPaletteEntries(
  rows: readonly ContextListing[],
  options: { current?: string; nowMs: number; onOpen: (path: string) => void; limit?: number },
) {
  return rows.slice(0, options.limit ?? 100).map((row) => ({
    label: row.path,
    group: "Contexts",
    detail:
      [row.awake ? "awake" : timeAgo(activeAtOf(row), options.nowMs), contextRowDetail(row)]
        .filter(Boolean)
        .join(" · ") || undefined,
    active: row.path === options.current,
    onSelect: () => options.onOpen(row.path),
  }));
}
