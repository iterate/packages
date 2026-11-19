// participant.tsx — ANOTHER PARTICIPANT IN THE CHAT (a person, a guest, another mind), at the left:
// their face in a gutter of its own, and beside it their short name, or a bubble. The stream's
// bubbles, the dots of who is typing and the queue's waiting messages all draw it so, and they read
// as one thing with the header's stack of who is here. The viewer's own bubbles stand at the right
// with no face, and this conversation's own mind writes the full width with no bubble
// (agent-feed.tsx).
import { cn } from "cn";
import type { HTMLAttributes, ReactNode } from "react";
import { Message, MessageContent } from "./message.tsx";
import { Face } from "#/components/call/face.tsx";
import type { PresentPrincipal } from "#/lib/presence.ts";
import { faceOf, labelOf, shortLabelOf, type ShownPrincipal } from "#/lib/principal-label.ts";

/** How many typists the stream draws before it counts the rest. */
const TYPISTS = 3;

/** The face's gutter (`1.5rem`, a small face's 20 px and some air) and the column beside it. */
const BESIDE_FACE = "grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2";

/** A principal's face and their short name, the long label as the face's words and the name's
 *  title. A `data-*` attribute goes on the name: `data-queued-by` in the queue. */
export function FaceAndName({
  principal,
  words,
  className,
  ...data
}: {
  principal: ShownPrincipal;
  words: string;
  className?: string;
} & { [attribute: `data-${string}`]: true }) {
  const label = labelOf(principal);
  return (
    <div
      className={cn(
        BESIDE_FACE,
        "items-center font-readme text-2xs text-muted-foreground",
        className,
      )}
    >
      <span className="flex">
        <Face small {...faceOf(principal)} label={label} />
      </span>
      <span {...data} title={label} className="min-w-0 truncate">
        {words}
      </span>
    </div>
  );
}

/** Another participant's row in the stream: the first of a run has their short name over the
 *  bubble and their face beside its first line, in the gutter; a later one has the bubble alone, in
 *  the same column. The face and the name are for the eye: each bubble says its author's long label
 *  once to a screen reader, so a later bubble still says it when the list has unmounted the first. */
export function ParticipantRow({
  principal,
  name,
  first,
  children,
  className,
  ...props
}: {
  principal: ShownPrincipal;
  /** The short name over the first bubble of a run. */
  name: string;
  first: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cn(BESIDE_FACE, "gap-y-1 pb-2", first && "pt-3.5", className)}>
      {first ? (
        <>
          <span
            data-said-by
            aria-hidden="true"
            title={labelOf(principal)}
            className="col-start-2 row-start-1 truncate font-readme text-2xs text-muted-foreground"
          >
            {name}
          </span>
          {/* in the bubble's row, by name: the grid's own placing is not relied on. `pt-3.5`: a
              small face (20 px) stands at the middle of a bubble's first line */}
          <span aria-hidden="true" className="col-start-1 row-start-2 flex pt-3.5">
            <Face small {...faceOf(principal)} />
          </span>
        </>
      ) : null}
      <Message from="user" side="start" className={cn("col-start-2", first && "row-start-2")}>
        <MessageContent className="group-[.is-user]:rounded-2xl">
          <MessageAuthor>{labelOf(principal)}</MessageAuthor>
          {children}
        </MessageContent>
      </Message>
    </div>
  );
}

/** Who wrote a message, in words for a screen reader alone: the first thing it reads of a bubble. */
export function MessageAuthor({ children }: { children: string }) {
  return <span className="sr-only">{`${children}:`}</span>;
}

/** Who else is typing, at the end of the stream where their next bubble will come: a bubble of
 *  three dots for each of the first three, then how many more. Each row is the row their message
 *  will be, so the bubble that takes its place lands where the dots stood: it goes on the run the
 *  stream ends with (`runOf`, its sender's actor id) with no name and no face, else it starts a run
 *  under the name and beside the face. For the eye only: `TypingStatus` says it in words to a
 *  screen reader (presence-line.tsx). */
export function TypingInStream({
  typing,
  runOf,
}: {
  typing: readonly PresentPrincipal[];
  runOf: string | undefined;
}) {
  // the one whose run the stream ends with comes first: the others' runs start after theirs
  const shown = typing.toSorted((a, b) => Number(b.actor === runOf) - Number(a.actor === runOf));
  return (
    <div data-typing-in-stream aria-hidden="true">
      {shown.slice(0, TYPISTS).map((principal) => (
        <ParticipantRow
          key={principal.actor}
          principal={principal}
          name={shortLabelOf(principal)}
          first={principal.actor !== runOf}
        >
          {/* as tall as one line of words (`leading-6`), so the bubble that follows is no taller */}
          <span className="flex h-6 items-center gap-1">
            <TypingDot />
            <TypingDot className="[animation-delay:150ms]" />
            <TypingDot className="[animation-delay:300ms]" />
          </span>
        </ParticipantRow>
      ))}
      {typing.length > TYPISTS ? (
        <div className={cn(BESIDE_FACE, "pb-2")}>
          <span data-typing-more className="text-center text-2xs text-muted-foreground">
            +{String(typing.length - TYPISTS)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** One dot of three; it pulses unless the reader asks for less motion. */
function TypingDot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse",
        className,
      )}
    />
  );
}
