// transcript-history.tsx — THE TRANSCRIPT of a call: every line said, oldest first, each with its
// time and its speaker, to check what was misheard. It opens over the caption strip
// (caption-strip.tsx), scrolled to the newest line, and reads older pages of the log on request.
// `TranscriptLines` is the list alone, which a feed's rollup row (transcript-rollup.tsx) shows too.
import { useEffect, useRef } from "react";
import { cn } from "cn";
import { nameOf, type SpokenLine } from "./spoken-lines.ts";
import { Button } from "#/components/ui/button.tsx";
import type { OlderPages } from "#/components/virtual-log/older-pages.ts";

/** Lines said, one per item: the time, the speaker ("(you)" after `me`, the viewer's address) and
 *  the words. */
export function TranscriptLines({ lines, me }: { lines: readonly SpokenLine[]; me: string }) {
  return (
    <ol className="flex flex-col gap-0.5">
      {lines.map((line) => (
        <li key={line.key} className="wrap-anywhere">
          <time dateTime={new Date(line.at).toISOString()} className="text-muted-foreground">
            {new Date(line.at).toLocaleTimeString()}
          </time>{" "}
          <b className="font-semibold text-foreground">
            {nameOf(line.who)}
            {line.who === me ? " (you)" : ""}:
          </b>{" "}
          {line.text}
        </li>
      ))}
    </ol>
  );
}

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
  const list = useRef<HTMLElement>(null);
  // a new line scrolls the list to it, as a feed does
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [said.length]);
  return (
    <section
      ref={list}
      data-slot="transcript-history"
      aria-label="Transcript"
      className={cn(
        "flex max-h-[min(40vh,22.5rem)] flex-col items-start gap-1 overflow-y-auto bg-background px-1.5 py-1 text-sm leading-normal",
        className,
      )}
    >
      {older.exhausted ? null : (
        <Button
          variant="ghost"
          size="xs"
          disabled={older.loading}
          onClick={() => older.loadOlder()}
          className="font-normal text-muted-foreground"
        >
          {older.loading ? "Loading…" : "Load older lines"}
        </Button>
      )}
      {said.length ? (
        <TranscriptLines lines={said} me={me} />
      ) : (
        <p className="text-muted-foreground">Nothing said yet.</p>
      )}
    </section>
  );
}
