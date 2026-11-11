// held-acts.ts — THE MAILS AND CALLS THAT WAIT FOR A MEMBER'S YES, folded from the gate's facts on
// the mind's `/approvals` context (iterate/acts says what an act is; the vault's gate writes the
// facts). A request sent with a secret waits by its secret instead: ./approvals.ts folds those.
import type { LogEvent } from "./approvals.ts";

export type HeldAct = {
  /** The act's id: the SHA-256 of its exact text, which a member signs for. */
  digest: string;
  /** What kind of act: `email.send`, or the verb that was called. */
  act: string;
  /** One line that says what it would do, as the gate wrote it. */
  summary: string;
  /** Where the kernel said it came from: a claim, not a proof. */
  from?: string;
  heldAt: string;
};

/** A fact's payload, as its fields by name: whatever it holds, read field by field below. */
const fieldsOf = (event: LogEvent) =>
  new Map<string, unknown>(Object.entries(Object(event.payload)));
const textOf = (value: unknown) => (typeof value === "string" ? value : "");

/** The acts that still wait, newest first: held, and neither approved, rejected nor run out. */
export function heldActsOf(events: LogEvent[]): HeldAct[] {
  const waiting = new Map<string, HeldAct>();
  for (const event of events) {
    const fields = fieldsOf(event);
    if (event.type === "events.iterate.com/approval/act-held") {
      const digest = textOf(fields.get("digest"));
      if (!digest) continue;
      waiting.set(digest, {
        digest,
        act: textOf(fields.get("act")),
        summary: textOf(fields.get("summary")),
        from: textOf(fields.get("from")) || undefined,
        heldAt: event.createdAt,
      });
    } else if (
      event.type === "events.iterate.com/approval/act-approved" ||
      event.type === "events.iterate.com/approval/act-rejected"
    ) {
      // one signed statement can answer several acts
      const digests = fields.get("digests");
      for (const digest of Array.isArray(digests) ? digests : []) waiting.delete(textOf(digest));
    } else if (event.type === "events.iterate.com/approval/hold-expired")
      waiting.delete(textOf(fields.get("digest")));
  }
  return [...waiting.values()].sort((a, b) => Date.parse(b.heldAt) - Date.parse(a.heldAt));
}
