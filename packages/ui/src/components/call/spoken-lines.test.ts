// The plain helpers of a call's spoken lines: the rollup of runs of said rows in a feed, and how a
// speaker's name, initials and colour come from their address.
import { expect, test } from "vitest";
import { colourOf, initialsOf, inkOf, nameOf, rollUpSpokenLines } from "./spoken-lines.ts";

// ── rollUpSpokenLines ──

test("rollup: rows with no said row come back as they are, the same array", () => {
  const rows = [typed(1), typed(2)];
  expect(rollUpSpokenLines(rows)).toBe(rows);
});

test("rollup: one run is one row, named as the head and with the first line's offset", () => {
  const lines = [said(1), said(2), said(3)];
  expect(rollUpSpokenLines(lines)).toEqual([
    { key: "said:head", offset: 1, kind: "rollup", lines },
  ]);
});

test("rollup: a typed row ends a run, so two runs sit around it", () => {
  const rows = [said(1), said(2), typed(3), said(4)];
  expect(rollUpSpokenLines(rows)).toMatchObject([
    { key: "said:head", kind: "rollup", lines: [{ key: "1" }, { key: "2" }] },
    { key: "3", kind: "typed" },
    { key: "said:after:3", kind: "rollup", lines: [{ key: "4" }] },
  ]);
});

test("rollup: a run at the end is named by the row before it", () => {
  const rows = [typed(1), typed(2), said(3), said(4)];
  expect(rollUpSpokenLines(rows).map((row) => row.key)).toEqual(["1", "2", "said:after:2"]);
});

test("rollup: the row's key stays as lines are said at its end", () => {
  const before = rollUpSpokenLines([typed(1), said(2)]);
  const after = rollUpSpokenLines([typed(1), said(2), said(3), said(4)]);
  expect(before.at(-1)).toMatchObject({ key: "said:after:1" });
  expect(after.at(-1)).toMatchObject({ key: "said:after:1", offset: 2 });
});

test("rollup: the row's key stays as older lines load in front of it", () => {
  // the loaded rows begin inside a run; an older page then puts two more of its lines in front
  const before = rollUpSpokenLines([said(4), said(5), typed(6)]);
  const after = rollUpSpokenLines([said(2), said(3), said(4), said(5), typed(6)]);
  expect(before[0]).toMatchObject({ key: "said:head", offset: 4 });
  expect(after[0]).toMatchObject({ key: "said:head", offset: 2 });
  // and a run behind another row keeps its name whatever loads in front of that row
  const later = rollUpSpokenLines([typed(1), said(2), said(3), said(4), said(5), typed(6)]);
  expect(later[1]).toMatchObject({ key: "said:after:1", offset: 2 });
});

test("rollup: every other row is the same object", () => {
  const rows = [typed(1), said(2), typed(3)];
  const rolled = rollUpSpokenLines(rows);
  expect(rolled[0]).toBe(rows[0]);
  expect(rolled[2]).toBe(rows[2]);
});

// ── who said it ──

test("a name is the address before the @, and its initials up to two letters", () => {
  expect(nameOf("ana.lopez@example.com")).toBe("ana.lopez");
  expect(nameOf("iterate")).toBe("iterate");
  expect(initialsOf("ana.lopez@example.com")).toBe("AL");
  expect(initialsOf("ben@example.com")).toBe("B");
  expect(initialsOf("a-b-c@example.com")).toBe("AB");
  expect(initialsOf("__@example.com")).toBe("?");
});

test("a person has the same colour every time, as CSS of one of 12 colours", () => {
  expect(colourOf("ana@example.com")).toBe(colourOf("ana@example.com"));
  expect(colourOf("ana@example.com")).toMatch(/^#[0-9a-f]{6}$/);
  expect(new Set(SAMPLES.map(colourOf))).toMatchObject({ size: 12 });
});

test("a face's initials have at least 4.5:1 contrast with every one of the colours", () => {
  const byColour = new Map(SAMPLES.map((who) => [colourOf(who), who]));
  const contrasts = [...byColour].map(([colour, who]) => contrastOf(colour, inkOf(who)));
  expect(contrasts).toHaveLength(12);
  expect(Math.min(...contrasts)).toBeGreaterThanOrEqual(4.5);
});

test("200 addresses and names spread over the colours, none with more than twice its share", () => {
  const perColour = new Map<string, number>();
  for (const who of SAMPLES) perColour.set(colourOf(who), (perColour.get(colourOf(who)) || 0) + 1);
  expect(SAMPLES).toHaveLength(200);
  // a fair share is 200 / 12, about 17
  expect(Math.max(...perColour.values())).toBeLessThanOrEqual(33);
});

test("two strings that differ in one character usually have two colours", () => {
  const pairs = SAMPLES.map((who) => [who, `${who.slice(0, -1)}${who.at(-1) === "x" ? "y" : "x"}`]);
  const differ = pairs.filter(([one, other]) => colourOf(one!) !== colourOf(other!));
  // by chance alone 11 in 12 differ, about 183 of 200
  expect(differ.length).toBeGreaterThanOrEqual(165);
});

/** A spoken line as a page's feed row. */
function said(offset: number) {
  return {
    key: String(offset),
    offset,
    kind: "said" as const,
    who: "ana@example.com",
    at: offset * 1000,
    text: `line ${String(offset)}`,
  };
}

/** A typed message as a page's feed row. */
function typed(offset: number) {
  return { key: String(offset), offset, kind: "typed" as const, text: "hi" };
}

/** The WCAG 2 contrast of `ink` ("white" or "black") on `colour` (`#rrggbb`). */
function contrastOf(colour: string, ink: "white" | "black") {
  const [red, green, blue] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(colour.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  const inkLuminance = ink === "white" ? 1 : 0;
  return (Math.max(luminance, inkLuminance) + 0.05) / (Math.min(luminance, inkLuminance) + 0.05);
}

/** 200 people as a page names them: 100 addresses, 60 guests' names and 40 actor ids. */
const SAMPLES = [
  ...["ana", "ben", "cy", "dee", "eli", "fay", "gus", "hal", "ivy", "jo"].flatMap((first) =>
    ["", ".lopez", ".kim", "1", "_ops"].flatMap((rest) =>
      ["example.com", "example.org"].map((domain) => `${first}${rest}@${domain}`),
    ),
  ),
  ...["Bob", "Alice", "Carol", "Dan", "Erin", "Frank"].flatMap((first) =>
    ["Proof", "Smith", "Ng", "Okafor", "Silva", "Novak", "Berg", "Rossi", "Haas", "Lund"].map(
      (last) => `${first} ${last}`,
    ),
  ),
  ...Array.from({ length: 40 }, (_, n) => `user_${String(3700 + n * 37)}`),
];
