// exportProject: what it reads from a project root, part by part. The zip is archive.test.ts's.
import { strToU8 } from "fflate";
import { expect, test } from "vitest";
import { backupToFiles, exportProject, RPC_VALUE_MAX_BYTES } from "./export.ts";
import { fakeProject, sealSecret } from "./test-support.ts";

test("every part is read through the project's root; a secret whose cell the platform does not answer is its catalog entry, named in skipped", async () => {
  const backup = await exportProject(project().itx);
  expect(backup).toMatchObject({
    manifest: {
      format: "iterate-project-backup",
      version: 1,
      source: { projectId: "prj_source", projectSlug: "source" },
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
  const { itx, calls } = project();
  expect(await exportProject(itx, { parts: ["kv"] })).toEqual({
    manifest: expect.objectContaining({ parts: ["kv"] }),
    kv: [
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ],
  });
  expect(calls).toMatchObject({ fileReads: [] });
});

test("a file over what one call reads, one over what is left of the budget, one no zip entry can name, or an earlier backup is named in the manifest instead", async () => {
  const { itx, calls } = fakeProject({
    files: {
      "/a.txt": "12345",
      "/big.bin": "x".repeat(RPC_VALUE_MAX_BYTES + 1),
      "/b.txt": "6",
      "/c//d.txt": "7",
      "/backups/old.zip": "",
    },
  });
  expect(await exportProject(itx, { parts: ["files"], budgetBytes: 5 })).toMatchObject({
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
  const { itx, files } = fakeProject({ files: { "/a.txt": "12345", "/b.txt": "6" } });
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
      context: "prj_source.iterate/secrets/openai",
      urls: ["https://api.openai.com"],
      nonce: "nonce-3",
    },
    "source-deployment-key",
  );
  const asked: string[] = [];
  const backup = await exportProject(project().itx, {
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

/** A project with something in every part: two kv keys, a file, a config repo linked to GitHub, a
 *  secret of its own and a borrowed one, a route, a schedule, a GitHub connection, and a hostname
 *  it serves beside one still being added. */
function project() {
  return fakeProject({
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
