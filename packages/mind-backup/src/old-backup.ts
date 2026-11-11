// old-backup.ts — A BACKUP TAKEN ON THE OLD PLATFORM. Before 2026-11-11 a backup's manifest said
// `format: "iterate-project-backup"` and named its source `projectId` and `projectSlug`. Such zips
// exist and must restore onto a mind, so an old manifest is read here, and nowhere else, as
// today's. The rest of a backup has no such name in it. This file goes when no backup from the
// old platform is left to restore.

/** A manifest as its JSON says it; an old one with its format and its source's two names changed
 *  to today's. Anything else is returned as it came, for the schema to judge. It names nothing
 *  outside itself: the restore page runs its text in the browser (page.ts). */
export function manifestOfToday(manifest: unknown): unknown {
  if (typeof manifest !== "object" || !manifest) return manifest;
  const { format, source, ...rest } = manifest as {
    format?: unknown;
    source?: { projectId?: unknown; projectSlug?: unknown };
  };
  if (format !== "iterate-project-backup") return manifest;
  const { projectId, projectSlug, ...more } = source || {};
  const mindSlug = projectSlug === undefined ? {} : { mindSlug: projectSlug };
  return {
    ...rest,
    format: "iterate-mind-backup",
    source: { ...more, mindId: projectId, ...mindSlug },
  };
}
