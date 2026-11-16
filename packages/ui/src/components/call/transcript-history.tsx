// transcript-history.tsx — THE TRANSCRIPT of a call: every line said, oldest first, each with its
// time and its speaker, to check what was misheard. It opens over the caption strip
// (caption-strip.tsx), a small panel, not a page. It is a view of a log, so it stands on the
// virtual log (virtual-log/AGENTS.md): it opens at the newest line and stays there as lines
// arrive, a reader who scrolled up keeps their place, and older pages load as the reader nears the
// top. `TranscriptLines` is a plain list, for the feed's rollup row (transcript-rollup.tsx).
import { useCallback } from "react";
import { cn } from "cn";
import { nameOf, type SpokenLine } from "./spoken-lines.ts";
import type { OlderPages } from "#/components/virtual-log/older-pages.ts";
import { VirtualLog, type VirtualLogRowInfo } from "#/components/virtual-log/virtual-log.tsx";

/** One line said: the time, the speaker ("(you)" after `me`, the viewer's address) and the words. */
function SpokenLineText({ line, me }: { line: SpokenLine; me: string }) {
  return (
    <>
      <time dateTime={new Date(line.at).toISOString()} className="text-muted-foreground">
        {new Date(line.at).toLocaleTimeString()}
      </time>{" "}
      <b className="font-semibold text-foreground">
        {nameOf(line.who)}
        {line.who === me ? " (you)" : ""}:
      </b>{" "}
      {line.text}
    </>
  );
}

/** Lines said, one per item. A BOUNDED PREVIEW, not a view of a log: its caller passes a few
 *  lines (`TranscriptRollup` at most 200 of one run), so it maps them and needs no virtual log. */
export function TranscriptLines({ lines, me }: { lines: readonly SpokenLine[]; me: string }) {
  return (
    <ol className="flex flex-col gap-0.5">
      {lines.map((line) => (
        <li key={line.key} className="wrap-anywhere">
          <SpokenLineText line={line} me={me} />
        </li>
      ))}
    </ol>
  );
}

/** A line's offset, when the page gives one, lets the bubble at the bottom count the lines that
 *  arrived below a reader who scrolled up. Without it the bubble only points the way back. */
const LINES: VirtualLogRowInfo<SpokenLine> = {
  key: (line) => line.key,
  estimateSize: () => 24,
  offset: (line) => line.offset,
};

/** `said`: every line said that is loaded, oldest first. `older`: the log's older pages, as the
 *  page's context hands them (`useIterateContext(...).older`). `me`: the viewer's address. */
export function TranscriptHistory({
  said,
  older,
  me,
  className,
}: {
  said: readonly SpokenLine[];
  older: OlderPages;
  me: string;
  className?: string;
}) {
  const renderRow = useCallback(
    (line: SpokenLine) => (
      // spacing is padding, so the row's first measurement is its height
      <div className="px-1.5 py-0.5 wrap-anywhere">
        <SpokenLineText line={line} me={me} />
      </div>
    ),
    [me],
  );
  // Only a max height: the box is as tall as its lines, up to the cap (in Chromium, three lines
  // made it 83 px tall and 600 lines made it 360 px). The virtual log's scroller is `flex-1 min-h-0` in
  // this column, so it takes the lines' height (the virtualizer sets its container to their
  // total) and scrolls once the cap is reached.
  return (
    <div
      data-slot="transcript-history"
      className={cn(
        "flex max-h-[min(40vh,22.5rem)] flex-col bg-background text-sm leading-normal",
        className,
      )}
    >
      <VirtualLog
        rows={said}
        rowInfo={LINES}
        renderRow={renderRow}
        older={older}
        readingOlder={<p className="px-1.5 text-muted-foreground">Loading older lines…</p>}
        empty={<p className="px-1.5 py-1 text-muted-foreground">Nothing said yet.</p>}
        label="Transcript"
        paddingStart={4}
        paddingEnd={4}
      />
    </div>
  );
}
