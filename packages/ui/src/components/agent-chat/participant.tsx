// participant.tsx — ANOTHER PARTICIPANT IN THE CHAT (a person, a guest, another mind), at the left:
// their face in a gutter of its own, and beside it their short name, or a bubble. The stream's
// first bubble of a run, the dots of who is typing and the queue's waiting messages all draw it so,
// and they read as one thing with the faces of the presence line. The viewer's own bubbles stand at
// the right with no face, and this conversation's own mind writes the full width with no bubble
// (agent-feed.tsx).
import { cn } from "cn";
import type { ReactNode } from "react";
import { Message, MessageContent } from "./message.tsx";
import { Face } from "#/components/call/face.tsx";
import type { PresentPrincipal } from "#/lib/presence.ts";
import { faceOf, labelOf, type ShownPrincipal } from "#/lib/principal-label.ts";

/** How many typists the stream draws before it counts the rest. */
const TYPISTS = 3;

/** A principal's face and their short name, the long label as the face's words and the name's
 *  title. A `data-*` attribute goes on the name: `data-said-by` in the stream, `data-queued-by` in
 *  the queue. */
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
    <BesideFace
      face={<ParticipantFace principal={principal} />}
      className={cn("font-readme text-2xs text-muted-foreground", className)}
    >
      <span {...data} title={label} className="min-w-0 truncate">
        {words}
      </span>
    </BesideFace>
  );
}

/** Another participant's bubble: the viewer's bubble's look, at the left, past the gutter (`w-6`
 *  and its `gap-2`). `face` stands in the gutter beside the bubble's first line: the first bubble
 *  of a run and the dots of who types have one, the bubbles after it keep the indent alone. */
export function ParticipantBubble({ children, face }: { children: ReactNode; face?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      {/* `pt-3.5`: a small face (20 px) stands at the middle of a bubble's first line */}
      <span className="flex w-6 shrink-0 pt-3.5">{face}</span>
      <Message from="user" side="start">
        <MessageContent className="group-[.is-user]:rounded-2xl">{children}</MessageContent>
      </Message>
    </div>
  );
}

/** A participant's small face, with the long label as its words: beside a bubble, and beside a
 *  name in the queue. */
export function ParticipantFace({ principal }: { principal: ShownPrincipal }) {
  return <Face small {...faceOf(principal)} label={labelOf(principal)} />;
}

/** Who else is typing, at the end of the stream where their next bubble will come: each one's face
 *  beside a bubble of three dots, the first three, then how many more. For the eye only: the
 *  presence line's status says it in words to a screen reader (presence-line.tsx). */
export function TypingInStream({ typing }: { typing: readonly PresentPrincipal[] }) {
  return (
    <div data-typing-in-stream aria-hidden="true" className="flex flex-col gap-1 pb-2 pt-3.5">
      {typing.slice(0, TYPISTS).map((principal) => (
        <ParticipantBubble key={principal.actor} face={<ParticipantFace principal={principal} />}>
          {/* as tall as one line of words (`leading-6`), so the bubble that follows is no taller */}
          <span className="flex h-6 items-center gap-1">
            <TypingDot />
            <TypingDot className="[animation-delay:150ms]" />
            <TypingDot className="[animation-delay:300ms]" />
          </span>
        </ParticipantBubble>
      ))}
      {typing.length > TYPISTS ? (
        <BesideFace
          face={
            <span data-typing-more className="w-full text-center text-2xs text-muted-foreground">
              +{String(typing.length - TYPISTS)}
            </span>
          }
        />
      ) : null}
    </div>
  );
}

/** A face in the gutter (`w-6`, 24 px), and what stands beside it a `gap-2` away. */
function BesideFace({
  face,
  children,
  className,
}: {
  face: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="flex w-6 shrink-0">{face}</span>
      {children}
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
