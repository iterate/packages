// The live text of a step as it streams — sealed groups keep their React subtree and only the small
// append tail changes; code stays plain (no highlighting) while it is still being written; a
// blinking caret marks the tail. A choice in the agent's words (`[[kind:value|label]]`) shows as its
// plain words, and one not finished yet is hidden. Inside an inline code span or a fenced block it
// stays as written. Each block starts in the code state the block before ended in, and a block's
// unfinished end (a choice, a single `[`, a run of backticks) carries into the next block, so a
// choice or a fence split across two blocks reads as one. `literal` (a code step) is the text as
// written.
import { memo } from "react";
import { cn } from "cn";
import { choicesInPlainWords, withoutUnfinishedChoice } from "./choice-in-words.tsx";
import { textGroupSize, type StreamText } from "./chunked-text.ts";
import { FullTextSnapshot } from "./full-text-snapshot.tsx";

/** Sealed groups keep their React subtree; only the small append tail changes. */
export const StreamingText = memo(function StreamingText({
  text,
  animate = false,
  literal = false,
}: {
  text: StreamText;
  animate?: boolean;
  /** `true`: the text as written, choices included (code). */
  literal?: boolean;
}) {
  if (typeof text === "string") return literal ? text : streamedWords(proseStart, text).text;
  const lastBlock = text.blockCount - 1;
  const lastGroup = Math.floor(lastBlock / textGroupSize);
  // Even unchanged inline nodes share a paragraph's layout. Bound the live formatting context;
  // retain complete text in state and materialize on demand.
  const firstBlock = Math.max(0, text.blockCount - 32);
  const entries = literal ? {} : groupEntries(text, firstBlock);
  return (
    <>
      {firstBlock > 0 ? <FullTextSnapshot text={text} /> : null}
      {Object.entries(text.groups).map(([key, blocks]) => {
        if (Number(key) < Math.floor(firstBlock / textGroupSize)) return null;
        const entry = entries[Number(key)] ?? proseStart;
        return (
          <TextGroup
            key={key}
            blocks={blocks}
            firstBlock={Number(key) === Math.floor(firstBlock / textGroupSize) ? firstBlock : 0}
            tailBlock={animate && Number(key) === lastGroup ? lastBlock : null}
            tailOffset={animate && Number(key) === lastGroup ? text.tailOffset : 0}
            carry={entry.carry}
            fence={entry.fence}
            tick={entry.tick}
            lineStart={entry.lineStart}
            literal={literal}
          />
        );
      })}
    </>
  );
});

/** Where a block starts: inside a fence (its marker, or ""), inside an inline code span (its
 *  backtick count, or 0), at a line's start, and the end of the block before that it shows. */
type BlockEntry = { fence: string; tick: number; lineStart: boolean; carry: string };

const proseStart: BlockEntry = { fence: "", tick: 0, lineStart: true, carry: "" };

/** The entry of each drawn group's first block, by group. */
function groupEntries(
  text: Exclude<StreamText, string>,
  firstBlock: number,
): Record<number, BlockEntry> {
  const entries: Record<number, BlockEntry> = {};
  let entry = proseStart;
  for (let index = Math.max(0, firstBlock - 1); index < text.blockCount; index++) {
    if (index % textGroupSize === 0 || index === firstBlock)
      entries[Math.floor(index / textGroupSize)] = entry;
    entry = streamedWords(entry, text.groups[Math.floor(index / textGroupSize)]![index]!).next;
  }
  return entries;
}

/** A block as a running answer shows it: in prose each choice is its plain words; in code it is as
 *  written. The end that may still grow (a run of backticks, or in prose an unfinished choice or a
 *  single `[`) is not shown: it is the next block's `carry`. */
function streamedWords(entry: BlockEntry, written: string): { text: string; next: BlockEntry } {
  const input = entry.carry + written;
  const ticks = /[`~]+$/.exec(input)?.[0] || "";
  const { parts, end } = codeParts(entry, input.slice(0, input.length - ticks.length));
  let carry = ticks;
  const last = parts.at(-1);
  if (!ticks && last && !last.code) {
    let kept = withoutUnfinishedChoice(last.text);
    if (kept.endsWith("[")) kept = kept.slice(0, -1);
    carry = last.text.slice(kept.length);
    last.text = kept;
  }
  return {
    text: parts.map((part) => (part.code ? part.text : choicesInPlainWords(part.text))).join(""),
    next: { ...end, carry },
  };
}

/** `text` cut into prose and code, from the code state `entry` names: a line that starts with three
 *  or more backticks or tildes opens or closes a fence, and outside a fence a run of backticks
 *  opens an inline span that the next run of the same length closes (a blank line ends it). */
function codeParts(
  entry: Omit<BlockEntry, "carry">,
  text: string,
): { parts: { code: boolean; text: string }[]; end: Omit<BlockEntry, "carry"> } {
  let { fence, tick, lineStart } = entry;
  const parts: { code: boolean; text: string }[] = [];
  let start = 0;
  let code = Boolean(fence) || tick > 0;
  // ends the part before `at`, and starts the next as code or prose
  const cut = (at: number, nextIsCode: boolean) => {
    if (at > start) parts.push({ code, text: text.slice(start, at) });
    start = at;
    code = nextIsCode;
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "`" || char === "~") {
      let runEnd = index;
      while (text[runEnd] === char) runEnd++;
      const run = runEnd - index;
      if (fence) {
        if (lineStart && char === fence[0] && run >= fence.length) {
          fence = "";
          cut(runEnd, false);
        }
      } else if (tick) {
        if (char === "`" && run === tick) {
          tick = 0;
          cut(runEnd, false);
        }
      } else if (lineStart && run >= 3) {
        cut(index, true);
        fence = char.repeat(run);
      } else if (char === "`") {
        cut(index, true);
        tick = run;
      }
      index = runEnd;
      lineStart = false;
      continue;
    }
    if (tick && char === "\n" && text[index + 1] === "\n") {
      tick = 0;
      cut(index, false);
    }
    lineStart = char === "\n" || (lineStart && (char === " " || char === "\t"));
    index++;
  }
  cut(text.length, code);
  return { parts, end: { fence, tick, lineStart } };
}

const TextGroup = memo(function TextGroup({
  blocks,
  firstBlock,
  tailBlock,
  tailOffset,
  literal,
  ...first
}: BlockEntry & {
  blocks: Readonly<Record<string, string>>;
  firstBlock: number;
  tailBlock: number | null;
  tailOffset: number;
  literal: boolean;
}) {
  let entry: BlockEntry = first;
  return Object.entries(blocks).map(([key, text]) => {
    if (Number(key) < firstBlock) return null;
    const blockEntry = entry;
    if (!literal) entry = streamedWords(entry, text).next;
    return (
      <TextBlock
        key={key}
        text={text}
        {...blockEntry}
        literal={literal}
        revealFrom={Number(key) === tailBlock ? tailOffset : null}
      />
    );
  });
});

const TextBlock = memo(function TextBlock({
  text: written,
  literal,
  revealFrom: writtenRevealFrom,
  ...entry
}: BlockEntry & {
  text: string;
  literal: boolean;
  revealFrom: number | null;
}) {
  const text = literal ? written : streamedWords(entry, written).text;
  if (typeof writtenRevealFrom !== "number") return <span>{text}</span>;
  // the words before this append, as they were shown: the new tail is what differs from them
  const before = literal
    ? written.slice(0, writtenRevealFrom)
    : streamedWords(entry, written.slice(0, writtenRevealFrom)).text;
  let revealFrom = 0;
  while (revealFrom < before.length && before[revealFrom] === text[revealFrom]) revealFrom++;
  const tail = text.slice(revealFrom);
  const words = [...tail.matchAll(/\S+\s*|\s+/g)];
  // Unusually dense whitespace must not create a span per character. The animation is
  // transient; sealed blocks contain one ordinary text node.
  const tokens = words.length <= 64 ? words : [{ 0: tail, index: 0 }];
  return (
    <span>
      {text.slice(0, revealFrom)}
      {tokens.map((token) => (
        <span
          key={revealFrom + token.index}
          className="animate-token-in motion-reduce:animate-none"
          style={{ animationDelay: `${Math.round((token.index / tail.length) * 140)}ms` }}
        >
          {token[0]}
        </span>
      ))}
    </span>
  );
});

/** Plain text while code is changing; syntax highlighting belongs to settled output. */
export function StreamingCodeBlock({ code }: { code: StreamText }) {
  return (
    <pre className="whitespace-pre-wrap rounded-xl bg-warning/10 px-4 py-3 font-mono text-xs leading-relaxed text-foreground wrap-break-word">
      <StreamingText text={code} literal />
      <StreamingCursor className="bg-warning" />
    </pre>
  );
}

export function StreamingCursor({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ml-px inline-block h-3.5 w-[7px] animate-caret-blink bg-muted-foreground/40 align-[-2px]",
        className,
      )}
    />
  );
}
