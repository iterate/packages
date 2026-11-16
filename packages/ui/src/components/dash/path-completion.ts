// path-completion.ts — ⌘K'S PATH MODE, as plain functions: what the palette lists while its query
// starts with "/". It completes context paths as a shell completes file names: the query is a path
// whose last segment is still being typed, and the list is the paths one level deeper than its
// last "/", each whole, with how many contexts are below it. Each typed segment matches its
// segment of a path by its start, or else by its letters in order (`/ag/pe` finds
// `/agents/people`). Tab takes the highlighted path, and a "/" after it when it has more below.
import {
  activeAtOf,
  type ContextListing,
} from "#/components/context-catalog/context-catalog-rows.ts";

/** The palette lists at most this many paths. A line under them says how many more match. */
const PATH_CAP = 50;

/** One path of the list: a context, or a folder that only holds contexts. */
export type PathEntry = {
  path: string;
  /** Whether a context has this path. A folder has none, but opens like any path. */
  context: boolean;
  /** How many contexts are below it. */
  below: number;
  /** The newest activity of it and of what is below it. */
  activeAt: string | undefined;
};

/** Whether `query` asks for the path mode: its first character is "/". */
export function isPathQuery(query: string): boolean {
  return query.startsWith("/");
}

/** The folder that a typed path completes in: all of it before its last "/". The mind is asked
 *  for the contexts under it (`itx.contexts.list({ under })`). */
export function typedFolderOf(typed: string): string {
  const at = typed.lastIndexOf("/");
  return at <= 0 ? "/" : typed.slice(0, at);
}

/** The paths that complete `typed`, from `rows` (the page's catalog and the mind's answer
 *  together): the best matches first, then the most recently active, then by name. */
export function pathCompletions(
  rows: readonly ContextListing[],
  typed: string,
): { entries: PathEntry[]; total: number } {
  const wanted = segmentsOf(typed.toLowerCase());
  const entries = new Map<string, PathEntry & { exact: boolean }>();
  for (const row of rows) {
    const segments = segmentsOf(row.path);
    if (segments.length < wanted.length) continue;
    const head = segments.slice(0, wanted.length);
    if (!head.every((segment, at) => matches(wanted[at]!, segment))) continue;
    const path = `/${head.join("/")}`;
    const entry = entries.get(path) || {
      path,
      context: false,
      below: 0,
      activeAt: undefined,
      exact: head.every((segment, at) => segment.toLowerCase().startsWith(wanted[at]!)),
    };
    if (row.path === path) entry.context = true;
    else entry.below += 1;
    const at = activeAtOf(row);
    if (at && (!entry.activeAt || at > entry.activeAt)) entry.activeAt = at;
    entries.set(path, entry);
  }
  const sorted = [...entries.values()]
    .toSorted(
      (left, right) =>
        Number(right.exact) - Number(left.exact) ||
        (right.activeAt || "").localeCompare(left.activeAt || "") ||
        left.path.localeCompare(right.path),
    )
    .map(({ exact: _, ...entry }) => entry);
  return { entries: sorted.slice(0, PATH_CAP), total: sorted.length };
}

/** What Tab makes of the query: the entry's path, and a "/" after it when contexts are below it,
 *  so the next Tab goes one level deeper. */
export function completedPath(entry: PathEntry): string {
  return entry.below > 0 ? `${entry.path}/` : entry.path;
}

/** The path a typed query names as it is, for the row that opens it when nothing matches: no "/"
 *  at its end, and none for a query that is no path. */
export function typedPathOf(typed: string): string | undefined {
  if (!/^\/\S*$/.test(typed) || typed.includes("//")) return undefined;
  return typed.length > 1 ? typed.replace(/\/+$/, "") : typed;
}

/** The segments of a path. Of a typed path, the last is the one being typed, and is "" right
 *  after a "/". */
function segmentsOf(path: string): string[] {
  return path.slice(1).split("/");
}

/** Whether a typed segment matches a segment of a path: by its start, or its letters in order. */
function matches(typed: string, segment: string): boolean {
  const lower = segment.toLowerCase();
  if (lower.startsWith(typed)) return true;
  let at = 0;
  for (const letter of lower) if (letter === typed[at]) at += 1;
  return at === typed.length;
}
