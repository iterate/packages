// restoreMind: what each part writes onto a mind root, and what it only reports. Each backup
// is exported from one fake mind and restored onto another.
import { expect, test } from "vitest";
import type { MindBackup } from "./archive.ts";
import { exportMind } from "./export.ts";
import { restoreMind } from "./restore.ts";
import { fakeMind, sealSecret } from "./test-support.ts";

const sourceKey = "source-deployment-key";

test("kv, files and config go back; the config commit is the backup's tree, on the tip it read", async () => {
  const backup = await exportMind(
    fakeMind({
      kv: { a: "1", b: "2" },
      files: { "/notes/a.txt": "hello" },
      config: { "worker.ts": "export default {}", "AGENTS.md": "# Before" },
    }).itx,
  );
  const target = fakeMind({
    kv: { a: "old", c: "3" },
    config: { "worker.ts": "export default class {}", "extra.ts": "" },
  });
  expect(await restoreMind(target.itx, backup, { parts: ["kv", "files", "config"] })).toEqual([
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
  const target = fakeMind();
  expect(
    await restoreMind(target.itx, await sealedBackup(), {
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
  const target = fakeMind();
  expect(
    await restoreMind(target.itx, await sealedBackup(""), {
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
    context: "mind_source.iterate/secrets/openai",
  },
  {
    name: "a cell moved to another secret's context",
    key: sourceKey,
    context: "mind_source.iterate/secrets/other",
  },
])("$name restores nothing, kv included", async ({ key, context }) => {
  const backup = await sealedBackup();
  const moved: MindBackup = {
    ...backup,
    secrets: backup.secrets!.map((secret) => ({
      ...secret,
      sealed: { ...secret.sealed!, context },
    })),
  };
  const target = fakeMind();
  await expect(
    restoreMind(target.itx, moved, { parts: ["secrets", "kv"], sourceKeys: { current: key } }),
  ).rejects.toThrow("/secrets/openai does not open with the key given");
  expect(target).toMatchObject({ calls: { secretsSet: [] } });
  expect(Object.fromEntries(target.kv)).toEqual({});
});

test("a stack's stored cell goes back to the vault with a proof under the key given, and no value is set here; with no key it gets a collect link, and a wrong key stops the restore", async () => {
  const stored = JSON.stringify({ cell: { context: "/secrets/openai", version: 3 } });
  const stack = () =>
    fakeMind({
      secrets: [
        { path: "/secrets/openai", urls: ["https://api.openai.com"], createdAt: "2026-10-01" },
      ],
      vault: { key: sourceKey, stored: { "/secrets/openai": stored } },
    });
  const backup = await exportMind(stack().itx, { parts: ["secrets"], atRestKey: sourceKey });
  const [keyed, unkeyed, wrong] = [stack(), stack(), stack()];

  const report = await restoreMind(keyed.itx, backup, {
    parts: ["secrets"],
    sourceKeys: { current: sourceKey },
  });
  await restoreMind(unkeyed.itx, backup, { parts: ["secrets"] });
  await expect(
    restoreMind(wrong.itx, backup, { parts: ["secrets"], sourceKeys: { current: "another-key" } }),
  ).rejects.toThrow("/secrets/openai was not taken back by the vault");

  expect({ report, keyed: keyed.calls, unkeyed: unkeyed.calls, wrong: wrong.calls }).toMatchObject({
    report: [{ part: "secrets", restored: 1, links: [] }],
    keyed: { cellsTaken: [{ path: "/secrets/openai", cell: stored }], secretsSet: [] },
    unkeyed: { cellsTaken: [], collectLinks: ["/secrets/openai"] },
    wrong: { cellsTaken: [], secretsSet: [], collectLinks: [] },
  });
});

test("a restore that stopped at one secret runs again with the same backup: a cell that the vault took before is that secret done, said in a note, and the rest go back", async () => {
  const down = new Set(["/secrets/b"]);
  const stack = fakeMind({
    secrets: [
      { path: "/secrets/a", urls: ["https://a.example.com"], createdAt: "2026-10-01" },
      { path: "/secrets/b", urls: ["https://b.example.com"], createdAt: "2026-10-01" },
    ],
    vault: {
      key: sourceKey,
      stored: { "/secrets/a": '{"cell":"a"}', "/secrets/b": '{"cell":"b"}' },
      down,
    },
  });
  const backup = await exportMind(stack.itx, { parts: ["secrets"], atRestKey: sourceKey });
  const restoring = () =>
    restoreMind(stack.itx, backup, { parts: ["secrets"], sourceKeys: { current: sourceKey } });

  await expect(restoring()).rejects.toThrow("/secrets/b was not taken back by the vault");
  down.clear();
  const again = await restoring();

  expect({ again, taken: stack.calls.cellsTaken.map(({ path }) => path) }).toEqual({
    again: [
      {
        part: "secrets",
        // what this run put back: the cell of /secrets/a went in with the run that stopped
        restored: 1,
        notes: [
          "/secrets/a: the vault took this cell before (an earlier run of this restore), and the secret is left as it is now.",
        ],
        links: [],
      },
    ],
    taken: ["/secrets/a", "/secrets/b"],
  });
});

test("a collect link pins its secret as the vault describes it now; only a secret that the vault does not hold takes the backup file's hosts, and the report says which", async () => {
  // a file that somebody changed: it has no cell, and it names a host of its own for each secret
  const source = fakeMind({
    secrets: [
      { path: "/secrets/openai", urls: ["https://evil.example.com"], createdAt: "2026-10-01" },
      { path: "/secrets/gone", urls: ["https://also-evil.example.com"], createdAt: "2026-10-01" },
    ],
  });
  const backup = await exportMind(source.itx, { parts: ["secrets"] });
  const target = fakeMind({
    secrets: [
      { path: "/secrets/openai", urls: ["https://api.openai.com"], createdAt: "2026-10-01" },
    ],
  });

  const report = await restoreMind(target.itx, backup, { parts: ["secrets"] });

  expect({ report, pinned: target.calls.collectPins }).toEqual({
    report: [
      {
        part: "secrets",
        restored: 0,
        notes: [
          "1 link pins its secret to hosts that the BACKUP FILE names: read each link's urls before a value is entered there.",
        ],
        links: [
          {
            path: "/secrets/openai",
            url: "https://os.example/collect-secret/secrets/openai",
            urls: ["https://api.openai.com"],
            pinFrom: "the vault",
          },
          {
            path: "/secrets/gone",
            url: "https://os.example/collect-secret/secrets/gone",
            urls: ["https://also-evil.example.com"],
            pinFrom: "the backup file",
          },
        ],
      },
    ],
    pinned: [
      { path: "/secrets/openai", urls: ["https://api.openai.com"] },
      { path: "/secrets/gone", urls: ["https://also-evil.example.com"] },
    ],
  });
});

test("without a key each secret gets a collect link, and a borrowed or a connection's secret a note", async () => {
  const source = fakeMind({
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
  const backup = await exportMind(source.itx, { parts: ["secrets", "integrations"] });
  expect(await restoreMind(fakeMind().itx, backup, { parts: ["secrets", "integrations"] })).toEqual(
    [
      {
        part: "secrets",
        restored: 0,
        notes: [
          "/secrets/github-acme is an integration connection's: reconnect it (integrations).",
          "/secrets/lent was borrowed: lend or connect it again.",
          "1 link pins its secret to hosts that the BACKUP FILE names: read each link's urls before a value is entered there.",
        ],
        links: [
          {
            path: "/secrets/openai",
            url: "https://os.example/collect-secret/secrets/openai",
            urls: ["https://api.openai.com"],
            pinFrom: "the backup file",
          },
        ],
      },
      {
        part: "integrations",
        restored: 0,
        notes: ["Reconnect github (acme) as the connection acme, on the Dash's Integrations page."],
      },
    ],
  );
});

test("a record is reported and not restored, and a part the backup lacks says so", async () => {
  const backup = await exportMind(
    fakeMind({ routes: [{ fetchRouteName: "blog", configuredOffset: 1 }] }).itx,
    { parts: ["routes"] },
  );
  expect(await restoreMind(fakeMind().itx, backup, { parts: ["kv", "routes"] })).toEqual([
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
    context: "mind_source.iterate/secrets/openai",
    urls: ["https://api.openai.com"],
    nonce: "nonce-2",
  };
  const cell = await sealSecret(material, binding, sourceKey);
  return exportMind(
    fakeMind({
      kv: { a: "1" },
      secrets: [{ path: "/secrets/openai", urls: binding.urls, createdAt: "2026-10-01" }],
    }).itx,
    { parts: ["secrets", "kv"], sealSecret: async () => cell },
  );
}
