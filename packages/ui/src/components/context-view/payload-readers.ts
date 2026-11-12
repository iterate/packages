// Readers of an event's payload, which is untyped JSON: the inspectors' rich bodies (the platform's
// in core-events.tsx, the agents' in agent-chat) and the view's own summaries read the same few
// shapes out of it.

export const str = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

/** A plain object (the payload's shape): the `toString` brand, so arrays and class instances are not. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

/** A plain object, else an empty one. */
export const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
