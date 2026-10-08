// test-support.ts — the package's tests' fixtures: a project root in memory, as export and restore
// call it, and a secret sealed the way core/os seals one (src/secret-at-rest.ts
// `encryptSecretMaterial`; test/vitest/os/project-backup-sealed-secret.test.ts opens the platform's
// own cell with `openSealedSecret`).
import type { SecretCatalogEntry } from "iterate/api";
import type { exportProject } from "./export.ts";
import type { restoreProject } from "./restore.ts";

/** A project root: its kv, its files (text, by path), its config repo's files at tip `c1`, its
 *  secrets catalog and its records. Writes land in the maps, and each call that has no state of its
 *  own (a secret set, a collect link, a commit, a file read, an append on a context) is recorded in
 *  `calls`. */
export function fakeProject(
  input: {
    kv?: Record<string, string>;
    files?: Record<string, string>;
    config?: Record<string, string>;
    origin?: string | null;
    secrets?: SecretCatalogEntry[];
    /** Each secret's sealed cell, by path, as its facet's snapshot holds it. */
    cells?: Record<string, unknown>;
    routes?: unknown[];
    schedules?: unknown[];
    integrations?: Record<string, unknown>;
    hostnames?: Record<string, unknown>;
    primaryHostname?: string | null;
  } = {},
) {
  const kv = new Map(Object.entries(input.kv || {}));
  const files = new Map(
    Object.entries(input.files || {}).map(([path, text]) => [
      path,
      { contentType: "text/plain", data: new TextEncoder().encode(text) },
    ]),
  );
  const config = new Map(Object.entries(input.config || {}));
  let tip = config.size > 0 ? "c1" : null;
  const calls = {
    fileReads: [] as string[],
    secretsSet: [] as { path: string; material: unknown; options: unknown }[],
    collectLinks: [] as string[],
    commits: [] as { message: string; parent: unknown; changes: unknown[] }[],
    appends: [] as { path: string; event: unknown }[],
  };
  const repo = {
    tip: async () => tip,
    origin: async () => input.origin || null,
    modules: async () => Object.fromEntries(config),
    listFiles: async () => ({ commitOid: tip, paths: [...config.keys()].sort() }),
    commitFiles: async (commit: {
      message: string;
      parent?: string | null;
      changes: ({ path: string; content: string } | { path: string; delete: true })[];
    }) => {
      calls.commits.push({
        message: commit.message,
        parent: commit.parent,
        changes: commit.changes,
      });
      const changedPaths = [];
      for (const change of commit.changes) {
        if ("delete" in change) config.delete(change.path);
        else if (config.get(change.path) === change.content) continue;
        else config.set(change.path, change.content);
        changedPaths.push(change.path);
      }
      tip = `c${calls.commits.length + 1}`;
      return { commitOid: tip, changedPaths };
    },
  };
  const root = {
    whoami: async () => ({ projectId: "prj_source", path: "/", projectSlug: "source" }),
    cd: (path: string) => ({
      append: async (event: unknown) => {
        calls.appends.push({ path, event });
        return [event];
      },
      // the secret facet on a secret's path: its state holds the cell the fake was given
      facets: {
        get: () => ({
          snapshot: async () => {
            const sealed = input.cells?.[path];
            return { offset: 1, state: { material: sealed ? { offset: 1, sealed } : null } };
          },
        }),
      },
    }),
    kv: {
      list: async () => ({ keys: [...kv.keys()] }),
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => {
        kv.set(key, value);
        return { ok: true as const };
      },
    },
    files: {
      list: async (prefix = "") =>
        [...files]
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, file]) => ({ path, contentType: file.contentType, size: file.data.length })),
      get: (path: string) => ({
        head: async () => {
          const file = files.get(path);
          return file ? { path, contentType: file.contentType, size: file.data.length } : null;
        },
        bytes: async () => {
          calls.fileReads.push(path);
          return files.get(path)!.data;
        },
        put: async (file: { contentType?: string; data: Uint8Array }) => {
          files.set(path, { contentType: file.contentType || "", data: file.data });
          return { path, contentType: file.contentType || "", size: file.data.length };
        },
      }),
    },
    repos: { get: () => repo },
    secrets: {
      list: async () => input.secrets || [],

      set: async (path: string, material: unknown, options: unknown) => {
        calls.secretsSet.push({ path, material, options });
        return { path };
      },
      collectFromUser: async ({ path }: { path: string }) => {
        calls.collectLinks.push(path);
        return { path, url: `https://os.example/collect-secret${path}` };
      },
    },
    fetchRoutes: { list: async () => input.routes || [] },
    schedules: { list: async () => input.schedules || [] },
    facets: {
      get: () => ({
        snapshot: async () => ({
          state: {
            integrations: input.integrations || {},
            hostnames: input.hostnames || {},
            primaryHostname: input.primaryHostname || null,
          },
        }),
      }),
    },
  };
  // The fake implements only the calls export and restore make; typed once as what they take, it
  // keeps its maps and records for the assertions.
  const itx = root as typeof root &
    Parameters<typeof exportProject>[0] &
    Parameters<typeof restoreProject>[0];
  return { itx, kv, files, config, calls };
}

/** `material` sealed under `secretsKey` at `binding`, as the platform keeps a secret at rest. */
export async function sealSecret(
  material: unknown,
  binding: { context: string; urls: string[]; nonce: string },
  secretsKey: string,
) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", encoder.encode(secretsKey)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(
        JSON.stringify([
          "iterate-secret",
          2,
          binding.context,
          [...new Set(binding.urls)].sort(),
          binding.nonce,
        ]),
      ),
    },
    key,
    encoder.encode(JSON.stringify(material)),
  );
  const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return {
    ...binding,
    refresh: null,
    material: {
      algorithm: "AES-256-GCM+SECRET-V1" as const,
      iv: base64(iv),
      ciphertext: base64(new Uint8Array(ciphertext)),
    },
  };
}
