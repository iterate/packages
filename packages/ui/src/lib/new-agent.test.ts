// What New agent reads from a kind's file: its offers, a field's value, and its line's parts.
import { expect, test } from "vitest";
import {
  newAgentFieldOff,
  newAgentLineParts,
  newAgentOffers,
  newAgentValues,
  viewerNameOf,
} from "./new-agent.ts";

/** A kind's `newAgent` as its frame reports it: two choices, a field for both and one for the first. */
const ACP = {
  choices: [
    { id: "claude", label: "claude" },
    { id: "codex", label: "codex" },
  ],
  fields: [
    { name: "runner", label: "Runner", defaultValue: "acp.sandbox" },
    {
      name: "remoteControl",
      label: "Remote control",
      type: "checkbox" as const,
      defaultValue: "on",
      choices: ["claude"],
    },
  ],
};

test("a kind's choices are the offers: each with its kind's name, its own fields, and whether it lives in a person's folder", () => {
  expect(
    newAgentOffers("acp", ACP).map(({ value, label, fields }) => ({
      value,
      label,
      fields: fields.map((field) => field.name),
    })),
  ).toEqual([
    { value: "acp/claude", label: "claude (acp)", fields: ["runner", "remoteControl"] },
    { value: "acp/codex", label: "codex (acp)", fields: ["runner"] },
  ]);
  // a choice named as its kind is said once; `byPerson` is the kind's word, and only `true` is it
  expect(
    newAgentOffers("claude", {
      choices: [
        { id: "claude", label: "claude", byPerson: true },
        { id: "plain", label: "plain" },
      ],
    }),
  ).toEqual([
    {
      value: "claude/claude",
      label: "claude",
      kind: "claude",
      choice: "claude",
      byPerson: true,
      fields: [],
    },
    {
      value: "claude/plain",
      label: "plain (claude)",
      kind: "claude",
      choice: "plain",
      byPerson: false,
      fields: [],
    },
  ]);
  // a kind whose file says nothing of new agents offers none
  expect(newAgentOffers("echo", undefined)).toEqual([]);
});

test("a field's value is what the person typed, else the field's own; a box unticked by hand stays unticked", () => {
  const [claude] = newAgentOffers("acp", ACP);
  expect(newAgentValues(claude, () => undefined)).toEqual({
    runner: "acp.sandbox",
    remoteControl: "on",
  });
  const typed: Record<string, string> = { runner: "acp.misha", remoteControl: "" };
  expect(newAgentValues(claude, (name) => typed[name])).toEqual({
    runner: "acp.misha",
    remoteControl: "",
  });
  // a page's URL answers null for what it does not hold
  expect(newAgentValues(claude, () => null)).toEqual({
    runner: "acp.sandbox",
    remoteControl: "on",
  });
  expect(newAgentValues(undefined, () => "x")).toEqual({});
});

test("a kind's line is plain text and the code between its backticks, each part with its place in the line", () => {
  expect(newAgentLineParts("Run `a b` there, then `c`.")).toEqual([
    { at: 0, text: "Run ", code: false },
    { at: 5, text: "a b", code: true },
    { at: 9, text: " there, then ", code: false },
    { at: 23, text: "c", code: true },
    { at: 25, text: ".", code: false },
  ]);
  // a line that begins with code has no empty part before it; the same code twice keeps two places
  expect(newAgentLineParts("`x` or `x`").map((part) => [part.at, part.text, part.code])).toEqual([
    [1, "x", true],
    [3, " or ", false],
    [8, "x", true],
  ]);
  expect(newAgentLineParts("no code here")).toEqual([{ at: 0, text: "no code here", code: false }]);
});

test("a person's first name is their folder name up to its first dash, when that is an identifier", () => {
  expect(
    ["misha", "misha-k-work", "jonas-templestein", "x2", "2fast", "", undefined].map(viewerNameOf),
  ).toEqual(["misha", "misha", "jonas", "x2", undefined, undefined, undefined]);
});

/** The Claude kind's fields as the design has them: a runner made for the viewer, and a Remote
 *  control box that its sandbox turns off. */
const CLAUDE = {
  choices: [{ id: "claude", label: "claude", byPerson: true }],
  fields: [
    { name: "runner", label: "Runner", defaultValue: "", viewerDefault: "{name}.laptop" },
    {
      name: "remoteControl",
      label: "Remote control",
      type: "checkbox" as const,
      defaultValue: "on",
      offWhen: { field: "runner", is: "claude.sandbox" },
    },
  ],
};

test("a field's first value can be made for the person who looks; what they typed still wins, an empty box too", () => {
  const [claude] = newAgentOffers("claude", CLAUDE);
  const runner = (typed: Record<string, string>, person?: string) =>
    newAgentValues(claude, (name) => typed[name], person).runner;
  expect({
    made: runner({}, "misha-k-work"),
    // nobody signed in with an address, or a name that is no identifier: the field's own value
    noPerson: runner({}),
    noName: runner({}, "2fast"),
    typed: runner({ runner: "misha.desk" }, "misha"),
    emptied: runner({ runner: "" }, "misha"),
  }).toEqual({ made: "misha.laptop", noPerson: "", noName: "", typed: "misha.desk", emptied: "" });
});

test("a tick box that another field turns off has no value while it is off, whatever was ticked, and its own again after", () => {
  const [claude] = newAgentOffers("claude", CLAUDE);
  const box = claude!.fields[1]!;
  const values = (typed: Record<string, string>) =>
    newAgentValues(claude, (name) => typed[name], "misha");
  // on a computer the box is as the kind starts it, or as ticked
  expect(values({})).toEqual({ runner: "misha.laptop", remoteControl: "on" });
  expect(newAgentFieldOff(box, values({}))).toBe(false);
  // on the sandbox it is off, even if the person had ticked it by hand
  const sandbox = values({ runner: "claude.sandbox", remoteControl: "on" });
  expect(sandbox).toEqual({ runner: "claude.sandbox", remoteControl: "" });
  expect(newAgentFieldOff(box, sandbox)).toBe(true);
  // back on a computer, what the person ticked or unticked is there again
  expect(values({ runner: "misha.desk", remoteControl: "" })).toEqual({
    runner: "misha.desk",
    remoteControl: "",
  });
  expect(values({ runner: "misha.desk" })).toEqual({ runner: "misha.desk", remoteControl: "on" });
  // a field with no such key is never off
  expect(newAgentFieldOff(claude!.fields[0]!, sandbox)).toBe(false);
});
