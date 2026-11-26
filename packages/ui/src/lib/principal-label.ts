// principal-label.ts — HOW A PRINCIPAL IS SHOWN, in words and as a face, from the platform's stamp
// (`source.principal`, `source.onBehalfOf.principal`, a subscription row's `heldBy.principal`).
// The chat's lines, its queue, "interrupted by …", the typing words and the stack of who is
// here all read these, so one person reads the same everywhere.
//
// A `name` is the person's own claim (a guest typed it): it is text to show, never a key, and it
// decides nothing. A principal with an email is shown by the email, as a member always was, also
// when the stamp has a name.

/** A principal as a stamp names one. `kind` "guest": a person who typed a name and proved
 *  nothing; they have no email. */
export type ShownPrincipal = {
  actor: string;
  email?: string;
  name?: string;
  kind?: "mind" | "guest";
};

/** The long label, for a tooltip, a screen reader and a list of who is here: the email, else the
 *  name, else the actor id, and " (guest)" after it for a guest. */
export const labelOf = (principal: ShownPrincipal) =>
  guestMarked(principal, principal.email || principal.name || principal.actor);

/** The short label, for a line beside a face: the part of the email before the "@", else the
 *  name, else the actor id, and " (guest)" after it for a guest. */
export const shortLabelOf = (principal: ShownPrincipal) =>
  guestMarked(principal, principal.email?.split("@", 1)[0] || principal.name || principal.actor);

/** What a face is drawn from (`Face`'s `who`, `name` and `kind`): `who` gives its colour and must
 *  never change for one person, so it is the email, else the actor id; the initials come from the
 *  name of a person who has no email; a mind (`kind: "mind"`) is drawn as a rounded square. */
export const faceOf = (principal: ShownPrincipal) => ({
  who: principal.email || principal.actor,
  name: principal.email ? undefined : principal.name,
  ...(principal.kind === "mind" && { kind: "mind" as const }),
});

const guestMarked = (principal: ShownPrincipal, words: string) =>
  principal.kind === "guest" ? `${words} (guest)` : words;
