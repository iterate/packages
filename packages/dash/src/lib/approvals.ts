// The Approvals page's fold of a secret's log (core/secrets src/secret/contract.ts facts): the
// requests that wait, the decisions and the rule. An event whose payload does not parse is left out.
import { z } from "zod";

/** A day, as the vault keeps a request waiting. */
export const WAIT_MS = 24 * 60 * 60 * 1000;

export type LogEvent = { type: string; payload?: unknown; createdAt: string };

type ApprovalRule = { methods: string[]; hosts: string[] };

export type HeldRequest = {
  secret: string;
  digest: string;
  method: string;
  url: string;
  bodyStart: string;
  /** Where the kernel said the request came from: a claim, not a proof. */
  from?: string;
  requestedAt: string;
};

export type Decision = HeldRequest & {
  decision: "approved" | "rejected";
  /** The signer's email, else their actor id. */
  signer: string;
  keyLabel: string;
  reason?: string;
  decidedAt: string;
  /** The upstream's status when the request went out after the approval. */
  sent?: { status: number; at: string };
};

const PREFIX = "events.iterate.com/secret/";

const Requested = z.object({
  digest: z.string(),
  method: z.string(),
  url: z.string(),
  bodyStart: z.string(),
  from: z.string().optional(),
});
const Signer = z.object({
  principal: z.object({ actor: z.string(), email: z.string().optional() }),
  label: z.string(),
});
const Approved = z.object({ digests: z.array(z.string()), signer: Signer });
const Rejected = Approved.extend({ reason: z.string() });
const Used = z.object({ status: z.number(), digest: z.string().optional() });
const RuleConfigured = z.object({
  rule: z.object({ methods: z.array(z.string()), hosts: z.array(z.string()) }).nullable(),
});

type Entry = HeldRequest & {
  decision?: Omit<Decision, keyof HeldRequest | "sent">;
  sent?: Decision["sent"];
};

type SecretApprovals = {
  /** Requests that wait now, newest first. */
  waiting: HeldRequest[];
  /** Approved requests not sent yet, newest decision first. */
  approved: Decision[];
  decided: Decision[];
  rule: ApprovalRule | null;
};

/** A request waits when no approval, rejection or use of it followed, and it is less than a day
 *  old. */
export function approvalsOf(secret: string, events: LogEvent[], now: number): SecretApprovals {
  const entries = new Map<string, Entry>();
  /** Requests whose digest was asked again after it was sent: a new request with the same id. */
  const earlier: Entry[] = [];
  let rule: ApprovalRule | null = null;
  const decide = (
    { digests, signer }: z.infer<typeof Approved>,
    decision: Decision["decision"],
    decidedAt: string,
    reason?: string,
  ) => {
    for (const digest of digests) {
      const entry = entries.get(digest);
      if (!entry || entry.decision || entry.sent) continue;
      entry.decision = {
        decision,
        signer: signer.principal.email || signer.principal.actor,
        keyLabel: signer.label,
        decidedAt,
        reason,
      };
    }
  };

  for (const event of events) {
    if (!event.type.startsWith(PREFIX)) continue;
    const at = event.createdAt;
    switch (event.type.slice(PREFIX.length)) {
      case "approval-requested": {
        const parsed = Requested.safeParse(event.payload);
        if (!parsed.success) break;
        const known = entries.get(parsed.data.digest);
        // the same bytes asked again before they were sent are the same request
        if (known && !known.sent) break;
        if (known) earlier.push(known);
        entries.set(parsed.data.digest, { secret, ...parsed.data, requestedAt: at });
        break;
      }
      case "request-approved": {
        const parsed = Approved.safeParse(event.payload);
        if (parsed.success) decide(parsed.data, "approved", at);
        break;
      }
      case "request-rejected": {
        const parsed = Rejected.safeParse(event.payload);
        if (parsed.success) decide(parsed.data, "rejected", at, parsed.data.reason);
        break;
      }
      case "used": {
        const parsed = Used.safeParse(event.payload);
        const entry = parsed.data?.digest ? entries.get(parsed.data.digest) : undefined;
        if (parsed.success && entry && !entry.sent) entry.sent = { status: parsed.data.status, at };
        break;
      }
      case "approval-rule-configured": {
        const parsed = RuleConfigured.safeParse(event.payload);
        if (parsed.success) rule = parsed.data.rule;
        break;
      }
    }
  }

  const waiting: HeldRequest[] = [];
  const decided: Decision[] = [];
  for (const { decision, sent, ...request } of [...earlier, ...entries.values()]) {
    if (decision) decided.push({ ...request, ...decision, sent });
    else if (!sent && now - Date.parse(request.requestedAt) < WAIT_MS) waiting.push(request);
  }
  decided.sort(newestDecisionFirst);
  return {
    waiting: waiting.sort(newestRequestFirst),
    approved: decided.filter((decision) => decision.decision === "approved" && !decision.sent),
    decided,
    rule,
  };
}

export function projectApprovalsOf(logs: { secret: string; events: LogEvent[] }[], now: number) {
  const folded = logs.map((log) => approvalsOf(log.secret, log.events, now));
  return {
    waiting: folded.flatMap((secret) => secret.waiting).sort(newestRequestFirst),
    approved: folded.flatMap((secret) => secret.approved).sort(newestDecisionFirst),
    decided: folded.flatMap((secret) => secret.decided).sort(newestDecisionFirst),
    rules: logs.flatMap((log, index) => {
      const rule = folded[index]?.rule;
      return rule ? [{ secret: log.secret, rule }] : [];
    }),
  };
}

const newestRequestFirst = (a: HeldRequest, b: HeldRequest) =>
  Date.parse(b.requestedAt) - Date.parse(a.requestedAt);
const newestDecisionFirst = (a: Decision, b: Decision) =>
  Date.parse(b.decidedAt) - Date.parse(a.decidedAt);
