// How far a read of the log has come: a read of a long context can take a while, and a person should
// see it moving.
import { useEffect, useState } from "react";
import { cn } from "cn";
import { Spinner } from "#/components/ui/spinner.tsx";

export function ReadProgress({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground"
    >
      <span className="shrink-0 tabular-nums">
        {label}… {percent}%
      </span>
      <span className="h-1 min-w-0 flex-1 overflow-hidden bg-muted">
        <span
          className="block h-full bg-primary transition-[width] duration-300"
          style={{ width: `${String(percent)}%` }}
        />
      </span>
    </div>
  );
}

/** THE WAIT A PERSON IS IN, which every `LogReading` of the document shares: when its first
 *  loading state went up, how many stand now, and when the last one came down. A page's loading
 *  state and then a view's own are one wait to the eye, whichever element draws it. */
const wait = { beganAt: 0, standing: 0, endedAt: -Infinity, first: true };

/** When the wait began that a loading state going up at `now` belongs to: the one that stands, or
 *  that came down in the last frames (one element takes another's place in one commit, and the
 *  old one's effect has not said so yet), or a new one. The document's first wait began with the
 *  page itself (time 0) when its HTML drew a loading frame before the app had loaded, which it
 *  says with `data-frame` on `<html>`: the person has been waiting since that frame. That holds
 *  for the loading state the app draws first, in the page's first 10 s; a wait that begins later
 *  (a view opened from a page that loaded with no wait) begins when its state goes up. */
function waitBeganAt(now: number) {
  if (wait.standing === 0 && now - wait.endedAt > 100) {
    const framed =
      wait.first &&
      now < 10_000 &&
      !import.meta.env.SSR &&
      document.documentElement.hasAttribute("data-frame");
    wait.beganAt = framed ? 0 : now;
  }
  wait.first = false;
  return wait.beganAt;
}

/** A LOADING STATE THAT IS NOT A LINE, for the same wait: a page's placeholder shapes draw this
 *  beside them, so the wait they stand in is the one a view's line then goes on with, and the
 *  page's first wait is theirs when they come first. It draws nothing. */
export function LoadingWait() {
  useState(() => waitBeganAt(performance.now()));
  useEffect(() => {
    wait.standing += 1;
    return () => {
      wait.standing -= 1;
      wait.endedAt = performance.now();
    };
  }, []);
  return null;
}

/** What a view shows in place of its rows while its log is still being read, and never its words
 *  for an empty log: a spinner and a line, or how far the read has come (`progress`, from 0 to 1)
 *  once the view can tell. It stays unseen for the first 200 ms of the wait and then fades in, so
 *  a read that answers at once paints no loading state. One that takes the place of another goes
 *  on with its wait: it does not start unseen again. The line keeps its height from the first read
 *  to the older pages after it. */
export function LogReading({
  label,
  progress,
  className,
}: {
  label: string;
  progress?: number;
  /** The view's own padding around the line. */
  className?: string;
}) {
  // what is left of the 200 ms; below zero the fade is under way or over, and CSS starts it there
  const [unseenMs] = useState(() => {
    const now = performance.now();
    return Math.round(200 - (now - waitBeganAt(now)));
  });
  useEffect(() => {
    wait.standing += 1;
    return () => {
      wait.standing -= 1;
      wait.endedAt = performance.now();
    };
  }, []);
  return (
    <div
      data-slot="log-reading"
      style={{ animationDelay: `${String(unseenMs)}ms` }}
      className={cn("animate-in fade-in-0 fill-mode-both text-sm", className)}
    >
      <div className="flex h-5 items-center gap-2 text-muted-foreground">
        {progress === undefined ? (
          <>
            <Spinner /> {label}…
          </>
        ) : (
          <ReadProgress label={label} value={progress} />
        )}
      </div>
    </div>
  );
}
