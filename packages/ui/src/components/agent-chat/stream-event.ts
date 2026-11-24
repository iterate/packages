import { shortLabelOf, type ShownPrincipal } from "#/lib/principal-label.ts";

/**
 * Minimal committed stream event shape consumed by the events components.
 *
 * This is a plain structural type — the itx event envelope
 * (`{ type, payload?, metadata?, offset, createdAt }`) is a superset of it.
 * Validation happens at the transport layer, not in the view reducer.
 */
export type StreamEventSource = {
  /** The context whose code wrote it: every commit carries it (core/lib stream/processor.ts). */
  origin?: string;
  processor?: { slug: string; version: string };
  /** Who appended it, and the mind host whose page held their session, if one did. */
  principal?: { actor: string; email?: string };
  via?: { appPage: string };
  /** Who code wrote it for: a script's run, or a person's call into a facet (an agent's
   *  `message()`), which appends as the agent. */
  onBehalfOf?: {
    /** A person who may be no member also has the `name` they gave, and `kind` "guest" when they
     *  proved nothing (core/lib principal.ts). */
    principal: { actor: string; email?: string; name?: string; kind?: "mind" | "guest" };
    via?: { appPage: string };
    run?: string;
  };
  /** Set when a schedule fired the event, a row copied it here, or the platform wrote it as its
   *  own fact: whoever else its source names did not say its words now. */
  schedule?: unknown;
  copiedFrom?: unknown;
  platform?: boolean;
  /** The key that signed it, when it is a signed statement: another mind's, with `kind: "mind"`
   *  and its domain as `actor`. */
  signer?: { principal: { actor: string; kind?: string } };
};

/** Who sent a message, as the platform stamped its event: the person, with the name a person who
 *  may be no member gave and whether they are a guest, and whether their script wrote it. */
export type MessageSender = ShownPrincipal & { script: boolean };

/** The sender a message's event names, by the platform's stamp, as the Dash's channel words it for
 *  the model (core/configs/default agent-ui.ts `senderWords`). None when it names nobody who said
 *  the words: the mind's own code, mail, another agent, a schedule's occurrence, a row's copy, a
 *  platform fact, a statement that no mind's key signed. Another mind is named by its domain. */
export function senderOf(source: StreamEventSource | undefined): MessageSender | undefined {
  if (source?.schedule || source?.copiedFrom || source?.platform) return undefined;
  if (source?.signer) {
    const { actor, kind } = source.signer.principal;
    return kind === "mind" ? { actor, script: false } : undefined;
  }
  const principal: ShownPrincipal | undefined = source?.principal || source?.onBehalfOf?.principal;
  if (!principal) return undefined;
  const { actor, email, name, kind } = principal;
  return {
    actor,
    email,
    name,
    kind,
    script: !source?.principal && Boolean(source?.onBehalfOf?.run),
  };
}

/** A small label for a sender: their short label (lib/principal-label.ts `shortLabelOf`), and
 *  " (a script)" when their script wrote it. The page they came through is no part of it. */
export function saidByOf(sender: MessageSender): string {
  return `${shortLabelOf(sender)}${sender.script ? " (a script)" : ""}`;
}

/** Whether the message is the viewer's own: `me` (their address or actor id) typed it, or a
 *  script wrote it on their behalf (a Slack relay, a computer's bridge). Their own words carry no
 *  line under them (Jonas, 16 and 17 Nov 2026). */
export function sentByMe(sender: MessageSender, me: string | undefined): boolean {
  if (!me) return false;
  return sender.actor === me || sender.email?.toLowerCase() === me.toLowerCase();
}

export type StreamEvent<Type extends string = string, Payload = unknown> = {
  type: Type;
  payload?: Payload;
  metadata?: Record<string, unknown>;
  source?: StreamEventSource;
  idempotencyKey?: string;
  offset: number;
  createdAt: string;
  /** The context the event is on: every committed event names it. */
  path?: string;
};
