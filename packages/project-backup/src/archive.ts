// archive.ts — A PROJECT BACKUP IS ONE ZIP: `manifest.json` names the project, when the backup was
// taken, the parts it holds and what export left out, and each part is one entry or one folder
// beside it, named after the part (README.md has the layout). Every part's entries are `<part>.json`,
// `<part>.jsonl` or `<part>/…`, so the page cuts an archive down to the parts a person chose without
// knowing their layout (page.ts). The same code writes and reads an archive in a Worker, in Node and
// in a browser: fflate, the whole archive in memory, so it stays under `ARCHIVE_BUDGET_BYTES`.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { SecretRefresh } from "iterate/api";
import { z } from "zod";

/** What one archive may hold in file bytes, and the biggest archive a restore takes: a Worker has
 *  128 MB, and a restore holds the upload and its unzipped entries at once
 *  (https://developers.cloudflare.com/workers/platform/limits/#memory). */
export const ARCHIVE_BUDGET_BYTES = 48 * 1024 * 1024;

/** The parts, in the order restore applies them: secrets first, so the config the restore publishes
 *  finds them, and the config last, because its commit republishes the project's worker. The last
 *  four are records: kept as the platform answered them, and not restored yet. */
export const BackupPart = z.enum([
  "secrets",
  "kv",
  "files",
  "config",
  "routes",
  "schedules",
  "integrations",
  "hostnames",
]);
export type BackupPart = z.infer<typeof BackupPart>;

/** The archive's schema for a secret's sealed cell: `SealedSecretCell` in core/lib/src/api.ts, as
 *  the secret's facts carry it; sealed-secret.ts opens one. */
export const SealedSecret = z.object({
  context: z.string().min(1),
  nonce: z.string().min(1),
  urls: z.array(z.string()).min(1),
  /** The refresh strategy as the platform stored it; `secrets.set` checks it again on restore. */
  refresh: z.custom<SecretRefresh | null>(),
  routedAccount: z.object({ provider: z.literal("slack"), externalId: z.string() }).optional(),
  material: z.object({
    algorithm: z.literal("AES-256-GCM+SECRET-V1"),
    iv: z.string().min(1),
    ciphertext: z.string().min(1),
  }),
});
export type SealedSecret = z.infer<typeof SealedSecret>;

/** One secret as `secrets.list()` catalogs it (never a value), and its sealed cell when export was
 *  handed one. */
const ArchivedSecret = z.object({
  path: z.string().regex(/^\/secrets\/[a-zA-Z0-9._-]+$/),
  urls: z.array(z.string()),
  refresh: z.string().optional(),
  createdAt: z.string(),
  borrowed: z.looseObject({ lendId: z.string() }).optional(),
  sealed: SealedSecret.optional(),
});
type ArchivedSecret = z.infer<typeof ArchivedSecret>;

const BackupManifest = z.object({
  format: z.literal("iterate-project-backup"),
  version: z.literal(1),
  capturedAt: z.iso.datetime(),
  source: z.object({ projectId: z.string().min(1), projectSlug: z.string().optional() }),
  parts: z.array(BackupPart),
  /** What export left out, and why: a file over the budget, a path no zip entry can name. */
  skipped: z.array(z.object({ part: BackupPart, path: z.string(), reason: z.string() })),
});

/** The records, each as the platform answered it: kept whole, checked only for what restore's
 *  report names. */
const Records = z.object({
  routes: z.array(z.looseObject({ fetchRouteName: z.string() })).optional(),
  schedules: z.array(z.looseObject({ key: z.string() })).optional(),
  /** Each connection's row (core/os src/integrations/contract.ts `IntegrationConnectionRow`). */
  integrations: z
    .array(z.looseObject({ provider: z.string(), connection: z.string(), account: z.string() }))
    .optional(),
  /** Each custom hostname the project served, and whether it was the primary one. */
  hostnames: z.array(z.object({ hostname: z.string(), primary: z.boolean() })).optional(),
});

/** A backup in memory: the manifest and each part it names. */
export type ProjectBackup = {
  manifest: z.infer<typeof BackupManifest>;
  kv?: { key: string; value: string }[];
  files?: { path: string; contentType: string; data: Uint8Array }[];
  config?: {
    repo: string;
    commitOid: string | null;
    origin: string | null;
    files: Record<string, string>;
  };
  secrets?: ArchivedSecret[];
  records?: z.infer<typeof Records>;
};

/** Whether `path` names one entry inside a folder of the zip: no empty, `.` or `..` segment, and no
 *  backslash, so no entry lands outside its part when a tool unpacks the archive. */
export const isEntryPath = (path: string) =>
  !path.includes("\\") &&
  path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

const FilePath = z
  .string()
  .refine((path) => path.startsWith("/") && isEntryPath(path.slice(1)), "an unsafe file path");

export function writeBackup(backup: ProjectBackup): Uint8Array {
  const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);
  const entries: Zippable = { "manifest.json": json(backup.manifest) };
  if (backup.kv)
    entries["kv.jsonl"] = strToU8(backup.kv.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  if (backup.files) {
    entries["files/index.json"] = json(
      backup.files.map(({ path, contentType, data }) => ({ path, contentType, size: data.length })),
    );
    // stored, not deflated: most of a project's files (images, audio, archives) are compressed
    for (const file of backup.files) entries[`files/data${file.path}`] = [file.data, { level: 0 }];
  }
  if (backup.config) {
    const { files, ...repo } = backup.config;
    entries["config/repo.json"] = json(repo);
    for (const [path, content] of Object.entries(files))
      entries[`config/files/${path}`] = strToU8(content);
  }
  if (backup.secrets) entries["secrets.json"] = json(backup.secrets);
  for (const [part, rows] of Object.entries(backup.records || {}))
    entries[`${part}.json`] = json(rows);
  return zipSync(entries);
}

/** The backup in `zip`, every part the manifest names read and checked. Throws on an archive of
 *  another format or version, a part with no entry, and a path that would land outside its part. */
export function readBackup(zip: Uint8Array): ProjectBackup {
  const entries = unzipSync(zip);
  const bytes = (name: string) => {
    const entry = entries[name];
    if (!entry) throw new Error(`The backup has no ${name}`);
    return entry;
  };
  const json = (name: string) => JSON.parse(strFromU8(bytes(name)));
  const manifest = BackupManifest.parse(json("manifest.json"));
  const has = (part: BackupPart) => manifest.parts.includes(part);
  const backup: ProjectBackup = { manifest };
  if (has("kv"))
    backup.kv = strFromU8(bytes("kv.jsonl"))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => z.object({ key: z.string(), value: z.string() }).parse(JSON.parse(line)));
  if (has("files"))
    backup.files = z
      .array(z.object({ path: FilePath, contentType: z.string() }))
      .parse(json("files/index.json"))
      .map((file) => ({ ...file, data: bytes(`files/data${file.path}`) }));
  if (has("config")) {
    const prefix = "config/files/";
    backup.config = {
      ...z
        .object({
          repo: z.string().startsWith("/repos/"),
          commitOid: z.string().nullable(),
          origin: z.string().nullable(),
        })
        .parse(json("config/repo.json")),
      files: Object.fromEntries(
        Object.entries(entries)
          .filter(([name]) => name.startsWith(prefix) && !name.endsWith("/"))
          .map(([name, content]) => [
            z
              .string()
              .refine(isEntryPath, "an unsafe config path")
              .parse(name.slice(prefix.length)),
            strFromU8(content),
          ]),
      ),
    };
  }
  if (has("secrets")) backup.secrets = z.array(ArchivedSecret).parse(json("secrets.json"));
  const records = Object.fromEntries(
    Object.keys(Records.shape)
      .filter((part) => has(BackupPart.parse(part)))
      .map((part) => [part, json(`${part}.json`)]),
  );
  if (Object.keys(records).length > 0) backup.records = Records.parse(records);
  return backup;
}
