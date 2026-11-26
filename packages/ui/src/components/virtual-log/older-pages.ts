/** Reading a log below what is loaded. `failed`: the read failed, so nothing older is asked for
 *  and what is held is not known to be the whole log: a view with no rows then shows neither a
 *  loading state nor its words for an empty log, since the error is shown where errors are. */
export type OlderPages = {
  loadOlder(): void;
  loading: boolean;
  exhausted: boolean;
  failed?: boolean;
};

/** The whole log is loaded: nothing older to read. */
export const OLDER_EXHAUSTED: OlderPages = { loadOlder: () => {}, loading: false, exhausted: true };

/** The read failed: nothing older is asked for, and nothing is said of what the log holds. */
export const OLDER_FAILED: OlderPages = { ...OLDER_EXHAUSTED, failed: true };

/** Reading a log above what is loaded, toward the live head, when viewing a detached history window. */
export type NewerPages = {
  loadNewer(): void;
  loading: boolean;
  exhausted: boolean;
  failed?: boolean;
};

/** Attached to the newest end of the log: nothing newer to page. */
export const NEWER_EXHAUSTED: NewerPages = { loadNewer: () => {}, loading: false, exhausted: true };

/** How much of a log is held, from 0 to 1. Offsets stand in for bytes: the lowest held against
 *  `head`, the newest known. */
export function heldShare(events: readonly { offset: number }[], head = 0): number {
  const lowest = events[0]?.offset;
  if (lowest === undefined || head === 0) return 0;
  return Math.min(1, Math.max(0, 1 - lowest / head));
}
