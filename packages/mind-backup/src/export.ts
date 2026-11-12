// export.ts — WHAT A BACKUP READS from a mind, part by part, through the mind root's own itx:
// every read is one the mind's code may make, and nothing needs an operator or a deployment key.
// Secrets come as their catalog (paths, pins, strategy kinds) and, where the platform gives one,
// the sealed cell beside each entry: a mind's own stack hands its stored cell out to its at-rest
// key (`secrets.exportSealed`), and the frozen platform's secret facet has one with no key
// (`SealedSecretCell`, core/lib/src/api.ts). restore.ts gives each back. A value is never read in
// clear.
import type { IterateContextApi } from "iterate/api";
import { z } from "zod";
import {
  ARCHIVE_BUDGET_BYTES,
  backupSourceOf,
  BackupPart,
  isEntryPath,
  SealedSecret,
  writeBackup,
  type MindBackup,
} from "./archive.ts";
import { proofUnder } from "./sealed-secret.ts";

/** The mind's backup, in memory (`writeBackup` zips it): the parts asked for (every part by
 *  default). Files go in until `budgetBytes` of them are in; each one after that, and every earlier
 *  backup in `BACKUPS_FOLDER`, is named in the manifest's `skipped`. `sealSecret(path)` answers a
 *  secret's sealed cell. */
export async function exportMind(
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
    /** The at-rest key of the mind's own stack: with it the stack's vault hands each stored cell
     *  out, and no facet is asked. */
    atRestKey?: string;
  } = {},
): Promise<MindBackup> {
  const parts = options.parts || BackupPart.options;
  const source = backupSourceOf(await itx.whoami());
  const skipped: MindBackup["manifest"]["skipped"] = [];
  const backup: MindBackup = {
    manifest: {
      format: "iterate-mind-backup",
      version: 1,
      capturedAt: new Date().toISOString(),
      source,
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
    const { atRestKey } = options;
    for (const { path, urls, refresh, createdAt, borrowed } of await itx.secrets.list()) {
      // a borrowed secret's material is its lender's, never the mind's to back up
      const own = !borrowed;
      const stored =
        own && atRestKey
          ? await cellOf(path, () => storedCellOf(itx, path, atRestKey), skipped)
          : undefined;
      const sealed =
        own && !atRestKey
          ? await cellOf(path, async () => SealedSecret.parse(await sealSecret(path)), skipped)
          : undefined;
      backup.secrets.push({ path, urls, refresh, createdAt, borrowed, sealed, stored });
    }
  }

  if (parts.some((part) => ["routes", "schedules", "integrations", "hostnames"].includes(part))) {
    const records: NonNullable<MindBackup["records"]> = {};
    if (parts.includes("routes"))
      records.routes = (await itx.fetchRoutes.list()).map(
        ({ configuredOffset: _configuredOffset, ...route }) => route,
      );
    if (parts.includes("schedules")) records.schedules = await itx.schedules.list();
    if (parts.includes("integrations") || parts.includes("hostnames")) {
      const { state } = MindRecords.parse(
        await itx.facets.get<{ snapshot(): Promise<unknown> }>("mind").snapshot(),
      );
      if (parts.includes("integrations")) records.integrations = Object.values(state.integrations);
      // what the mind serves: claimed, provisioned and not on its way out (core/os
      // scripts/mind-seed-format.ts `captureHostnames` keeps the same ones)
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
 *  owner. Throws for a secret with no cell: never set, deleted, borrowed, on a platform from
 *  before the facts carried cells, or on a mind's own stack, which has no such facet. */
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

/** The stored cell of the secret at `path`, as the vault of the mind's own stack hands it out to
 *  a proof of its at-rest key. The proof ends a minute from now. */
async function storedCellOf(
  itx: Pick<IterateContextApi, "secrets">,
  path: string,
  atRestKey: string,
): Promise<string> {
  const until = Date.now() + 60_000;
  const proof = await proofUnder(atRestKey, [path, "exportSealed", until]);
  return (await itx.secrets.exportSealed(path, proof, until)).sealed;
}

/** The secret's sealed cell from `read`, or none, named in `skipped` with why: a secret with no
 *  cell to give (never set, deleted, a platform from before the facts carried cells, a mind's own
 *  stack that was given no key or a wrong one). The entry stays, so restore asks a person for the
 *  value instead. */
async function cellOf<Cell>(
  path: string,
  read: () => Promise<Cell>,
  skipped: MindBackup["manifest"]["skipped"],
): Promise<Cell | undefined> {
  try {
    return await read();
  } catch (error) {
    skipped.push({
      part: "secrets",
      path,
      reason: `no sealed cell, so its value is entered again on restore: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

/** Where `backupToFiles` keeps the backups it makes, in the mind's own files. Export leaves this
 *  folder out, so a backup never holds the ones before it. */
export const BACKUPS_FOLDER = "/backups/";

/** The most one call carries: `bytes()` answers a file, and `files.put` takes one, as one Workers
 *  RPC value, which is at most 32 MiB (https://developers.cloudflare.com/workers/platform/limits/).
 *  A MiB is left for the value's own framing. A file over it is named in `skipped`, since no call
 *  of the mind's can read it; a kept backup over it is refused. */
export const RPC_VALUE_MAX_BYTES = 31 * 1024 * 1024;
/** The biggest backup kept in the mind's files: one `files.put`. */
const KEPT_BACKUP_MAX_BYTES = RPC_VALUE_MAX_BYTES;
/** The file bytes a kept backup holds: below `KEPT_BACKUP_MAX_BYTES`, with room for the other
 *  parts. The rest are named in `skipped`; the page's download holds up to `ARCHIVE_BUDGET_BYTES`. */
const KEPT_BACKUP_BUDGET_BYTES = 24 * 1024 * 1024;

/** `itx.config.backup()`'s work: a backup of the mind, zipped and kept in its own files at
 *  `/backups/<time>.zip`. Answers where it is, its size and what it holds. Throws, and keeps
 *  nothing, when the zip is over `maxBytes`. */
export async function backupToFiles(
  itx: Parameters<typeof exportMind>[0],
  options: { parts?: BackupPart[]; budgetBytes?: number; maxBytes?: number } = {},
) {
  const backup = await exportMind(itx, {
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

/** The `mind` facet's fields a backup records (core/os src/mind/contract.ts): each
 *  connection's row, kept whole, and each custom hostname's state. */
const MindRecords = z.object({
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

/** `call` on each item, at most 32 at a time: a mind's kv can hold thousands of keys, and each
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
