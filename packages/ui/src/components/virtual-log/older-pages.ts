/** Reading a log below what is loaded. */
export type OlderPages = { loadOlder(): void; loading: boolean; exhausted: boolean };

/** The whole log is loaded: nothing older to read. */
export const OLDER_EXHAUSTED: OlderPages = { loadOlder: () => {}, loading: false, exhausted: true };

/** How much of a log is held, from 0 to 1. Offsets stand in for bytes: the lowest held against
 *  `head`, the newest known. */
export function heldShare(events: readonly { offset: number }[], head = 0): number {
  const lowest = events[0]?.offset;
  if (lowest === undefined || head === 0) return 0;
  return Math.min(1, Math.max(0, 1 - lowest / head));
}
