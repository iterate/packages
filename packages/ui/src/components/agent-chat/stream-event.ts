/**
 * Minimal committed stream event shape consumed by the events components.
 *
 * This is a plain structural type — the itx event envelope
 * (`{ type, payload?, metadata?, offset, createdAt }`) is a superset of it.
 * Validation happens at the transport layer, not in the view reducer.
 */
export type StreamEventSource = {
  processor?: {
    slug: string;
    version: string;
    /** The event the processor was handling when it appended this one (the processor engine,
     *  core/lib src/stream/processor.ts, stamps it): how a script request is tied back to the assistant item that wrote it. */
    whileProcessing?: { offset: number; type: string };
  };
  /** Who appended it, and the mind host whose page held their session, if one did. */
  principal?: { actor: string; email?: string };
  via?: { appPage: string };
  /** Who code wrote it for: a script's run, or a person's call into a facet (an agent's
   *  `message()`), which appends as the agent. */
  onBehalfOf?: {
    principal: { actor: string; email?: string };
    via?: { appPage: string };
    run?: string;
  };
};

/** Who sent a message, as the platform stamped its event: the person, and whether their script
 *  wrote it. */
export type MessageSender = { actor: string; email?: string; script: boolean };

/** The sender a message's event names. None when it names nobody: the mind's own code, mail,
 *  another agent. */
export function senderOf(source: StreamEventSource | undefined): MessageSender | undefined {
  const principal = source?.principal || source?.onBehalfOf?.principal;
  if (!principal) return undefined;
  const { actor, email } = principal;
  return {
    actor,
    email,
    script: !source?.principal && Boolean(source?.onBehalfOf?.run),
  };
}

/** A small label for a sender: the part of their address before the `@`, or their actor id when
 *  there is no address, and " (a script)" when their script wrote it. The page they came through
 *  is no part of it. */
export function saidByOf(sender: MessageSender): string {
  return `${sender.email?.split("@", 1)[0] || sender.actor}${sender.script ? " (a script)" : ""}`;
}

/** Whether the viewer `me` (their address or actor id) typed it: a message their script wrote is
 *  not one they typed. */
export function sentByMe(sender: MessageSender, me: string | undefined): boolean {
  if (!me || sender.script) return false;
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
};

/** The `agent/message-received` an event relays, if iterate's loop wrote it for one. */
export function relayedMessageOffset(event: Pick<StreamEvent, "source">): number | undefined {
  const from = event.source?.processor?.whileProcessing;
  return from?.type === "events.iterate.com/agent/message-received" ? from.offset : undefined;
}
