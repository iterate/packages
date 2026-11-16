// caption-strip.tsx — THE LINE OF SPOKEN WORDS under a call. Talk is not the feed: the feed is what
// was typed, shared and answered. What is said runs along one quiet line, newest at the right edge,
// as a person speaks: the newest lines said, then the captions still being spoken, in italics. It
// moves only as words arrive, so it needs no animation (and none for reduced motion). The button
// opens the transcript (transcript-history.tsx): every line said, with its time and speaker, to
// check what was misheard.
import { ChevronRightIcon } from "lucide-react";
import { cn } from "cn";
import { nameOf, type LiveCaption, type SpokenLine } from "./spoken-lines.ts";
import { Button } from "#/components/ui/button.tsx";

/** How many of the lines said the strip shows: about one line's width. */
const RECENT = 6;

/** `said`: every line said, oldest first. `live.captions`: words still being spoken;
 *  `live.pending`: how many of the viewer's own utterances are being transcribed, shown as
 *  "transcribing…" under `me`, the viewer's address. `open` and `onOpen`: the transcript's state,
 *  which the page holds. */
export function CaptionStrip({
  said,
  live,
  me,
  open,
  onOpen,
  className,
}: {
  said: readonly SpokenLine[];
  live: { captions: readonly LiveCaption[]; pending: number };
  me: string;
  open: boolean;
  onOpen: () => void;
  className?: string;
}) {
  const words: { key: string; who: string; text: string; live: boolean }[] = [
    ...said.slice(-RECENT).map(({ key, who, text }) => ({ key, who, text, live: false })),
    ...live.captions.map(({ from, who, text }) => ({ key: `live:${from}`, who, text, live: true })),
    ...(live.pending ? [{ key: "pending", who: me, text: "transcribing…", live: true }] : []),
  ];
  return (
    <div
      data-slot="caption-strip"
      className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}
    >
      <Button
        variant="ghost"
        size="xs"
        aria-expanded={open}
        onClick={onOpen}
        className="shrink-0 font-normal text-muted-foreground"
      >
        <ChevronRightIcon data-icon="inline-start" className={cn(open && "rotate-90")} />
        {said.length ? `Transcript (${String(said.length)})` : "Transcript"}
      </Button>
      {/* off: a screen reader would read every word twice, as a caption and again as a line. The
          words align to the right edge and overflow to the left, under a fade. */}
      <div aria-live="off" className="min-w-0 flex-1 overflow-hidden mask-l-from-[calc(100%-3rem)]">
        <div className="flex justify-end gap-3.5 whitespace-nowrap">
          {words.length ? (
            words.map((line) => (
              <span
                key={line.key}
                data-live={line.live || undefined}
                className={cn(line.live && "italic")}
              >
                <b className="font-semibold text-foreground">{nameOf(line.who)}</b> {line.text}
              </span>
            ))
          ) : (
            <span>Spoken lines appear here.</span>
          )}
        </div>
      </div>
    </div>
  );
}
