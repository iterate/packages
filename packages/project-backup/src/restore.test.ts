// restoreProject: what each part writes onto a project root, and what it only reports. Each backup
// is exported from one fake project and restored onto another.
import { expect, test } from "vitest";
import type { ProjectBackup } from "./archive.ts";
import { exportProject } from "./export.ts";
import { restoreProject } from "./restore.ts";
import { fakeProject, sealSecret } from "./test-support.ts";

const sourceKey = "source-deployment-key";

test("kv, files and config go back; the config commit is the backup's tree, on the tip it read", async () => {
  const backup = await exportProject(
    fakeProject({
      kv: { a: "1", b: "2" },
      files: { "/notes/a.txt": "hello" },
      config: { "worker.ts": "export default {}", "AGENTS.md": "# Before" },
    }).itx,
  );
  const target = fakeProject({
    kv: { a: "old", c: "3" },
    config: { "worker.ts": "export default class {}", "extra.ts": "" },
  });
  expect(await restoreProject(target.itx, backup, { parts: ["kv", "files", "config"] })).toEqual([
    { part: "kv", restored: 2, notes: [] },
    { part: "files", restored: 1, notes: [] },
    { part: "config", restored: 3, notes: [] },
  ]);
  // kv and files are added and overwritten, never emptied; the config tree is the backup's
  expect(Object.fromEntries(target.kv)).toEqual({ a: "1", b: "2", c: "3" });
  expect([...target.files.keys()]).toEqual(["/notes/a.txt"]);
  expect(Object.fromEntries(target.config)).toEqual({
    "worker.ts": "export default {}",
    "AGENTS.md": "# Before",
  });
  expect(target.calls.commits).toMatchObject([{ parent: "c1" }]);
});

test.for([
  { name: "the source deployment's key", keys: { current: sourceKey } },
  {
    name: "the key a rotation left as previous",
    keys: { current: "rotated", previous: sourceKey },
  },
])("$name opens each sealed secret, set with its pin and strategy", async ({ keys }) => {
  const target = fakeProject();
  expect(
    await restoreProject(target.itx, await sealedBackup(), {
      parts: ["secrets"],
      sourceKeys: keys,
    }),
  ).toEqual([{ part: "secrets", restored: 1, notes: [], links: [] }]);
  expect(target.calls).toMatchObject({
    secretsSet: [
      {
        path: "/secrets/openai",
        material: { apiKey: "sk-test" },
        options: { urls: ["https://api.openai.com"], refresh: undefined },
      },
    ],
  });
});

test("an empty string is a value: set, not collected", async () => {
  const target = fakeProject();
  expect(
    await restoreProject(target.itx, await sealedBackup(""), {
      parts: ["secrets"],
      sourceKeys: { current: sourceKey },
    }),
  ).toEqual([{ part: "secrets", restored: 1, notes: [], links: [] }]);
  expect(target.calls).toMatchObject({ secretsSet: [{ path: "/secrets/openai", material: "" }] });
});

test.for([
  {
    name: "a wrong key",
    key: "another-deployment-key",
    context: "prj_source.iterate/secrets/openai",
  },
  {
    name: "a cell moved to another secret's context",
    key: sourceKey,
    context: "prj_source.iterate/secrets/other",
  },
])("$name restores nothing, kv included", async ({ key, context }) => {
  const backup = await sealedBackup();
  const moved: ProjectBackup = {
    ...backup,
    secrets: backup.secrets!.map((secret) => ({
      ...secret,
      sealed: { ...secret.sealed!, context },
    })),
  };
  const target = fakeProject();
  await expect(
    restoreProject(target.itx, moved, { parts: ["secrets", "kv"], sourceKeys: { current: key } }),
  ).rejects.toThrow("/secrets/openai does not open with the key given");
  expect(target).toMatchObject({ calls: { secretsSet: [] } });
  expect(Object.fromEntries(target.kv)).toEqual({});
});

test("without a key each secret gets a collect link, and a borrowed or a connection's secret a note", async () => {
  const source = fakeProject({
    secrets: [
      { path: "/secrets/openai", urls: ["https://api.openai.com"], createdAt: "2026-10-01" },
      { path: "/secrets/github-acme", urls: ["https://api.github.com"], createdAt: "2026-10-01" },
      {
        path: "/secrets/lent",
        urls: ["https://api.example.com"],
        createdAt: "2026-10-01",
        borrowed: { lendId: "lend_1", lender: { instance: true } },
      },
    ],
    integrations: {
      "/integrations/github/acme": { provider: "github", connection: "acme", account: "acme" },
    },
  });
  const backup = await exportProject(source.itx, { parts: ["secrets", "integrations"] });
  expect(
    await restoreProject(fakeProject().itx, backup, { parts: ["secrets", "integrations"] }),
  ).toEqual([
    {
      part: "secrets",
      restored: 0,
      notes: [
        "/secrets/github-acme is an integration connection's: reconnect it (integrations).",
        "/secrets/lent was borrowed: lend or connect it again.",
      ],
      links: [{ path: "/secrets/openai", url: "https://os.example/collect-secret/secrets/openai" }],
    },
    {
      part: "integrations",
      restored: 0,
      notes: [
        'Reconnect github (acme) as the connection acme: the Dash\'s Integrations page, or itx.integrations.connect("github", { connection: "acme" }).',
      ],
    },
  ]);
});

test("a record is reported and not restored, and a part the backup lacks says so", async () => {
  const backup = await exportProject(
    fakeProject({ routes: [{ fetchRouteName: "blog", configuredOffset: 1 }] }).itx,
    { parts: ["routes"] },
  );
  expect(await restoreProject(fakeProject().itx, backup, { parts: ["kv", "routes"] })).toEqual([
    { part: "kv", restored: 0, notes: ["Not in this backup."] },
    {
      part: "routes",
      restored: 0,
      notes: ["1 recorded in routes.json; this version does not restore them."],
    },
  ]);
});

/** A backup of one secret with its sealed cell, sealed under `sourceKey` at its own binding. */
async function sealedBackup(material: unknown = { apiKey: "sk-test" }) {
  const binding = {
    context: "prj_source.iterate/secrets/openai",
    urls: ["https://api.openai.com"],
    nonce: "nonce-2",
  };
  const cell = await sealSecret(material, binding, sourceKey);
  return exportProject(
    fakeProject({
      kv: { a: "1" },
      secrets: [{ path: "/secrets/openai", urls: binding.urls, createdAt: "2026-10-01" }],
    }).itx,
    { parts: ["secrets", "kv"], sealSecret: async () => cell },
  );
}
