// WHO ELSE IS HERE, over the composer: a face for each other principal with the conversation open
// now, and the words "… is typing" while one of them writes. One line of a fixed height beside the
// agent's status, so the composer does not move when someone arrives, types or leaves. The typing
// words are for a screen reader only: the eye sees who types at the end of the feed, as their face
// with dots (participant.tsx `TypingInStream`), from the same principals.
//
// WHO CAN USE THIS CONVERSATION, beside Chat | Events (`ConversationAccess`, which the chat hands
// its shell as `aside`): a quiet people icon whose card says who can use it, who is here now and
// who else wrote. A count on the icon says how many others are here or wrote; alone, it is the
// plain icon. It is always there, because what its card says is always true.
//
// The faces come from `usePresence` (lib/presence.ts): the platform's rows of the pages open now and
// who holds each, never a name a page wrote. A face is the principal's initials on their own
// colour (`Face`), the same on every page; no picture is looked up anywhere.
import { UsersIcon } from "lucide-react";
import type { MessageSender } from "./stream-event.ts";
import { Face } from "#/components/call/face.tsx";
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

/** How many faces the line draws before it counts the rest. */
const FACES = 5;

/** Who can use a conversation, in the words the page shows. An agent's reach is its context's:
 *  whoever writes to it makes it act with all of it. */
const SHARED_CONVERSATION_TEXT = {
  title: "Who can use this conversation",
  history:
    "Every member of this mind can open it, read all of its history (the messages, the scripts and their results) and write to it.",
  reach:
    "The agent acts for whoever writes here, with everything it can reach: its tools, its secrets and its files.",
};

/** "ada is typing…", "ada and bob are typing…", "3 people are typing…". */
function typingWords(typing: readonly PresentPrincipal[]): string {
  if (typing.length === 1) return `${shortLabelOf(typing[0]!)} is typing…`;
  if (typing.length === 2)
    return `${shortLabelOf(typing[0]!)} and ${shortLabelOf(typing[1]!)} are typing…`;
  return `${String(typing.length)} people are typing…`;
}

export function PresenceLine({
  present,
}: {
  /** Who is here now (`usePresence`), the viewer among them. */
  present: readonly PresentPrincipal[];
}) {
  const others = present.filter((principal) => !principal.me);
  const typing = others.filter((principal) => principal.typing);
  return (
    <div
      data-slot="agent-presence"
      className="flex h-6 min-w-0 items-center justify-end gap-1.5 px-1 pb-1 text-xs text-muted-foreground"
    >
      {/* always in the page, so a screen reader announces the words when they come; out of sight,
          because the feed draws the same fact */}
      <span role="status" className="sr-only">
        {typing.length > 0 ? typingWords(typing) : null}
      </span>
      {others.length > 0 ? (
        <span className="flex shrink-0 items-center [&>*+*]:-ml-1" data-here={others.length}>
          {others.slice(0, FACES).map((principal) => (
            <Face
              key={principal.actor}
              small
              {...faceOf(principal)}
              label={hereLabel(principal)}
              className={principal.state === "away" ? "opacity-50" : undefined}
            />
          ))}
          {others.length > FACES ? (
            <span className="pl-2">+{String(others.length - FACES)}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** A face's words: who, whether their page is in view, and how many pages they have open here. */
function hereLabel(principal: PresentPrincipal): string {
  const pages = principal.pages > 1 ? `, ${String(principal.pages)} pages` : "";
  return `${labelOf(principal)} is ${principal.state === "away" ? "here, in another tab or app" : "here"}${pages}`;
}

/** WHO CAN USE THIS CONVERSATION: a people icon, with how many others are here or wrote, and
 *  behind it the card that says who can use the conversation, who is here now and who else
 *  wrote. One size whatever it counts, so a header does not move. Its title, the hover text
 *  and the accessible name, is `SHARED_CONVERSATION_TEXT.title`. A page with a header of its own draws it there, with what
 *  `usePresence` and the chat's senders say. */
export function ConversationAccess({
  present,
  wrote,
}: {
  /** Who is here now (`usePresence`), the viewer among them. */
  present: readonly PresentPrincipal[];
  /** Everyone but the viewer who wrote in the part of the conversation the page holds. */
  wrote: readonly MessageSender[];
}) {
  const others = present.filter((principal) => !principal.me);
  const here = new Set(others.map((principal) => principal.actor));
  const earlier = wrote.filter((sender) => !here.has(sender.actor));
  const count = others.length + earlier.length;
  return (
    <Popover>
      <PopoverTrigger
        nativeButton
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative shrink-0 text-muted-foreground"
            title={SHARED_CONVERSATION_TEXT.title}
            data-others={count}
          />
        }
      >
        <UsersIcon aria-hidden="true" />
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-0 right-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-2xs leading-none text-primary-foreground"
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>{SHARED_CONVERSATION_TEXT.title}</PopoverTitle>
          <PopoverDescription>{SHARED_CONVERSATION_TEXT.history}</PopoverDescription>
        </PopoverHeader>
        <p className="text-sm text-muted-foreground">{SHARED_CONVERSATION_TEXT.reach}</p>
        {others.length > 0 ? (
          <p className="text-sm break-words" data-shared-here>
            Here now: {others.map(labelOf).join(", ")}
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
