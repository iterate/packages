# @iterate-com/mind-backup

One mind's backup as one zip, and a page on the mind's own host that makes one and restores
one. Userspace: a mind installs it in its config worker, and the platform ships none of it. It
works with the mind's own itx only: no operator, no Cloudflare token, no deployment key.

This is a prototype.

## What a backup holds

| Part           | In the zip                                        | Restore                                                                                       |
| -------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `manifest`     | `manifest.json`: the mind, when, the parts        | Read first. A version this package does not know is refused.                                  |
| `secrets`      | `secrets.json`: paths, pins, and each sealed cell | With the deployment's key, each comes back as it was; else a link asks a person for its value |
| `kv`           | `kv.jsonl`: one `{ key, value }` per line         | Each key is put. Keys the backup lacks stay.                                                  |
| `files`        | `files/index.json`, `files/data/<path>`           | Each file is put. Files over 48 MB in all are named in the manifest only.                     |
| `config`       | `config/repo.json`, `config/files/<path>`         | One commit that makes the tree the backup's. It republishes the worker.                       |
| `routes`       | `routes.json`: the fetch routes                   | Recorded only                                                                                 |
| `schedules`    | `schedules.json`                                  | Recorded only                                                                                 |
| `integrations` | `integrations.json`: each connection's row        | Recorded; the report says how to reconnect each one                                           |
| `hostnames`    | `hostnames.json`: the custom hostnames served     | Recorded only                                                                                 |

`/backups/`, where the mind keeps its backups, is left out of `files`.

**Secrets.** A secret's value is never read in clear. A backup holds a secret's _sealed cell_
where the platform gives one: the material, encrypted under the deployment's secrets key and
bound to that secret.

- **A mind on its own stack** hands a cell out only to its at-rest key
  (`secrets.exportSealed`). Give that key on the backup page (or as the header `x-secrets-key` of
  `GET /export.zip`), and each secret's stored cell goes into `secrets.json` as `stored`.
  Without the key the backup has each secret's path and pin alone, names each secret in the
  manifest's `skipped`, and restore asks a person for each value. A backup that the mind keeps
  for itself ("Back up now") has no key, so it has no cells.
  **The key goes to the mind's own worker**, which is the mind's code. Once the key was typed,
  that code has had the vault's key: code that kept it can ask the vault for every cell and
  open each one, past every pin and rule, until the key is changed. The code that counts is
  whatever is in the config repo at that moment, this page included. Type the key only into a
  page whose code you trust, as for a restore. The page empties each key field after its one
  use.
- **The frozen platform's** facts carry the cell, and its secret facet's `snapshot()` on the
  secret's path answers the current one: it goes in as `sealed`, with no key.

**Restoring a stack's cell.** The restore page asks for the key, and the worker hands each
`stored` cell back to the stack's own vault (`secrets.importSealed`) with a proof of that key.
The vault opens it, so the secret comes back as it was: its pin, its strategy, what it may be
used for and its public fields. Three things to know:

- It works on the stack that made the backup, or on one that kept the same at-rest key. A
  stack with another key refuses the proof, and the restore stops at that secret.
- **An older cell is taken over a newer value**, once: that is what a restore is for. So **a
  secret that was deleted since the backup comes back**, and one that was changed goes back to
  its old value. A cell of a grant whose refresh token works once (GitHub, X) holds a token that
  is spent by then, so that grant must be connected again.
- **The vault takes each cell once.** A restore that stopped at one secret can be run again
  with the same backup: a cell that the vault took before is that secret done, named in a note,
  and the rest go in. A cell that was taken can not be restored a second time from that backup.

**A link's pin.** A secret with no cell in the backup gets a link that asks a person for its
value. A backup file is not trusted: somebody may have changed it, dropped a cell and named a
host of their own. So a secret that the vault holds now keeps the vault's own pin, and only a
secret that the vault does not hold takes the hosts that the file names. The report gives each
link's `urls` and says whose word they are (`pinFrom`): read them before a value is entered.
On a fresh stack the vault holds nothing, so every link's pin is the file's, and the report's
note counts them all: that is the restore where the hosts must be read.

**Restoring a cell of the frozen platform.** A cell opens only with its deployment's key. The
restore page asks for the key when a backup has sealed cells and sends it with the restore, once, to the mind's own host: the worker opens every cell before it
writes anything (a wrong key restores nothing), sets each secret as it was, and the platform seals
it again under its own key. So a backup moves secrets between minds, and between deployments
whose keys you hold. Without the key, each secret gets a collect link that asks a person for its
value. The key is the deployment's: type it only into a page whose code you trust.

## Install

1. In the config repo's `package.json`, under `dependencies`, a build of the package. No build is
   published: `.github/workflows/pkg-pr-new.yml`, which lists what pkg.pr.new and npm publish,
   does not name `packages/mind-backup`.

2. In `worker.ts`, the import, one element of the `integrations` array (iterate/sdk
   `Integration`: the worker hands it the requests on its routing slug and every event), and a
   `backup()` method for `itx.config.backup()`:

   ```ts
   import { backupToFiles, mindBackup } from "@iterate-com/mind-backup";

   const integrations: Integration[] = [mindBackup()];

   export default class extends IterateConfigEntrypoint {
     /** `itx.config.backup()`: a backup kept in the mind's files, at /backups/<time>.zip. */
     async backup() {
       using itx = this.getItx();
       return await backupToFiles(itx);
     }
     // … processEvent and fetch as core/configs/default has them: they dispatch to `integrations`
   }
   ```

3. Commit. The page is at the mind's `backup` routing slug, for members only:
   `await itx.url({ routingSlug: "backup" })` (`backup--<mind>.<base>`, or
   `backup.<primary hostname>`); `mindBackup({ slug })` takes another slug. The install hook lists
   it on the Dash's Integrations page, with an Open button.

## Use

- **The page**: tick parts and **Download the backup**; **Back up now** keeps one in the mind's
  files and lists it; **Restore** opens a zip (one chosen from disk, or a kept one) in the browser,
  lists what is in it, takes the deployment's secrets key when the zip has sealed secrets, and
  restores the parts ticked. The report says what each part did, gives a link for each secret it
  could not open, and says how to reconnect each connection.
- **From code**: `await itx.config.backup()` answers `{ path, size, parts, skipped }` (a kept
  backup holds up to 24 MiB of files, and one over 31 MiB is refused: the platform takes one file
  in one call of at most 32 MiB), then
  `(await itx.files.get(path).url()).url` downloads it. The functions are the package's exports:

  ```ts
  import { exportMind, readBackup, restoreMind, writeBackup } from "@iterate-com/mind-backup";

  const zip = writeBackup(await exportMind(itx, { parts: ["kv", "config"] }));
  await restoreMind(itx, readBackup(zip), { parts: ["kv"] });
  ```

| File                   | What                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `src/archive.ts`       | The zip: its layout, `writeBackup` and `readBackup`                       |
| `src/export.ts`        | `exportMind`, what a backup reads; `backupToFiles`, a backup kept         |
| `src/restore.ts`       | `restoreMind`: what each part writes back, or reports                     |
| `src/sealed-secret.ts` | `openSealedSecret`: a sealed secret opened with its deployment's key      |
| `src/integration.ts`   | `mindBackup`: the integration, its fetch (members only) and its hook      |
| `src/page.ts`          | The page: export, the backups kept, and the restore wizard in the browser |
