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
    /** The event the processor was handling when it appended this one (the core/os processor engine
     *  stamps it): how a script request is tied back to the assistant item that wrote it. */
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

/** Who said a message, as the platform stamped its event, for a small label: the person, " (a
 *  script)" when their script wrote it, and the page they came through. None when the event names
 *  nobody: the mind's own code, mail, another agent. */
export function saidByOf(source: StreamEventSource | undefined): string | undefined {
  const who = source?.principal ? { ...source, principal: source.principal } : source?.onBehalfOf;
  if (!who) return undefined;
  const script = "run" in who && who.run ? " (a script)" : "";
  const page = who.via ? ` via ${who.via.appPage}` : "";
  return `${who.principal.email || who.principal.actor}${script}${page}`;
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
