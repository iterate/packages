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

/** The acts that still wait at `now`, newest first: held, not answered by a member, and not older
 *  than the gate keeps a held act (a day; it then drops the act with no fact). The gate's
 *  `hold-expired` fact is NOT an end: it says that the act's caller stopped waiting, after five
 *  minutes, and a member can still approve the act, which the mind then does. */
export function heldActsOf(events: LogEvent[], now: number): HeldAct[] {
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
    }
  }
  const day = 24 * 60 * 60_000;
  return [...waiting.values()]
    .filter((act) => Date.parse(act.heldAt) + day > now)
    .sort((a, b) => Date.parse(b.heldAt) - Date.parse(a.heldAt));
}

export type ProposedRule = {
  /** The proposal's id, as the gate gave it. */
  id: string;
  /** What the rule is for: a secret's path, for a rule on requests with that secret. */
  secret?: string;
  /** What the rule is for: `email.send` or a verb, for a rule on a mail or a call. */
  verb?: string;
  /** Where the kernel said it came from: a claim, not a proof. */
  from?: string;
  proposedAt: string;
};

/** THE PROPOSED RULES THAT WAIT FOR A MEMBER TO APPROVE OR REJECT THEM, newest first, from the
 *  same log. The mind's code or an agent proposes a rule, for a mail or a call or for a request
 *  with a secret, and the gate keeps it until a member signs it into a rule or rejects it
 *  (`rule-proposed`; its end is `rule-set` with the proposal's id, `rule-proposal-signed`, or
 *  `rule-proposal-rejected`). What the rule holds is not read here: the mind's own page says it,
 *  from what the gate kept, and a member approves there. */
export function proposedRulesOf(events: LogEvent[]): ProposedRule[] {
  const open = new Map<string, ProposedRule>();
  for (const event of events) {
    const fields = fieldsOf(event);
    if (event.type === "events.iterate.com/approval/rule-proposed") {
      const id = textOf(fields.get("id"));
      if (!id) continue;
      const rule = new Map<string, unknown>(Object.entries(Object(fields.get("rule"))));
      open.set(id, {
        id,
        secret: textOf(rule.get("secret")) || undefined,
        verb: textOf(rule.get("verb")) || undefined,
        from: textOf(fields.get("from")) || undefined,
        proposedAt: event.createdAt,
      });
    } else if (
      event.type === "events.iterate.com/approval/rule-proposal-signed" ||
      event.type === "events.iterate.com/approval/rule-proposal-rejected"
    )
      open.delete(textOf(fields.get("id")));
    else if (event.type === "events.iterate.com/approval/rule-set")
      open.delete(textOf(fields.get("proposal")));
  }
  return [...open.values()].sort((a, b) => Date.parse(b.proposedAt) - Date.parse(a.proposedAt));
}
