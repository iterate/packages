// spoken-lines.ts — WHAT A CALL SAYS, as data: a line someone said once it is transcribed, a caption
// still being spoken, who said it (an address, or the agent's name), and the run of lines that a
// feed shows as one quiet row (`rollUpSpokenLines`). Plain functions, no React: the call's
// components (caption-strip.tsx, transcript-history.tsx, transcript-rollup.tsx) draw these.

/** One line said and transcribed. `who` is the speaker's address, or the agent's name; `at` is
 *  when they began to say it, in milliseconds since the epoch; `offset` is the line's place in
 *  its log, when the page knows it (the transcript then counts the lines below a reader). */
export type SpokenLine = { key: string; who: string; at: number; text: string; offset?: number };

/** Words still being spoken, before they are a line. `from` is the speaker's connection: one
 *  caption per connection. */
export type LiveCaption = { from: string; who: string; text: string };

/** A row of a feed that the page builds from its log, in log order. */
type FeedRow = { key: string; offset?: number; kind: string };

/** A row of `kind: "said"`: a spoken line in a page's feed. */
type SaidRow = SpokenLine & { kind: "said" };

/** One run of consecutive spoken lines, as `rollUpSpokenLines` makes it. */
export type SpokenRollupRow = { key: string; offset?: number; kind: "rollup"; lines: SpokenLine[] };

/** What a person is called: the part of their address before the "@". */
export const nameOf = (who: string) => who.split("@", 1)[0] ?? who;

/** Up to two letters for a face: "jonas.t@…" is "JT". "?" when the name has no letter or digit. */
export const initialsOf = (who: string) =>
  nameOf(who)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";

/** A person's colour, the same on every page and every load: a hue from a hash of `who`, at one
 *  lightness that white initials read on. */
export function colourOf(who: string) {
  let hash = 0;
  for (const char of who) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 55% 45%)`;
}

/** `rows` with every run of consecutive `kind: "said"` rows as ONE row of `kind: "rollup"`, for a
 *  page that builds its own feed. A row of any other kind ends a run. The rollup's key is
 *  `"said:" + <the first line's key>` and its offset the first line's, so the row keeps its
 *  identity as the run grows. Every other row is the same object; with no said row, the answer is
 *  `rows` itself. Pure. */
export function rollUpSpokenLines<Row extends FeedRow>(
  rows: readonly (Row | SaidRow)[],
): readonly (Exclude<Row, { kind: "said" }> | SpokenRollupRow)[] {
  // The cast: no row is said, so every row is of another kind. TypeScript does not narrow an
  // array's element type from `some`, and the same array must be the answer (no copy).
  if (!rows.some(isSaid)) return rows as readonly Exclude<Row, { kind: "said" }>[];
  const out: (Exclude<Row, { kind: "said" }> | SpokenRollupRow)[] = [];
  let run: SpokenRollupRow | undefined;
  for (const row of rows) {
    if (!isSaid(row)) {
      run = undefined;
      // The cast: `isSaid` said no, but its guard narrows a generic `Row` to `Row`, not to
      // `Exclude<Row, …>`, which only resolves once `Row` is known.
      out.push(row as Exclude<Row, { kind: "said" }>);
    } else if (run) run.lines.push(row);
    else {
      run = { key: `said:${row.key}`, kind: "rollup", lines: [row] };
      if (row.offset !== undefined) run.offset = row.offset;
      out.push(run);
    }
  }
  return out;
}

function isSaid(row: FeedRow): row is SaidRow {
  return row.kind === "said";
}
