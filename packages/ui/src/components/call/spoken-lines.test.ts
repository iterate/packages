// The plain helpers of a call's spoken lines: the rollup of runs of said rows in a feed, and how a
// speaker's name, initials and colour come from their address.
import { expect, test } from "vitest";
import { colourOf, initialsOf, nameOf, rollUpSpokenLines } from "./spoken-lines.ts";

// ── rollUpSpokenLines ──

test("rollup: rows with no said row come back as they are, the same array", () => {
  const rows = [typed(1), typed(2)];
  expect(rollUpSpokenLines(rows)).toBe(rows);
});

test("rollup: one run is one row, with the first line's key and offset", () => {
  const lines = [said(1), said(2), said(3)];
  expect(rollUpSpokenLines(lines)).toEqual([{ key: "said:1", offset: 1, kind: "rollup", lines }]);
});

test("rollup: a typed row ends a run, so two runs sit around it", () => {
  const rows = [said(1), said(2), typed(3), said(4)];
  expect(rollUpSpokenLines(rows)).toMatchObject([
    { key: "said:1", kind: "rollup", lines: [{ key: "1" }, { key: "2" }] },
    { key: "3", kind: "typed" },
    { key: "said:4", kind: "rollup", lines: [{ key: "4" }] },
  ]);
});

test("rollup: a run at the end follows the rows before it", () => {
  const rows = [typed(1), typed(2), said(3), said(4)];
  expect(rollUpSpokenLines(rows).map((row) => row.key)).toEqual(["1", "2", "said:3"]);
});

test("rollup: the row's key stays as its run grows", () => {
  const before = rollUpSpokenLines([typed(1), said(2)]);
  const after = rollUpSpokenLines([typed(1), said(2), said(3), said(4)]);
  expect(before.at(-1)).toMatchObject({ key: "said:2" });
  expect(after.at(-1)).toMatchObject({ key: "said:2", offset: 2 });
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

test("a person has the same colour every time, and another person another", () => {
  expect(colourOf("ana@example.com")).toBe(colourOf("ana@example.com"));
  expect(colourOf("ana@example.com")).toMatch(/^hsl\(\d+ 55% 45%\)$/);
  expect(colourOf("ana@example.com")).not.toBe(colourOf("ben@example.com"));
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
