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

/** The colours a face may have, as 0xRRGGBB: twelve hues that are far apart, one colour for each
 *  (orange, red, amber, lime, green, teal, cyan, blue, violet, fuchsia, pink, slate), each dark
 *  enough for white initials at 4.9:1 or more by WCAG 2. One lightness for each hue on purpose: a
 *  dark and a light colour of one hue read as the same person's. They are the same in both themes.
 *  Numbers, not CSS: `inkOf` reads their channels. */
const FACE_COLOURS = [
  0xc2410c, 0xb91c1c, 0xa16207, 0x4d7c0f, 0x15803d, 0x0f766e, 0x0e7490, 0x1d4ed8, 0x6d28d9,
  0xa21caf, 0xbe185d, 0x475569,
];

/** A person's colour, the same on every page and every load: one of `FACE_COLOURS`, chosen by a
 *  hash of `who`, as CSS (`#rrggbb`). `inkOf` gives the initials' colour on it. */
export function colourOf(who: string) {
  return `#${faceColourOf(who).toString(16).padStart(6, "0")}`;
}

/** The initials' colour on `colourOf(who)`: white or black, whichever has the higher contrast
 *  with it by WCAG 2's relative luminance. Every one of `FACE_COLOURS` has at least 4.9:1. */
export function inkOf(who: string): "white" | "black" {
  const colour = faceColourOf(who);
  const [red, green, blue] = [16, 8, 0].map((shift) => {
    const channel = ((colour >> shift) & 0xff) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  // contrast is (lighter + 0.05) / (darker + 0.05); white's luminance is 1, black's 0
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "white" : "black";
}

/** `who`'s colour of `FACE_COLOURS`: the 32-bit FNV-1a hash of its UTF-16 code units, mixed by
 *  murmur3's finaliser, because FNV-1a alone moves few of its bits for a change in the last
 *  character, and similar names would share a colour. */
function faceColourOf(who: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < who.length; index++)
    hash = Math.imul(hash ^ who.charCodeAt(index), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return FACE_COLOURS[((hash ^ (hash >>> 16)) >>> 0) % FACE_COLOURS.length]!;
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
