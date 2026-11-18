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
 *  saturation and lightness. `inkOf` gives the initials' colour on it. */
export function colourOf(who: string) {
  return `hsl(${hueOf(who)} 55% 45%)`;
}

/** The initials' colour on `colourOf(who)`: white or black, whichever has the higher contrast
 *  with it by WCAG 2's relative luminance. On every hue that is at least 4.5:1, the least at hue
 *  21; a near-black such as #0a0a0a falls under 4.5:1 near hue 205. */
export function inkOf(who: string): "white" | "black" {
  // hsl(h 55% 45%) as sRGB, by the CSS Color 4 conversion
  const hue = hueOf(who);
  const chroma = 0.55 * Math.min(0.45, 1 - 0.45);
  const [red, green, blue] = [0, 8, 4].map((n) => {
    const k = (n + hue / 30) % 12;
    const channel = 0.45 - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  // contrast is (lighter + 0.05) / (darker + 0.05); white's luminance is 1, black's 0
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "white" : "black";
}

/** The hue of `who`'s colour: a hash of the string, 0 to 359. */
function hueOf(who: string) {
  let hash = 0;
  for (const char of who) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

/** `rows` with every run of consecutive `kind: "said"` rows as ONE row of `kind: "rollup"`, for a
 *  page that builds its own feed. A row of any other kind ends a run. The rollup's key names the
 *  row BEFORE the run, `"said:after:" + <that row's key>`, or `"said:head"` for a run that starts
 *  the loaded rows: so the row keeps its identity (and a page its open state) as lines are said at
 *  its end and as older lines load in front of it. Its offset is its first line's. Every other row
 *  is the same object; with no said row, the answer is `rows` itself. Pure. */
export function rollUpSpokenLines<Row extends FeedRow>(
  rows: readonly (Row | SaidRow)[],
): readonly (Exclude<Row, { kind: "said" }> | SpokenRollupRow)[] {
  // The cast: no row is said, so every row is of another kind. TypeScript does not narrow an
  // array's element type from `some`, and the same array must be the answer (no copy).
  if (!rows.some(isSaid)) return rows as readonly Exclude<Row, { kind: "said" }>[];
  const out: (Exclude<Row, { kind: "said" }> | SpokenRollupRow)[] = [];
  let run: SpokenRollupRow | undefined;
  // the key of the last row that is not said: what a run after it is named by
  let before: string | undefined;
  for (const row of rows) {
    if (!isSaid(row)) {
      run = undefined;
      before = row.key;
      // The cast: `isSaid` said no, but its guard narrows a generic `Row` to `Row`, not to
      // `Exclude<Row, …>`, which only resolves once `Row` is known.
      out.push(row as Exclude<Row, { kind: "said" }>);
    } else if (run) run.lines.push(row);
    else {
      run = {
        key: before ? `said:after:${before}` : "said:head",
        kind: "rollup",
        lines: [row],
      };
      if (row.offset !== undefined) run.offset = row.offset;
      out.push(run);
    }
  }
  return out;
}

function isSaid(row: FeedRow): row is SaidRow {
  return row.kind === "said";
}
