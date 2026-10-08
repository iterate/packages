// restore.ts — PUT A BACKUP BACK through a project root's itx, the parts asked for, in BackupPart's
// order. A sealed secret opens with the key of the deployment the backup was taken on
// (`sourceKeys`, the one the page's restore hands the worker) and is set as it was; without the key,
// or without a cell, a person is asked for the value through a collect link. It adds and overwrites; it never empties kv or files first. The config repo is the one
// part restored whole: its commit is the backup's tree, so it deletes files the backup lacks, and
// it republishes the project's worker (which may not mount this package's page any more). The
// records (routes, schedules, integrations, hostnames) are reported with what to do by hand.
import type { IterateContextApi, SecretMaterial } from "iterate/api";
import { BackupPart, type ProjectBackup } from "./archive.ts";
import { inBatches } from "./export.ts";
import { openSealedSecret } from "./sealed-secret.ts";

/** A restore refused before it wrote anything: a sealed secret the key given does not open. */
export class RestoreRefused extends Error {}

export type RestoreReport = {
  part: BackupPart;
  restored: number;
  notes: string[];
  /** The `collectFromUser` links a person opens to enter a secret's value again. */
  links?: { path: string; url: string }[];
}[];

/** Restore `parts` of `backup` onto the project whose root `itx` is. With `sourceKeys`, the secrets
 *  key of the deployment the backup was taken on, each sealed secret opens and is set as it was;
 *  every cell is opened before anything is written, so a wrong key restores nothing. Without it,
 *  each secret answers a link that asks a person for its value again. */
export async function restoreProject(
  itx: Pick<IterateContextApi, "kv" | "files" | "repos" | "secrets">,
  backup: ProjectBackup,
  options: { parts: BackupPart[]; sourceKeys?: { current: string; previous?: string } },
): Promise<RestoreReport> {
  // each value in a box: a value may be the empty string, and the box is what a secret has or not
  const opened = new Map<string, { material: SecretMaterial }>();
  if (options.parts.includes("secrets") && options.sourceKeys)
    for (const { path, sealed } of backup.secrets || []) {
      if (!sealed) continue;
      try {
        opened.set(path, { material: await openSealedSecret(sealed, options.sourceKeys) });
      } catch {
        throw new RestoreRefused(
          `${path} does not open with the key given: it is not the secrets key of the deployment the backup was taken on, or the cell was changed. Nothing was restored.`,
        );
      }
    }

  const report: RestoreReport = [];
  for (const part of BackupPart.options.filter((each) => options.parts.includes(each))) {
    if (!backup.manifest.parts.includes(part)) {
      report.push({ part, restored: 0, notes: ["Not in this backup."] });
      continue;
    }
    switch (part) {
      case "secrets": {
        const connections = new Set(
          (backup.records?.integrations || []).map(
            ({ provider, connection }) => `/secrets/${provider}-${connection}`,
          ),
        );
        const notes: string[] = [];
        const links: { path: string; url: string }[] = [];
        for (const { path, urls, sealed, borrowed } of backup.secrets || []) {
          const box = opened.get(path);
          if (box && sealed) {
            await itx.secrets.set(path, box.material, {
              urls: sealed.urls,
              refresh: sealed.refresh || undefined,
            });
          } else if (borrowed) notes.push(`${path} was borrowed: lend or connect it again.`);
          else if (connections.has(path))
            notes.push(`${path} is an integration connection's: reconnect it (integrations).`);
          else
            links.push(
              await itx.secrets.collectFromUser({
                path,
                egress: { urls },
                description: `Restoring a backup of ${backup.manifest.capturedAt}: this secret's value was not in it. Enter it again.`,
              }),
            );
        }
        report.push({ part, restored: opened.size, notes, links });
        break;
      }
      case "kv": {
        const kv = backup.kv || [];
        await inBatches(kv, ({ key, value }) => itx.kv.put(key, value));
        report.push({ part, restored: kv.length, notes: [] });
        break;
      }
      case "files": {
        const files = backup.files || [];
        for (const { path, contentType, data } of files)
          await itx.files.get(path).put({ contentType, data });
        const skipped = backup.manifest.skipped.filter((entry) => entry.part === "files");
        report.push({
          part,
          restored: files.length,
          notes: skipped.map(({ path, reason }) => `${path} was not in the backup: ${reason}.`),
        });
        break;
      }
      case "config": {
        report.push({ part, ...(await restoreConfig(itx, backup)) });
        break;
      }
      case "integrations": {
        report.push({
          part,
          restored: 0,
          notes: (backup.records?.integrations || []).map(
            ({ provider, account, connection }) =>
              `Reconnect ${provider} (${account}) as the connection ${connection}: the Dash's Integrations page, or itx.integrations.connect("${provider}", { connection: "${connection}" }).`,
          ),
        });
        break;
      }
      default: {
        const rows = backup.records?.[part] || [];
        report.push({
          part,
          restored: 0,
          notes: [`${rows.length} recorded in ${part}.json; this version does not restore them.`],
        });
      }
    }
  }
  return report;
}

/** One commit that makes the repo's tree the backup's, on the tip read just before it (`parent`):
 *  a commit that lands in between refuses it, and nothing is overwritten unseen. */
async function restoreConfig(
  itx: Pick<IterateContextApi, "repos">,
  backup: ProjectBackup,
): Promise<{ restored: number; notes: string[] }> {
  if (!backup.config || Object.keys(backup.config.files).length === 0)
    return { restored: 0, notes: ["The backup's config repo was empty: nothing was committed."] };
  const { repo: path, commitOid, origin, files } = backup.config;
  const repo = itx.repos.get(path);
  const current = await repo.listFiles();
  const { changedPaths } = await repo.commitFiles({
    message: `Restore ${path} from the backup of ${backup.manifest.capturedAt} (its commit ${commitOid})`,
    parent: current.commitOid,
    changes: [
      ...Object.entries(files).map(([file, content]) => ({ path: file, content })),
      ...current.paths
        .filter((file) => !Object.hasOwn(files, file))
        .map((file) => ({ path: file, delete: true as const })),
    ],
  });
  const notes = [];
  if (origin && origin !== (await repo.origin()))
    notes.push(`Its origin was ${origin}: set it again with repo.setOrigin, then pull or push.`);
  return { restored: changedPaths.length, notes };
}
