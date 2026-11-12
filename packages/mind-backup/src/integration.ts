// integration.ts — THE BACKUP PAGE AS AN INTEGRATION a config worker hosts (iterate/sdk
// `Integration`): `const integrations: Integration[] = [mindBackup()];` (README.md "Install").
// The worker hands `fetch` the requests on the `backup` routing slug, to mind members only:
//
//   GET  /                 the page (page.ts): export, the backups kept, and the restore wizard
//   GET  /export.zip       a backup of the parts named by `?part=` (every part when none is)
//   POST /backup           a backup kept in the mind's files (`backupToFiles`), then the page
//   GET  /backups/<name>   a backup kept there, to download or to open in the wizard
//   POST /restore          the backup in the body, its parts named by `?part=` restored; the
//                          secrets key of the backup's deployment in `x-secrets-key` opens its
//                          sealed secrets here, in the worker, which sets them
//
// Its install hook (`mind/worker-updated`) registers its card on the mind's `/integrations`
// context, so the Dash's Integrations page lists Backup with an Open button to the page.
import type { IterateContextApi } from "iterate/api";
import { INTEGRATIONS_PATH } from "iterate/integrations";
import { errorCode } from "iterate/lib";
import type { Integration } from "iterate/sdk";
import { z } from "zod";
import {
  ARCHIVE_BUDGET_BYTES,
  backupSourceOf,
  BackupPart,
  readBackup,
  writeBackup,
} from "./archive.ts";
import { BACKUPS_FOLDER, backupToFiles, exportMind } from "./export.ts";
import { backupPage } from "./page.ts";
import { RestoreRefused, restoreMind } from "./restore.ts";

/** What the platform appends on `/` after it publishes a commit of the config repo: the install
 *  hook. */
const WORKER_UPDATED = "events.iterate.com/mind/worker-updated";

/** A mind's backup page, as an integration its worker hosts. `slug` is the routing slug it
 *  answers on, `backup` by default: `backup--<mind>.<base>`, or `backup.<primary hostname>`. */
export function mindBackup(options: { slug?: string } = {}): Integration {
  const routingSlug = options.slug || "backup";
  return {
    routingSlug,
    async fetch(request, host) {
      const denied = host.auth.require(request);
      if (denied) return denied;
      using itx = host.getItx();
      return await answer(request, itx);
    },
    async processEvent({ event, itx }) {
      if (event.type !== WORKER_UPDATED) return;
      // the platform retries an event, so the card keyed by it may have landed already
      try {
        await itx.cd(INTEGRATIONS_PATH).append({
          type: "events.iterate.com/integration/configured",
          idempotencyKey: `${routingSlug}:registry:${event.path}@${event.offset}`,
          payload: {
            integration: routingSlug,
            card: {
              title: "Backup",
              description:
                "One zip of the mind: kv, files, the config repo and the secrets catalog. Download it, keep one in the mind's files, or restore one.",
              status: { kind: "ok" },
              actions: [{ label: "Open", routingSlug, path: "/" }],
            },
          },
        });
      } catch (error) {
        if (errorCode(error) !== "IDEMPOTENCY_CONFLICT") throw error;
      }
    },
  };
}

/** The page's answer to one request from a member, as the mind (`itx`, the mind's root). */
async function answer(
  request: Request,
  itx: Pick<
    IterateContextApi,
    "whoami" | "kv" | "files" | "repos" | "secrets" | "fetchRoutes" | "schedules" | "facets" | "cd"
  >,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = z.array(BackupPart).safeParse(url.searchParams.getAll("part"));
  if (!parts.success)
    return new Response(`?part= names one of ${BackupPart.options.join(", ")}\n`, { status: 400 });
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /")
    return backupPage(backupSourceOf(await itx.whoami()), await itx.files.list(BACKUPS_FOLDER));

  if (route === "POST /backup") {
    await backupToFiles(itx);
    return new Response(null, { status: 303, headers: { location: "./" } });
  }

  if (request.method === "GET" && url.pathname.startsWith(BACKUPS_FOLDER)) {
    const name = url.pathname.slice(BACKUPS_FOLDER.length);
    if (!/^[\w.-]+\.zip$/.test(name)) return new Response("Not found\n", { status: 404 });
    const kept = itx.files.get(url.pathname);
    if (!(await kept.head())) return new Response("Not found\n", { status: 404 });
    return new Response(await kept.bytes(), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  }

  if (route === "GET /export.zip") {
    const backup = await exportMind(itx, {
      parts: parts.data.length > 0 ? parts.data : undefined,
      // the at-rest key of the mind's own stack, as the page sends it: its vault's cells go in
      atRestKey: request.headers.get("x-secrets-key") || undefined,
    });
    const { source, capturedAt } = backup.manifest;
    return new Response(writeBackup(backup), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${source.mindSlug || source.mindId}-${capturedAt.slice(0, 10)}.zip"`,
        "cache-control": "no-store",
      },
    });
  }

  if (route === "POST /restore") {
    if (parts.data.length === 0)
      return new Response("Name the parts to restore with ?part=\n", { status: 400 });
    const length = request.headers.get("content-length");
    if (!length) return new Response("Send the backup with its length\n", { status: 411 });
    if (Number(length) > ARCHIVE_BUDGET_BYTES)
      return new Response(`A backup restored here is at most ${ARCHIVE_BUDGET_BYTES} bytes\n`, {
        status: 413,
      });
    let backup;
    try {
      backup = readBackup(new Uint8Array(await request.arrayBuffer()));
    } catch (error) {
      return new Response(`Not a backup this version reads: ${String(error)}\n`, { status: 400 });
    }
    const key = request.headers.get("x-secrets-key");
    try {
      return Response.json(
        await restoreMind(itx, backup, {
          parts: parts.data,
          sourceKeys: key ? { current: key } : undefined,
        }),
      );
    } catch (error) {
      if (error instanceof RestoreRefused)
        return new Response(`${error.message}\n`, { status: 400 });
      throw error;
    }
  }

  return new Response("Not found\n", { status: 404 });
}
