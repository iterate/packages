// What ⌘K lists for a mind's contexts (`ContextPalette`), as plain functions: which rows, in which
// sections and order, the folder chips over a search, what a row says after its path, and the row
// that opens a typed path. No React here. A row shows its path whole (`ContextPathText`).
//
// With no query the palette lists the contexts that work now or were active in the last five
// minutes. A query searches every row: the recent matches first, then all other matches.
import {
  activeAtOf,
  filterContextListings,
  shortEventType,
  type ContextListing,
} from "./context-catalog-rows.ts";

/** "Recently active" is this many milliseconds. */
export const RECENT_MS = 5 * 60_000;
/** A section shows at most this many rows. A line under it says how many more match. */
export const SECTION_CAP = 50;
/** With nothing recent, the palette shows this many of the most recent rows instead. */
export const QUIET_COUNT = 8;
/** At most this many folder chips: the folders with the most matches. */
const CHIP_CAP = 8;

export type PaletteSection = {
  heading: string;
  /** The first `SECTION_CAP` rows. */
  rows: ContextListing[];
  /** How many rows the section has, shown or not. */
  total: number;
  /** How many of them work now (`awake`). */
  working: number;
};

export type FolderChip = { folder: string; count: number; active: boolean };

export type PaletteView = {
  sections: PaletteSection[];
  /** True when the query is empty and nothing was active in the last five minutes. */
  quiet: boolean;
  /** The top folders of the matches, while a query is typed. Empty when they would not narrow. */
  folders: FolderChip[];
  /** A path that the query names and no context has: the palette offers to open it. */
  openPath: string | undefined;
};

/** The palette's sections for `query`. `rows` is the page's catalog. `found` is the mind's own
 *  answer to a search (`itx.contexts.list({ search })`): for the query it was asked with, its
 *  rows match as they are; for an older query they are candidates that this query filters. */
export function contextPaletteView({
  rows,
  found,
  query,
  nowMs,
}: {
  rows: readonly ContextListing[];
  found: { query: string; rows: readonly ContextListing[] } | undefined;
  query: string;
  nowMs: number;
}): PaletteView {
  const isRecent = (row: ContextListing) =>
    Boolean(row.awake) || nowMs - (Date.parse(activeAtOf(row) || "") || 0) < RECENT_MS;
  const { folder, rest } = splitFolder(query);
  if (!folder && !rest.trim()) {
    const sorted = rows.toSorted(byWorkingThenRecent);
    const recent = sorted.filter(isRecent);
    if (recent.length)
      return { ...nothingTyped, sections: [section("Active in the last 5 minutes", recent)] };
    // a mind with no contexts at all has no "Most recent" either
    const latest = sorted.slice(0, QUIET_COUNT);
    return {
      ...nothingTyped,
      quiet: true,
      sections: latest.length ? [section("Most recent", latest)] : [],
    };
  }
  const candidates = mergedByPath(rows, found?.rows || []);
  const answered = new Set(
    found && found.query === query.trim() ? found.rows.map((row) => row.path) : [],
  );
  // every match but for the folder: what the chips count
  const local = new Set(matchingQuery(candidates, rest).map((row) => row.path));
  const unfoldered = candidates.filter((row) => local.has(row.path) || answered.has(row.path));
  const matches = (
    folder ? unfoldered.filter((row) => topFolderOf(row.path) === folder) : unfoldered
  ).toSorted(byWorkingThenRecent);
  const recent = matches.filter(isRecent);
  const other = matches.filter((row) => !isRecent(row));
  const sections = [
    section("Active in the last 5 minutes", recent),
    section(recent.length ? "All other contexts" : "All contexts", other),
  ].filter((part) => part.total > 0);
  return {
    sections,
    quiet: false,
    folders: folderChipsOf(unfoldered, folder),
    openPath: typedPathOf(query, candidates),
  };
}

const nothingTyped = { quiet: false, folders: [], openPath: undefined };

function section(heading: string, rows: ContextListing[]): PaletteSection {
  return {
    heading,
    rows: rows.slice(0, SECTION_CAP),
    total: rows.length,
    working: rows.filter((row) => row.awake).length,
  };
}

/** Working rows first, then the most recently active; the path decides a tie. */
function byWorkingThenRecent(left: ContextListing, right: ContextListing): number {
  if (Boolean(left.awake) !== Boolean(right.awake)) return left.awake ? -1 : 1;
  const leftAt = Date.parse(activeAtOf(left) || "") || 0;
  const rightAt = Date.parse(activeAtOf(right) || "") || 0;
  return rightAt - leftAt || left.path.localeCompare(right.path);
}

/** One row per path. A row of `later` replaces the same path's row of `earlier`: it is newer. */
function mergedByPath(
  earlier: readonly ContextListing[],
  later: readonly ContextListing[],
): ContextListing[] {
  const byPath = new Map(earlier.map((row) => [row.path, row]));
  for (const row of later) byPath.set(row.path, row);
  return [...byPath.values()];
}

/** The rows that match every word of `query`. A word that starts with "/" matches the start of
 *  a path (`/agents/sl`); any other word matches as `filterContextListings` does. */
function matchingQuery(rows: readonly ContextListing[], query: string): ContextListing[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const anchored = words.filter((word) => word.startsWith("/"));
  const free = words.filter((word) => !word.startsWith("/")).join(" ");
  const underPaths = rows.filter((row) =>
    anchored.every((word) => row.path.toLowerCase().startsWith(word)),
  );
  return filterContextListings(underPaths, free);
}

/** The words of a query that are not a path: the ones the palette marks in a row's text. */
export function freeWordsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word && !word.startsWith("/"));
}

// ── folder chips ──

/** A query's folder word, `/agents/`, which a chip puts in and takes out, and the rest. */
function splitFolder(query: string): { folder: string | undefined; rest: string } {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const index = words.findIndex((word) => /^\/[^/]+\/$/.test(word));
  if (index === -1) return { folder: undefined, rest: query };
  return {
    folder: words[index]!.slice(1, -1),
    rest: words.filter((_, at) => at !== index).join(" "),
  };
}

/** The top folder of a path: `agents` for `/agents/claude/x` and for `/agents`. The root has none. */
function topFolderOf(path: string): string | undefined {
  return path.split("/")[1] || undefined;
}

/** The chips over `matches`: each top folder and its count, the largest first. Shown while they
 *  narrow (two folders or more) or while one is chosen, so that it can be taken out again. */
function folderChipsOf(
  matches: readonly ContextListing[],
  chosen: string | undefined,
): FolderChip[] {
  const counts = new Map<string, number>();
  for (const row of matches) {
    const folder = topFolderOf(row.path);
    if (folder) counts.set(folder, (counts.get(folder) || 0) + 1);
  }
  if (counts.size < 2 && !chosen) return [];
  return [...counts]
    .toSorted(
      ([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName),
    )
    .slice(0, CHIP_CAP)
    .map(([folder, count]) => ({ folder, count, active: folder === chosen }));
}

/** `query` narrowed to `folder` (its folder word first), or with its folder word taken out. A
 *  space ends a narrowed query, so the next word typed is a word of its own. */
export function queryWithFolder(query: string, folder: string | undefined): string {
  const rest = splitFolder(query).rest.trim();
  if (!folder) return rest;
  return rest ? `/${folder}/ ${rest} ` : `/${folder}/ `;
}

// ── a typed path ──

/** The path that `query` is, when it is one path that no row has: `/agents/new-thing`. A
 *  trailing "/" goes. A query of words, or a folder chip's word alone, is no path. */
function typedPathOf(query: string, rows: readonly ContextListing[]): string | undefined {
  const typed = query.trim();
  if (!/^\/\S*$/.test(typed) || typed.includes("//") || /^\/[^/]+\/$/.test(typed)) return undefined;
  const path = typed.length > 1 ? typed.replace(/\/+$/, "") : typed;
  return rows.some((row) => row.path === path) ? undefined : path;
}

// ── how a row reads ──

/** What a row says after its path: what matched, when a word matched only a part the row does
 *  not show (`runs ai-linter`, `had github/webhook-received`), or else what it last did in plain
 *  words (`hook received`). */
export function rowNoteOf(row: ContextListing, words: readonly string[]): string {
  const shown = `${row.description || ""} ${row.path}`.toLowerCase();
  const hidden = words.find((word) => !shown.includes(word));
  if (hidden) {
    const processor = row.processors.find((name) => name.toLowerCase().includes(hidden));
    if (processor) return `runs ${processor}`;
    const type = Object.keys(row.eventTypes).find((name) => name.toLowerCase().includes(hidden));
    if (type) return `had ${shortEventType(type)}`;
    return "metadata matches";
  }
  const last = row.recentTypes.at(-1);
  if (!last) return row.eventCount ? `${String(row.eventCount)} events` : "no events yet";
  const parts = shortEventType(last).split("/");
  const name = parts.at(-1)!.replaceAll("-", " ");
  return name.includes(" ") || parts.length < 2
    ? name
    : `${parts.at(-2)!.replaceAll("-", " ")} ${name}`;
}

/** Where the words occur in `text`, any case, as [start, end) pairs in order, none overlapping. */
export function markedRanges(text: string, words: readonly string[]): [number, number][] {
  const lower = text.toLowerCase();
  const hits: [number, number][] = [];
  for (const word of words)
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length))
      hits.push([at, at + word.length]);
  hits.sort((left, right) => left[0] - right[0]);
  const ranges: [number, number][] = [];
  for (const [start, end] of hits) {
    const previous = ranges.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  }
  return ranges;
}
