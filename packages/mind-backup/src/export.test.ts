// exportMind: what it reads from a mind root, part by part. The zip is archive.test.ts's.
import { strToU8 } from "fflate";
import type { SecretCatalogEntry } from "iterate/api";
import { expect, test } from "vitest";
import { readBackup, writeBackup } from "./archive.ts";
import { backupToFiles, exportMind, RPC_VALUE_MAX_BYTES } from "./export.ts";
import { fakeMind, sealSecret } from "./test-support.ts";

test("every part is read through the mind's root; a secret whose cell the platform does not answer is its catalog entry, named in skipped", async () => {
  const backup = await exportMind(mind().itx);
  expect(backup).toMatchObject({
    manifest: {
      format: "iterate-mind-backup",
      version: 1,
      source: { mindId: "mind_source", mindSlug: "source" },
      parts: [
        "secrets",
        "kv",
        "files",
        "config",
        "routes",
        "schedules",
        "integrations",
        "hostnames",
      ],
      // the borrowed secret is never asked for
      skipped: [
        {
          part: "secrets",
          path: "/secrets/openai",
          reason: expect.stringContaining("no sealed cell"),
        },
      ],
    },
    kv: [
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ],
    files: [{ path: "/notes/a.txt", contentType: "text/plain", data: strToU8("hello") }],
    config: {
      repo: "/repos/config",
      commitOid: "c1",
      origin: "https://github.com/acme/config.git",
      files: { "worker.ts": "export default {}" },
    },
    secrets: [
      { path: "/secrets/openai", urls: ["https://api.openai.com"], sealed: undefined },
      { path: "/secrets/lent", borrowed: { lendId: "lend_1" }, sealed: undefined },
    ],
  });
  // exactly: a route without the offset of the fact that set it, and only the hostnames served
  expect(backup).toEqual(
    expect.objectContaining({
      records: {
        routes: [{ fetchRouteName: "blog", requestMatcher: { routingSlug: "blog" }, priority: 0 }],
        schedules: [{ key: "heartbeat", when: { everyMs: 300000 } }],
        integrations: [
          { provider: "github", connection: "acme", account: "acme", client: "iterate" },
        ],
        hostnames: [{ hostname: "example.com", primary: true }],
      },
    }),
  );
});

test("only the parts asked for are read", async () => {
  const { itx, calls } = mind();
  expect(await exportMind(itx, { parts: ["kv"] })).toEqual({
    manifest: expect.objectContaining({ parts: ["kv"] }),
    kv: [
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ],
  });
  expect(calls).toMatchObject({ fileReads: [] });
});

test("a file over what one call reads, one over what is left of the budget, one no zip entry can name, or an earlier backup is named in the manifest instead", async () => {
  const { itx, calls } = fakeMind({
    files: {
      "/a.txt": "12345",
      "/big.bin": "x".repeat(RPC_VALUE_MAX_BYTES + 1),
      "/b.txt": "6",
      "/c//d.txt": "7",
      "/backups/old.zip": "",
    },
  });
  expect(await exportMind(itx, { parts: ["files"], budgetBytes: 5 })).toMatchObject({
    manifest: {
      skipped: [
        {
          part: "files",
          path: "/big.bin",
          reason: `${RPC_VALUE_MAX_BYTES + 1} bytes, over the ${RPC_VALUE_MAX_BYTES} bytes one call reads; download it from its signed URL`,
        },
        {
          part: "files",
          path: "/b.txt",
          reason: "1 bytes, over the 0 bytes left of the archive's budget",
        },
        { part: "files", path: "/c//d.txt", reason: "no zip entry can name this path" },
        { part: "files", path: "/backups/old.zip", reason: "an earlier backup" },
      ],
    },
    files: [{ path: "/a.txt" }],
  });
  expect(calls).toMatchObject({ fileReads: ["/a.txt"] });
});

test("a kept backup holds files up to its own budget, and one over its size limit is refused and not kept", async () => {
  const { itx, files } = fakeMind({ files: { "/a.txt": "12345", "/b.txt": "6" } });
  const kept = await backupToFiles(itx, { parts: ["files"], budgetBytes: 5 });
  expect(kept).toMatchObject({
    path: expect.stringMatching(/^\/backups\/.+\.zip$/),
    skipped: [{ part: "files", path: "/b.txt" }],
  });
  expect(files.get(kept.path)?.data.length).toBe(kept.size);

  await expect(backupToFiles(itx, { parts: ["files"], maxBytes: 10 })).rejects.toThrow(
    /over the 10 bytes one kept backup can be/,
  );
  expect([...files.keys()].filter((path) => path.startsWith("/backups/"))).toEqual([kept.path]);
});

test("with sealSecret each secret's cell goes beside its entry, and a borrowed secret is never asked for", async () => {
  const cell = await sealSecret(
    "sk-test",
    {
      context: "mind_source.iterate/secrets/openai",
      urls: ["https://api.openai.com"],
      nonce: "nonce-3",
    },
    "source-deployment-key",
  );
  const asked: string[] = [];
  const backup = await exportMind(mind().itx, {
    parts: ["secrets"],
    sealSecret: async (path) => {
      asked.push(path);
      return cell;
    },
  });
  expect(backup).toMatchObject({
    secrets: [
      { path: "/secrets/openai", sealed: cell },
      { path: "/secrets/lent", sealed: undefined },
    ],
  });
  expect(asked).toEqual(["/secrets/openai"]);
});

test("with the stack's at-rest key each secret's stored cell goes beside its entry, as the text the vault handed out; a borrowed secret is never asked for, and a wrong key leaves the entry, named in skipped", async () => {
  const stack = () =>
    fakeMind({
      secrets: [
        { path: "/secrets/openai", urls: ["https://api.openai.com"], createdAt: "2026-10-01" },
        {
          path: "/secrets/lent",
          urls: ["https://api.example.com"],
          createdAt: "2026-10-02",
          borrowed: { lendId: "lend_1", lender: { instance: true } },
        },
      ],
      vault: { key: "the-stack-key", stored: { "/secrets/openai": STORED } },
    }).itx;

  expect({
    held: await exportMind(stack(), { parts: ["secrets"], atRestKey: "the-stack-key" }),
    wrong: await exportMind(stack(), { parts: ["secrets"], atRestKey: "another-key" }),
  }).toMatchObject({
    held: {
      secrets: [
        { path: "/secrets/openai", stored: STORED },
        { path: "/secrets/lent", stored: undefined },
      ],
      manifest: { skipped: [] },
    },
    wrong: {
      secrets: [{ path: "/secrets/openai", stored: undefined }, { path: "/secrets/lent" }],
      manifest: {
        skipped: [
          {
            part: "secrets",
            path: "/secrets/openai",
            reason: expect.stringContaining("no proof under the at-rest key"),
          },
        ],
      },
    },
  });
});

test("a backup of a mind on its own stack reads back from its zip: a catalog entry there has no createdAt", async () => {
  const stack = fakeMind({
    // the catalog of a mind's own stack, which keeps no time of the first set; the type says it has one
    secrets: [{ path: "/secrets/openai", urls: ["https://api.openai.com"] } as SecretCatalogEntry],
    vault: { key: "the-stack-key", stored: { "/secrets/openai": STORED } },
  });

  const zip = writeBackup(
    await exportMind(stack.itx, { parts: ["secrets"], atRestKey: "the-stack-key" }),
  );

  expect(readBackup(zip)).toMatchObject({
    secrets: [{ path: "/secrets/openai", urls: ["https://api.openai.com"], stored: STORED }],
  });
});

/** A stored cell as a stack's vault hands it out: text, which only that vault reads. */
const STORED = JSON.stringify({ cell: { context: "/secrets/openai", version: 3 } });

/** A mind with something in every part: two kv keys, a file, a config repo linked to GitHub, a
 *  secret of its own and a borrowed one, a route, a schedule, a GitHub connection, and a hostname
 *  it serves beside one still being added. */
function mind() {
  return fakeMind({
    kv: { a: "1", b: "2" },
    files: { "/notes/a.txt": "hello" },
    config: { "worker.ts": "export default {}" },
    origin: "https://github.com/acme/config.git",
    secrets: [
      { path: "/secrets/openai", urls: ["https://api.openai.com"], createdAt: "2026-10-01" },
      {
        path: "/secrets/lent",
        urls: ["https://api.example.com"],
        createdAt: "2026-10-02",
        borrowed: { lendId: "lend_1", lender: { instance: true } },
      },
    ],
    routes: [
      {
        fetchRouteName: "blog",
        requestMatcher: { routingSlug: "blog" },
        priority: 0,
        configuredOffset: 12,
      },
    ],
    schedules: [{ key: "heartbeat", when: { everyMs: 300000 } }],
    integrations: {
      "/integrations/github/acme": {
        provider: "github",
        connection: "acme",
        account: "acme",
        client: "iterate",
      },
    },
    hostnames: {
      "example.com": { requested: null, cloudflare: { status: "active" }, claimed: true },
      "pending.example.com": {
        requested: { verb: "add", offset: 9 },
        cloudflare: null,
        claimed: false,
      },
    },
    primaryHostname: "example.com",
  });
}
