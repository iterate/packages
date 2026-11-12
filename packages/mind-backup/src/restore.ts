// restore.ts — PUT A BACKUP BACK through a mind root's itx, the parts asked for, in BackupPart's
// order. A sealed secret opens with the key of the deployment the backup was taken on
// (`sourceKeys`, the one the page's restore hands the worker) and is set as it was; without the key,
// or without a cell, a person is asked for the value through a collect link. It adds and overwrites; it never empties kv or files first. The config repo is the one
// part restored whole: its commit is the backup's tree, so it deletes files the backup lacks, and
// it republishes the mind's worker (which may not mount this package's page any more). The
// records (routes, schedules, integrations, hostnames) are reported with what to do by hand.
import type { IterateContextApi, SecretMaterial } from "iterate/api";
import { BackupPart, type MindBackup } from "./archive.ts";
import { inBatches } from "./export.ts";
import { openSealedSecret, proofUnder } from "./sealed-secret.ts";

/** A restore refused before it wrote anything: a sealed secret the key given does not open. */
export class RestoreRefused extends Error {}

export type RestoreReport = {
  part: BackupPart;
  restored: number;
  notes: string[];
  /** The `collectFromUser` links a person opens to enter a secret's value again. `urls`: the
   *  hosts that the link pins its secret to, and `pinFrom`, whose word they are: the vault's,
   *  for a secret that it holds now, or the backup file's, which somebody may have changed. */
  links?: { path: string; url: string; urls: string[]; pinFrom: "the vault" | "the backup file" }[];
}[];

/** The words of the vault's refusal of a cell that it took before (`secrets.importSealed`,
 *  core/lib/src/api.ts): the one refusal that says more about the cell than "no". */
const TAKEN_BEFORE = "imported once already";

/** Restore `parts` of `backup` onto the mind whose root `itx` is. With `sourceKeys`, the secrets
 *  key of the deployment the backup was taken on, each sealed secret opens and is set as it was;
 *  every cell is opened before anything is written, so a wrong key restores nothing. A cell that
 *  a mind's own stack handed out (`stored`) is not opened here: it goes back to the stack's vault
 *  with a proof of that key, and a vault that refuses it stops the restore at that secret.
 *  Without a key, each secret answers a link that asks a person for its value again. */
export async function restoreMind(
  itx: Pick<IterateContextApi, "kv" | "files" | "repos" | "secrets">,
  backup: MindBackup,
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
        const links: NonNullable<RestoreReport[number]["links"]> = [];
        // the pin of each secret that the vault holds now, for the links below
        const held = new Map(
          (await itx.secrets.list()).map((secret) => [secret.path, secret.urls]),
        );
        let takenBack = 0;
        for (const { path, urls, sealed, stored, borrowed } of backup.secrets || []) {
          const box = opened.get(path);
          if (stored && options.sourceKeys) {
            // The vault of this stack opens its own cell: the key given only proves itself.
            const proof = await proofUnder(options.sourceKeys.current, [path, stored]);
            const taken = await itx.secrets.importSealed(path, stored, proof).then(
              () => true,
              (error: unknown) => {
                const said = error instanceof Error ? error.message : String(error);
                // A CELL THAT THE VAULT TOOK BEFORE IS THIS SECRET DONE, not a stop. The vault
                // takes a cell once, so a restore that stopped at a later secret would else stop
                // at its first secret on every later run, and that backup could never go in.
                if (said.includes(TAKEN_BEFORE)) return false;
                throw new RestoreRefused(
                  `${path} was not taken back by the vault: ${said}. The restore stopped at this secret: the secrets before it are restored, and the same backup can be restored again.`,
                );
              },
            );
            if (taken) takenBack += 1;
            else
              notes.push(
                `${path}: the vault took this cell before (an earlier run of this restore), and the secret is left as it is now.`,
              );
          } else if (box && sealed) {
            await itx.secrets.set(path, box.material, {
              urls: sealed.urls,
              refresh: sealed.refresh || undefined,
            });
          } else if (borrowed) notes.push(`${path} was borrowed: lend or connect it again.`);
          else if (connections.has(path))
            notes.push(`${path} is an integration connection's: reconnect it (integrations).`);
          else {
            // THE PIN OF A LINK IS THE VAULT'S WORD WHERE IT HAS ONE. A backup file that somebody
            // changed can drop a secret's cell and name a host of its own, and the person would
            // type the real value into a secret that is pinned there. A secret that the vault
            // holds now keeps its pin. For one that it does not hold, only the file says where
            // the value may go, and the report says so.
            const own = held.get(path);
            const link = await itx.secrets.collectFromUser({
              path,
              egress: { urls: own || urls },
              description: `Restoring a backup of ${backup.manifest.capturedAt}: this secret's value was not in it. Enter it again.`,
            });
            links.push({
              ...link,
              urls: own || urls,
              pinFrom: own ? "the vault" : "the backup file",
            });
          }
        }
        const fromTheFile = links.filter((link) => link.pinFrom === "the backup file").length;
        if (fromTheFile > 0)
          notes.push(
            `${fromTheFile} ${fromTheFile === 1 ? "link pins its secret" : "links pin their secrets"} to hosts that the BACKUP FILE names: read each link's urls before a value is entered there.`,
          );
        report.push({ part, restored: opened.size + takenBack, notes, links });
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
              `Reconnect ${provider} (${account}) as the connection ${connection}, on the Dash's Integrations page.`,
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
  backup: MindBackup,
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
