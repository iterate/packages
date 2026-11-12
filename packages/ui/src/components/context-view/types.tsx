// The context view's vocabulary: a committed event as the view reads it (structural — the itx
// envelope is a superset), the inspector bodies an app plugs in per event type, and the rows the
// panels show. Pure types: this directory renders data the SDK's hooks (`iterate/react`) hand it.
import type { ReactNode } from "react";

export type ContextViewEvent = {
  offset: number;
  type: string;
  createdAt: string;
  payload?: unknown;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  /** Where it came from, as the platform stamped it (core/itx/src/caller.ts `stampCaller`). */
  source?: {
    /** The context whose code or session wrote it. */
    origin?: string;
    principal?: { actor: string; email?: string };
    grant?: string;
    processor?: { slug: string; version: string };
    /** The platform wrote this fact on the principal's behalf (core/itx/src/caller.ts `Caller.platform`). */
    platform?: true;
    /** Why it happened (core/itx/src/cause.ts): the chain it belongs to, `<ISO> with <origin>
     *  ~<nonce>`, how deep in it, and the event whose handling wrote it. */
    cause?: { chain: string; depth: number; parent?: string };
    /** A copy row's event: the event it copied, and the row that copied it (core/itx/src/caller.ts
     *  `copiedFrom`). */
    copiedFrom?: {
      path: string;
      offset: number;
      type: string;
      createdAt?: string;
      subscription?: string;
    };
  };
};

/** A rich body for one event in the inspector — the message as prose, the script as code, the
 *  model's answer — shown above the envelope and the raw JSON. Return null for the default. */
export type EventInspector = (event: ContextViewEvent) => ReactNode | null;

/** Inspectors by event type: an exact type, or a prefix ending in `*` — the most specific wins. */
export type EventInspectors = Record<string, EventInspector>;

/** The entry of a by-type registry for a type: the exact type, else the longest prefix pattern
 *  (`events.iterate.com/agent/*`) that matches. */
export function inspectorFor<T>(
  registry: Record<string, T> | undefined,
  type: string,
): T | undefined {
  if (!registry) return undefined;
  if (registry[type]) return registry[type];
  let best: { prefix: string; entry: T } | undefined;
  for (const [pattern, entry] of Object.entries(registry)) {
    if (!pattern.endsWith("*")) continue;
    const prefix = pattern.slice(0, -1);
    if (type.startsWith(prefix) && (!best || prefix.length > best.prefix.length))
      best = { prefix, entry };
  }
  return best?.entry;
}

/** One row of the context's subscriptions table (`itx.subscriptions.list()`): a subscriber; one
 *  that hosts a facet is a processor. */
export type ContextViewProcessor = {
  name: string;
  target: string;
  consumes?: string[];
  configuredAtOffset: number;
  /** Where cursor delivery starts (absent = from `configuredAtOffset`). */
  afterOffset?: number;
  hostedFacet?: { name: string; className: string; cacheKey?: string; restarts: number };
  /** A row delivered at-least-once: the offset the last acked call confirmed, the retry attempt. */
  cursor?: { confirmedOffset: number; attempt: number; nextAttemptAtMs?: number };
  /** Delivery gave up after its retries. */
  halted?: { afterOffset: number; attempts: number; error?: string };
};

/** Who acted on the context, newest first, from the log's stamps. */
export type ContextViewPresence = {
  actor: string;
  email?: string;
  grant?: string;
  lastSeenAt: string;
};

/** One live state as the processors panel renders it (the SDK's `LiveStateResult`, structurally). */
export type LiveStateView = {
  status: string;
  value: unknown;
  /** The revision the value is at: `core`'s is the offset its snapshot reduced through. */
  rev?: number | null;
  error?: string;
};
