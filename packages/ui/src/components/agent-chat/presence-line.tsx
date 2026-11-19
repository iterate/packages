// WHO IS HERE AND WHO CAN USE THIS CONVERSATION, beside Chat | Events (`ConversationAccess`, which
// the chat hands its shell as `aside`): a stack of faces, the others who have the conversation
// open now and the viewer's own last, as shared documents show it. It is one button, and behind
// it a card says who can use the conversation, who is here now and who else wrote. A press opens
// the card (on a touch screen too), and so do the pointer resting on the stack and the keyboard's
// focus. A press holds it open until the next press; the pointer leaving closes only a card the
// pointer opened (`whyOpen`). It is always there, because what its card says is always true:
// alone, it is the viewer's own face.
//
// WHO IS TYPING, in words for a screen reader only (`TypingStatus`), over the composer: the eye
// sees who types at the end of the feed, as their face with dots (participant.tsx
// `TypingInStream`), from the same principals. It takes no room, so the composer does not move.
//
// The faces come from `usePresence` (lib/presence.ts): the platform's rows of the pages open now and
// who holds each, never a name a page wrote. A face is the principal's initials on their own
// colour (`Face`), the same on every page; no picture is looked up anywhere.
//
// WHO IS IN THE CALL, where the agent's context has one (`inCall`, from the call's live state): a
// ring on their face in the stack, and "in the call" (and "camera", "screen") beside them in the
// card.
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { useId, useState } from "react";
import { cn } from "cn";
import type { MessageSender } from "./stream-event.ts";
import { Face } from "#/components/call/face.tsx";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "#/components/ui/popover.tsx";
import type { PresentPrincipal } from "#/lib/presence.ts";
import { faceOf, labelOf, shortLabelOf } from "#/lib/principal-label.ts";

/** Who of the principals here is in the agent's call, by actor id, and whether they send a camera
 *  and a screen: the host derives it from the call's live state. */
export type InCall = ReadonlyMap<string, { camera: boolean; screen: boolean }>;

/** The mark of a face in the call: a ring outside the stack's own. */
const IN_CALL_RING = "outline-2 outline-offset-1 outline-success";
const NOBODY_IN_CALL: InCall = new Map();

/** How many places the stack has for the others; with more here, the last place is "+n". The
 *  viewer's face comes after them, so the stack is at most five faces wide. */
const FACES = 4;

/** Who can use a conversation, in the words the page shows. An agent's reach is its context's:
 *  whoever writes to it makes it act with all of it. */
const SHARED_CONVERSATION_TEXT = {
  title: "Who can use this conversation",
  history:
    "Every member of this mind can open it, read all of its history (the messages, the scripts and their results) and write to it.",
  reach:
    "The agent acts for whoever writes here, with everything it can reach: its tools, its secrets and its files.",
};

/** Why the card is open: the pointer rests on the stack or the card, the keyboard's focus is on
 *  the button or in the card, or a press holds it. */
type Why = "hover" | "focus" | "held";

/** Why the card is open after a change base-ui asks for (`open`, for `reason`), or `null` when it
 *  closes. A press holds the card, and a press on a held card closes it. The pointer leaving
 *  closes only a card that the pointer opened, and the keyboard's focus outlasts the pointer. The
 *  focus opens the card through the handle (`imperative-action`). Escape, a press outside and the
 *  focus moving on close it whatever opened it. */
function whyOpen(
  why: Why | null,
  open: boolean,
  reason: PopoverPrimitive.Root.ChangeEventReason,
): Why | null {
  if (reason === "trigger-press") return open || why !== "held" ? "held" : null;
  if (reason === "trigger-hover") return open ? why || "hover" : why === "hover" ? null : why;
  if (reason === "imperative-action" && open) return why === "held" ? why : "focus";
  return open ? why || "held" : null;
}

/** WHO IS TYPING, said to a screen reader: always in the page, so it announces the words when
 *  they come; out of sight, because the feed draws the same fact. Its box has no height: the
 *  status in it takes no room. */
export function TypingStatus({
  typing,
}: {
  /** Everyone but the viewer who is typing now. */
  typing: readonly PresentPrincipal[];
}) {
  return (
    <div data-slot="agent-presence">
      <span role="status" className="sr-only">
        {typing.length > 0 ? typingWords(typing) : null}
      </span>
    </div>
  );
}

/** "ada is typing…", "ada and bob are typing…", "3 people are typing…". */
function typingWords(typing: readonly PresentPrincipal[]): string {
  if (typing.length === 1) return `${shortLabelOf(typing[0]!)} is typing…`;
  if (typing.length === 2)
    return `${shortLabelOf(typing[0]!)} and ${shortLabelOf(typing[1]!)} are typing…`;
  return `${String(typing.length)} people are typing…`;
}

/** WHO CAN USE THIS CONVERSATION: the stack of who is here, and behind it the card that says who
 *  can use the conversation, who is here now and who else wrote. Its accessible name is the
 *  card's title and who is here. It grows to its left as people come, so a header that holds it
 *  at its right end does not move its tabs. A page with a header of its own draws it there, with
 *  what `usePresence` and the chat's senders say. */
export function ConversationAccess({
  present,
  wrote,
  inCall = NOBODY_IN_CALL,
}: {
  /** Who is here now (`usePresence`), the viewer among them. */
  present: readonly PresentPrincipal[];
  /** Everyone but the viewer who wrote in the part of the conversation the page holds. */
  wrote: readonly MessageSender[];
  /** Who is in the agent's call; absent: the context has no call. */
  inCall?: InCall;
}) {
  const [why, setWhy] = useState<Why | null>(null);
  const [handle] = useState(() => PopoverPrimitive.createHandle());
  const trigger = useId();
  const others = present.filter((principal) => !principal.me);
  const here = new Set(others.map((principal) => principal.actor));
  const earlier = wrote.filter((sender) => !here.has(sender.actor));
  const name =
    others.length > 0
      ? `${SHARED_CONVERSATION_TEXT.title}. Here now: ${others.map(labelOf).join(", ")}.`
      : SHARED_CONVERSATION_TEXT.title;
  return (
    <Popover
      handle={handle}
      open={Boolean(why)}
      onOpenChange={(open, details) => {
        const next = whyOpen(why, open, details.reason);
        // a close that this card's reason outlasts does not happen, in base-ui either
        if (!open && next) details.cancel();
        setWhy(next);
      }}
    >
      <PopoverTrigger
        id={trigger}
        nativeButton
        openOnHover
        aria-label={name}
        data-conversation-access
        data-here={others.length}
        // the keyboard's focus opens the card through base-ui, which closes it when the focus
        // moves on; a press focuses the button with no focus ring, and opens it as a press
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) handle.open(trigger);
        }}
        render={<Button variant="ghost" size="sm" className="shrink-0 rounded-full px-0.5" />}
      >
        <FaceStack others={others} me={present.find((principal) => principal.me)} inCall={inCall} />
      </PopoverTrigger>
      {/* the card holds words only: the focus stays on the button, which names it */}
      <PopoverContent side="bottom" align="end" initialFocus={false} className="w-80">
        <PopoverHeader>
          <PopoverTitle>{SHARED_CONVERSATION_TEXT.title}</PopoverTitle>
          <PopoverDescription>{SHARED_CONVERSATION_TEXT.history}</PopoverDescription>
        </PopoverHeader>
        <p className="text-sm text-muted-foreground">{SHARED_CONVERSATION_TEXT.reach}</p>
        {others.length > 0 ? (
          <p className="text-sm break-words" data-shared-here>
            Here now: {others.map((principal) => hereLabel(principal, inCall)).join(", ")}
          </p>
        ) : null}
        {earlier.length > 0 ? (
          <p className="text-sm break-words" data-shared-wrote>
            Also wrote here: {earlier.map(labelOf).join(", ")}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** A FACE STACK: the others' faces, overlapping, the first `FACES` of them (the last place "+n"
 *  when more are here), and the viewer's last. Before the viewer's own row is known, a plain
 *  circle of the same size stands in their place. The faces are for the eye: the button that
 *  holds the stack says who is here in words. */
function FaceStack({
  others,
  me,
  inCall,
}: {
  others: readonly PresentPrincipal[];
  me: PresentPrincipal | undefined;
  inCall: InCall;
}) {
  const shown = others.length > FACES ? others.slice(0, FACES - 1) : others;
  return (
    <AvatarGroup className="-space-x-1.5">
      {shown.map((principal) => (
        <Face
          key={principal.actor}
          small
          {...faceOf(principal)}
          className={cn(
            "size-6",
            principal.state === "away" && "opacity-50",
            inCall.has(principal.actor) && IN_CALL_RING,
          )}
        />
      ))}
      {others.length > shown.length ? (
        <AvatarGroupCount className="size-6 text-2xs">
          +{String(others.length - shown.length)}
        </AvatarGroupCount>
      ) : null}
      {me ? (
        <Face
          small
          {...faceOf(me)}
          className={cn("size-6", inCall.has(me.actor) && IN_CALL_RING)}
        />
      ) : (
        <Avatar className="size-6" aria-hidden="true" data-viewer-unknown>
          <AvatarFallback />
        </Avatar>
      )}
    </AvatarGroup>
  );
}

/** Who is here, in the card: the long label, whether their page is in view, how many pages they
 *  have open here, and whether they are in the call and send a camera or a screen. */
function hereLabel(principal: PresentPrincipal, inCall: InCall): string {
  const call = inCall.get(principal.actor);
  const notes = [
    principal.state === "away" ? "away" : "",
    principal.pages > 1 ? `${String(principal.pages)} pages` : "",
    call ? "in the call" : "",
    call?.camera ? "camera" : "",
    call?.screen ? "screen" : "",
  ].filter(Boolean);
  return notes.length > 0 ? `${labelOf(principal)} (${notes.join(", ")})` : labelOf(principal);
}
