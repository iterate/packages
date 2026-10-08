# @iterate-com/project-backup

One project's backup as one zip, and a page on the project's own host that makes one and restores
one. Userspace: a project installs it in its config worker, and the platform ships none of it. It
works with the project's own itx only: no operator, no Cloudflare token, no deployment key.

This is a prototype.

## What a backup holds

| Part           | In the zip                                        | Restore                                                                                              |
| -------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `manifest`     | `manifest.json`: the project, when, the parts     | Read first. A version this package does not know is refused.                                         |
| `secrets`      | `secrets.json`: paths, pins, and each sealed cell | With the deployment's key, each is opened and set as it was; else a link asks a person for its value |
| `kv`           | `kv.jsonl`: one `{ key, value }` per line         | Each key is put. Keys the backup lacks stay.                                                         |
| `files`        | `files/index.json`, `files/data/<path>`           | Each file is put. Files over 48 MB in all are named in the manifest only.                            |
| `config`       | `config/repo.json`, `config/files/<path>`         | One commit that makes the tree the backup's. It republishes the worker.                              |
| `routes`       | `routes.json`: the fetch routes                   | Recorded only                                                                                        |
| `schedules`    | `schedules.json`                                  | Recorded only                                                                                        |
| `integrations` | `integrations.json`: each connection's row        | Recorded; the report says how to reconnect each one                                                  |
| `hostnames`    | `hostnames.json`: the custom hostnames served     | Recorded only                                                                                        |

`/backups/`, where the project keeps its backups, is left out of `files`.

**Secrets.** A secret's value is never read: the backup holds each secret's _sealed cell_
(`sealed` in `secrets.json`), the material as the platform's facts carry it, encrypted under the
deployment's secrets key and bound to that secret (the secret facet's `snapshot()` on the
secret's path answers the current one). The cell opens only with that key. The restore page asks for the key when a backup has sealed cells and
sends it with the restore, once, to the project's own host: the worker opens every cell before it
writes anything (a wrong key restores nothing), sets each secret as it was, and the platform seals
it again under its own key. So a backup moves secrets between projects, and between deployments
whose keys you hold. Without the key, each secret gets a collect link that asks a person for its
value. The key is the deployment's: type it only into a page whose code you trust.

## Install

1. In the config repo's `package.json`, under `dependencies`, the build to use:

   ```json
   "@iterate-com/project-backup": "https://pkg.pr.new/iterate/private/@iterate-com/project-backup@<commit>"
   ```

2. In `worker.ts`, the import, one element of the `integrations` array (iterate/sdk
   `Integration`: the worker hands it the requests on its routing slug and every event), and a
   `backup()` method for `itx.config.backup()`:

   ```ts
   import { backupToFiles, projectBackup } from "@iterate-com/project-backup";

   const integrations: Integration[] = [projectBackup()];

   export default class extends IterateConfigEntrypoint {
     /** `itx.config.backup()`: a backup kept in the project's files, at /backups/<time>.zip. */
     async backup() {
       using itx = this.getItx();
       return await backupToFiles(itx);
     }
     // … processEvent and fetch as core/configs/default has them: they dispatch to `integrations`
   }
   ```

3. Commit. The page is at the project's `backup` routing slug, for members only:
   `await itx.url({ routingSlug: "backup" })` (`backup--<project>.<base>`, or
   `backup.<primary hostname>`); `projectBackup({ slug })` takes another slug. The install hook lists
   it on the Dash's Integrations page, with an Open button.

## Use

- **The page**: tick parts and **Download the backup**; **Back up now** keeps one in the project's
  files and lists it; **Restore** opens a zip (one chosen from disk, or a kept one) in the browser,
  lists what is in it, takes the deployment's secrets key when the zip has sealed secrets, and
  restores the parts ticked. The report says what each part did, gives a link for each secret it
  could not open, and says how to reconnect each connection.
- **From code**: `await itx.config.backup()` answers `{ path, size, parts, skipped }` (a kept
  backup holds up to 24 MiB of files, and one over 31 MiB is refused: the platform takes one file
  in one call of at most 32 MiB), then
  `(await itx.files.get(path).url()).url` downloads it. The functions are the package's exports:

  ```ts
  import {
    exportProject,
    readBackup,
    restoreProject,
    writeBackup,
  } from "@iterate-com/project-backup";

  const zip = writeBackup(await exportProject(itx, { parts: ["kv", "config"] }));
  await restoreProject(itx, readBackup(zip), { parts: ["kv"] });
  ```

| File                   | What                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `src/archive.ts`       | The zip: its layout, `writeBackup` and `readBackup`                       |
| `src/export.ts`        | `exportProject`, what a backup reads; `backupToFiles`, a backup kept      |
| `src/restore.ts`       | `restoreProject`: what each part writes back, or reports                  |
| `src/sealed-secret.ts` | `openSealedSecret`: a sealed secret opened with its deployment's key      |
| `src/integration.ts`   | `projectBackup`: the integration, its fetch (members only) and its hook   |
| `src/page.ts`          | The page: export, the backups kept, and the restore wizard in the browser |
