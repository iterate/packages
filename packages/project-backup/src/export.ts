// export.ts — WHAT A BACKUP READS from a project, part by part, through the project root's own itx:
// every read is one the project's code may make, and nothing needs an operator or a deployment key.
// Secrets come as their catalog (paths, pins, strategy kinds) and, beside each entry, the sealed cell
// its facet folded from the secret's own log (`SealedSecretCell`, core/lib/src/api.ts, read as
// `itx.cd(path).facets.get("secret").snapshot()`); restore.ts opens one with the key. A value is
// never read.
import type { IterateContextApi } from "iterate/api";
import { z } from "zod";
import {
  ARCHIVE_BUDGET_BYTES,
  BackupPart,
  isEntryPath,
  SealedSecret,
  writeBackup,
  type ProjectBackup,
} from "./archive.ts";

/** The project's backup, in memory (`writeBackup` zips it): the parts asked for (every part by
 *  default). Files go in until `budgetBytes` of them are in; each one after that, and every earlier
 *  backup in `BACKUPS_FOLDER`, is named in the manifest's `skipped`. `sealSecret(path)` answers a
 *  secret's sealed cell. */
export async function exportProject(
  itx: Pick<
    IterateContextApi,
    "whoami" | "kv" | "files" | "repos" | "secrets" | "fetchRoutes" | "schedules" | "facets" | "cd"
  >,
  options: {
    parts?: BackupPart[];
    budgetBytes?: number;
    /** Where a secret's sealed cell comes from; its facet's snapshot on the secret's path by
     *  default. */
    sealSecret?: (path: string) => Promise<unknown>;
  } = {},
): Promise<ProjectBackup> {
  const parts = options.parts || BackupPart.options;
  const { projectId, projectSlug } = await itx.whoami();
  const skipped: ProjectBackup["manifest"]["skipped"] = [];
  const backup: ProjectBackup = {
    manifest: {
      format: "iterate-project-backup",
      version: 1,
      capturedAt: new Date().toISOString(),
      source: { projectId, projectSlug },
      parts,
      skipped,
    },
  };

  if (parts.includes("kv")) {
    const { keys } = await itx.kv.list();
    const entries = await inBatches(keys, async (key) => ({ key, value: await itx.kv.get(key) }));
    // a key deleted between the list and its read is not in the backup; an empty value is a value
    // oxlint-disable-next-line iterate/simple-truthiness-check -- kv answers null for no key, and "" is a stored value
    backup.kv = entries.flatMap(({ key, value }) => (value === null ? [] : [{ key, value }]));
  }

  if (parts.includes("files")) {
    let budget = options.budgetBytes ?? ARCHIVE_BUDGET_BYTES;
    backup.files = [];
    for (const { path, size } of await itx.files.list()) {
      if (path.startsWith(BACKUPS_FOLDER)) {
        skipped.push({ part: "files", path, reason: "an earlier backup" });
        continue;
      }
      if (!isEntryPath(path.slice(1))) {
        skipped.push({ part: "files", path, reason: "no zip entry can name this path" });
        continue;
      }
      if (size > RPC_VALUE_MAX_BYTES) {
        skipped.push({
          part: "files",
          path,
          reason: `${size} bytes, over the ${RPC_VALUE_MAX_BYTES} bytes one call reads; download it from its signed URL`,
        });
        continue;
      }
      if (size > budget) {
        skipped.push({
          part: "files",
          path,
          reason: `${size} bytes, over the ${budget} bytes left of the archive's budget`,
        });
        continue;
      }
      // the content type from the file's own head: `files.list` answers the platform's default for
      // every file, since R2's list carries no http metadata; a file gone since the list is left out
      const file = itx.files.get(path);
      const head = await file.head();
      if (!head) continue;
      budget -= size;
      backup.files.push({ path, contentType: head.contentType, data: await file.bytes() });
    }
  }

  if (parts.includes("config")) {
    // One call for the whole tree: the repo API answers each file as UTF-8 text, so a binary file
    // comes back altered (a git bundle from the platform would carry it exactly).
    const repo = itx.repos.get("/repos/config");
    const commitOid = await repo.tip();
    backup.config = {
      repo: "/repos/config",
      commitOid,
      origin: await repo.origin(),
      files: commitOid ? await repo.modules({ commitOid }) : {},
    };
  }

  if (parts.includes("secrets")) {
    backup.secrets = [];
    const sealSecret = options.sealSecret || ((path: string) => sealedCellOnLog(itx, path));
    for (const { path, urls, refresh, createdAt, borrowed } of await itx.secrets.list()) {
      // a borrowed secret's material is its lender's, never the project's to back up
      const sealed = borrowed ? undefined : await sealedCellOf(path, sealSecret, skipped);
      backup.secrets.push({ path, urls, refresh, createdAt, borrowed, sealed });
    }
  }

  if (parts.some((part) => ["routes", "schedules", "integrations", "hostnames"].includes(part))) {
    const records: NonNullable<ProjectBackup["records"]> = {};
    if (parts.includes("routes"))
      records.routes = (await itx.fetchRoutes.list()).map(
        ({ configuredOffset: _configuredOffset, ...route }) => route,
      );
    if (parts.includes("schedules")) records.schedules = await itx.schedules.list();
    if (parts.includes("integrations") || parts.includes("hostnames")) {
      const { state } = ProjectRecords.parse(
        await itx.facets.get<{ snapshot(): Promise<unknown> }>("project").snapshot(),
      );
      if (parts.includes("integrations")) records.integrations = Object.values(state.integrations);
      // what the project serves: claimed, provisioned and not on its way out (core/os
      // scripts/project-seed-format.ts `captureHostnames` keeps the same ones)
      if (parts.includes("hostnames"))
        records.hostnames = Object.entries(state.hostnames)
          .filter(
            ([, entry]) => entry.claimed && entry.cloudflare && entry.requested?.verb !== "remove",
          )
          .map(([hostname]) => ({ hostname, primary: hostname === state.primaryHostname }));
    }
    backup.records = records;
  }
  return backup;
}

/** The current cell of the secret at `path`, as its facet folded it from the facts on that path
 *  (`state.material.sealed`): the facet is the secret's own reduce, and `snapshot` is public to the
 *  owner. Throws for a secret with no cell: never set, deleted, borrowed, or on a platform from
 *  before the facts carried cells. */
async function sealedCellOnLog(itx: Pick<IterateContextApi, "cd">, path: string) {
  const { state } = await itx
    .cd(path)
    .facets.get<{ snapshot(): Promise<{ state: { material: { sealed?: unknown } | null } }> }>(
      "secret",
    )
    .snapshot();
  if (!state.material?.sealed) throw new Error(`secret ${path}: no sealed cell on its log`);
  return state.material.sealed;
}

/** The secret's sealed cell from `sealSecret`, or none, named in `skipped` with why: a secret with
 *  no cell on its log (never set, deleted, borrowed, or a platform from before the facts carried
 *  cells). The entry stays, so restore asks a person for the value instead. */
async function sealedCellOf(
  path: string,
  sealSecret: (path: string) => Promise<unknown>,
  skipped: ProjectBackup["manifest"]["skipped"],
): Promise<SealedSecret | undefined> {
  try {
    return SealedSecret.parse(await sealSecret(path));
  } catch (error) {
    skipped.push({
      part: "secrets",
      path,
      reason: `no sealed cell, so its value is entered again on restore: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

/** Where `backupToFiles` keeps the backups it makes, in the project's own files. Export leaves this
 *  folder out, so a backup never holds the ones before it. */
export const BACKUPS_FOLDER = "/backups/";

/** The most one call carries: `bytes()` answers a file, and `files.put` takes one, as one Workers
 *  RPC value, which is at most 32 MiB (https://developers.cloudflare.com/workers/platform/limits/).
 *  A MiB is left for the value's own framing. A file over it is named in `skipped`, since no call
 *  of the project's can read it; a kept backup over it is refused. */
export const RPC_VALUE_MAX_BYTES = 31 * 1024 * 1024;
/** The biggest backup kept in the project's files: one `files.put`. */
const KEPT_BACKUP_MAX_BYTES = RPC_VALUE_MAX_BYTES;
/** The file bytes a kept backup holds: below `KEPT_BACKUP_MAX_BYTES`, with room for the other
 *  parts. The rest are named in `skipped`; the page's download holds up to `ARCHIVE_BUDGET_BYTES`. */
const KEPT_BACKUP_BUDGET_BYTES = 24 * 1024 * 1024;

/** `itx.config.backup()`'s work: a backup of the project, zipped and kept in its own files at
 *  `/backups/<time>.zip`. Answers where it is, its size and what it holds. Throws, and keeps
 *  nothing, when the zip is over `maxBytes`. */
export async function backupToFiles(
  itx: Parameters<typeof exportProject>[0],
  options: { parts?: BackupPart[]; budgetBytes?: number; maxBytes?: number } = {},
) {
  const backup = await exportProject(itx, {
    parts: options.parts,
    budgetBytes: options.budgetBytes ?? KEPT_BACKUP_BUDGET_BYTES,
  });
  const zip = writeBackup(backup);
  const maxBytes = options.maxBytes ?? KEPT_BACKUP_MAX_BYTES;
  if (zip.length > maxBytes)
    throw new Error(
      `This backup is ${zip.length} bytes, over the ${maxBytes} bytes one kept backup can be. Back up fewer parts, or download one from the backup page.`,
    );
  const path = `${BACKUPS_FOLDER}${backup.manifest.capturedAt.replaceAll(":", "-")}.zip`;
  await itx.files.get(path).put({ contentType: "application/zip", data: zip });
  return {
    path,
    size: zip.length,
    parts: backup.manifest.parts,
    skipped: backup.manifest.skipped,
  };
}

/** The `project` facet's fields a backup records (core/os src/project/contract.ts): each
 *  connection's row, kept whole, and each custom hostname's state. */
const ProjectRecords = z.object({
  state: z.object({
    integrations: z.record(
      z.string(),
      z.looseObject({ provider: z.string(), connection: z.string(), account: z.string() }),
    ),
    hostnames: z.record(
      z.string(),
      z.object({
        requested: z.object({ verb: z.enum(["add", "remove"]) }).nullable(),
        cloudflare: z.object({ status: z.string() }).nullable(),
        claimed: z.boolean(),
      }),
    ),
    primaryHostname: z.string().nullable(),
  }),
});

/** `call` on each item, at most 32 at a time: a project's kv can hold thousands of keys, and each
 *  read is one call to the platform. */
export async function inBatches<Item, Result>(
  items: readonly Item[],
  call: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (let start = 0; start < items.length; start += 32)
    results.push(...(await Promise.all(items.slice(start, start + 32).map(call))));
  return results;
}
