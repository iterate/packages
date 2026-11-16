// @vitest-environment jsdom
// A running answer shows a choice in the agent's words (`[[kind:value|label]]`) as its plain words
// and hides one not finished yet, also when the choice is split across two blocks; code keeps it as
// written.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { appendText } from "./chunked-text.ts";
import { StreamingCodeBlock, StreamingText } from "./streaming-text.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test.for([
  {
    name: "a finished choice",
    text: "Pick [[domain:afoop.com|afoop]] now.",
    shown: "Pick afoop now.",
  },
  { name: "an unfinished choice", text: "Pick [[domain:afoop.c", shown: "Pick " },
  { name: "a choice missing its last bracket", text: "Pick [[say:Yes]", shown: "Pick " },
])("a running answer with $name shows: $shown", async ({ text, shown }) => {
  expect(await shownText(<StreamingText text={appendText("", text)} animate />)).toBe(shown);
});

test("a choice split across two blocks shows once, as its words, with no brackets", async () => {
  const before = "a".repeat(1020);
  const text = appendText(appendText("", before), "[[domain:afoop.com|afoop]] done");
  // the choice starts in the first block and ends in the second
  expect(text).toMatchObject({ blockCount: 2 });
  expect(await shownText(<StreamingText text={text} animate />)).toBe(`${before}afoop done`);
});

test("an unfinished choice at the end of a full block is hidden until it ends", async () => {
  const text = appendText("", `${"a".repeat(1020)}[[name:moo`);
  expect(text).toMatchObject({ blockCount: 2 });
  expect(await shownText(<StreamingText text={text} />)).toBe("a".repeat(1020));
});

test("code keeps a choice as written", async () => {
  const code = appendText("", 'say("[[say:hi]]")');
  expect(await shownText(<StreamingCodeBlock code={code} />)).toBe('say("[[say:hi]]")');
});

test.for([
  {
    name: "an inline code span",
    text: "Write `[[say:hi]]` to offer [[say:Yes]].",
    shown: "Write `[[say:hi]]` to offer Yes.",
  },
  {
    name: "an inline code span still open",
    text: "Write `[[say:hi]]",
    shown: "Write `[[say:hi]]",
  },
  {
    name: "a fenced block",
    text: "Like this:\n```\n[[name:moose]]\n```\nor [[say:Yes]].",
    shown: "Like this:\n```\n[[name:moose]]\n```\nor Yes.",
  },
])("a choice in $name stays as written while it streams", async ({ text, shown }) => {
  expect(await shownText(<StreamingText text={appendText("", text)} animate />)).toBe(shown);
});

test.for([
  {
    name: "a choice's two opening brackets",
    blockEnd: "[",
    rest: "[say:hi]] ok",
    shown: "hi ok",
  },
  {
    name: "a fence's backticks",
    blockEnd: "\n``",
    rest: "`\n[[say:hi]]\n```\nthen [[say:Ok]]",
    shown: "\n```\n[[say:hi]]\n```\nthen Ok",
  },
  {
    name: "an inline code span",
    blockEnd: " `[[",
    rest: "say:hi]]` and [[say:Ok]]",
    shown: " `[[say:hi]]` and Ok",
  },
])("$name split across two blocks reads as one", async ({ blockEnd, rest, shown }) => {
  const before = "a".repeat(1024 - blockEnd.length);
  const text = appendText(appendText("", before + blockEnd), rest);
  expect(text).toMatchObject({ blockCount: 2, groups: { 0: { 0: before + blockEnd } } });
  expect(await shownText(<StreamingText text={text} animate />)).toBe(before + shown);
});

/** The text `node` draws in the document. */
async function shownText(node: ReactNode) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(node));
  const text = host.textContent;
  await act(async () => root.unmount());
  return text;
}
