// transcript-rollup.tsx — A RUN OF SPOKEN LINES as one quiet row of a feed: "12 lines said · 14:02
// to 14:05", with the speakers' faces. A press opens the lines in place. It looks like the agent
// chat's "3 messages came in" row (agent-chat/agent-feed.tsx, BackgroundRow): the same quiet button,
// chevron and indented body. `rollUpSpokenLines` (spoken-lines.ts) makes the runs.
import { ChevronRightIcon } from "lucide-react";
import { cn } from "cn";
import { Face } from "./face.tsx";
import type { SpokenLine } from "./spoken-lines.ts";
import { TranscriptLines } from "./transcript-history.tsx";
import { Button } from "#/components/ui/button.tsx";

/** How many lines the open row shows: a long call says thousands, and the transcript has them. */
const SHOWN = 200;

/** How many speakers' faces the closed row shows. */
const FACES = 3;

const clockOf = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** "12 lines said · 14:02 to 14:05", or one time when the run starts and ends in the same minute. */
function labelOf(lines: readonly SpokenLine[]) {
  const count = lines.length === 1 ? "1 line said" : `${String(lines.length)} lines said`;
  const first = lines[0];
  const last = lines.at(-1);
  if (!first || !last) return count;
  const [from, to] = [clockOf(first.at), clockOf(last.at)];
  return `${count} · ${from === to ? from : `${from} to ${to}`}`;
}

/** The first `FACES` distinct speakers, in the order they first spoke. */
function speakersOf(lines: readonly SpokenLine[]) {
  const speakers = new Set<string>();
  for (const line of lines) {
    speakers.add(line.who);
    if (speakers.size === FACES) break;
  }
  return [...speakers];
}

/** `lines`: the run, oldest first. `me`: the viewer's address, for "(you)". `expanded` and
 *  `onToggle`: whether the lines show, which the page holds. `agent`: who is drawn as iterate's
 *  mark (default `"iterate"`). */
export function TranscriptRollup({
  lines,
  me,
  expanded,
  onToggle,
  agent = "iterate",
}: {
  lines: readonly SpokenLine[];
  me: string;
  expanded: boolean;
  onToggle: () => void;
  agent?: string;
}) {
  return (
    <div className="flex flex-col py-0.5" data-kind="rollup" data-slot="transcript-rollup">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        title="Said in the call"
        onClick={onToggle}
        className="-ml-2.5 max-w-full self-start font-normal text-muted-foreground"
      >
        {expanded ? null : (
          <span aria-hidden className="flex shrink-0 -space-x-1.5">
            {speakersOf(lines).map((who) => (
              <Face key={who} who={who} agent={agent} className="size-5 ring-2 ring-background" />
            ))}
          </span>
        )}
        <span className="min-w-0 truncate">{labelOf(lines)}</span>
        <ChevronRightIcon
          data-icon="inline-end"
          className={cn("text-muted-foreground/50", expanded && "rotate-90")}
        />
      </Button>
      {expanded ? (
        <div className="mt-0.5 mb-1.5 ml-1 flex min-w-0 flex-col gap-1.5 border-l-2 border-muted py-1 pl-4 text-xs leading-5 text-muted-foreground">
          {lines.length > SHOWN ? <p>The newest {SHOWN}. The transcript has them all.</p> : null}
          <TranscriptLines lines={lines.slice(-SHOWN)} me={me} />
        </div>
      ) : null}
    </div>
  );
}
