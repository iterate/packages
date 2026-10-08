// The backup's zip: what writeBackup writes, readBackup reads back, and what readBackup refuses.
import { strToU8, zipSync } from "fflate";
import { expect, test } from "vitest";
import { readBackup, writeBackup, type ProjectBackup } from "./archive.ts";

test("what writeBackup zips, readBackup reads back whole", () => {
  const backup = everyPart();
  // exactness is the point: a round trip loses nothing and adds nothing
  expect(readBackup(writeBackup(backup))).toEqual(backup);
});

test.for([
  {
    name: "a zip of another format",
    zip: zipSync({ "manifest.json": json({ ...manifest([]), format: "another-format" }) }),
    error: /format/,
  },
  {
    name: "a newer version",
    zip: zipSync({ "manifest.json": json({ ...manifest([]), version: 2 }) }),
    error: /version/,
  },
  {
    name: "a part the manifest names, with no entry",
    zip: zipSync({ "manifest.json": json(manifest(["kv"])) }),
    error: /The backup has no kv\.jsonl/,
  },
  {
    name: "a file path that leaves its folder",
    zip: zipSync({
      "manifest.json": json(manifest(["files"])),
      "files/index.json": json([{ path: "/../outside", contentType: "text/plain" }]),
    }),
    error: /an unsafe file path/,
  },
  {
    name: "a config path that leaves its folder",
    zip: zipSync({
      "manifest.json": json(manifest(["config"])),
      "config/repo.json": json({ repo: "/repos/config", commitOid: null, origin: null }),
      "config/files/../worker.ts": strToU8("export default {}"),
    }),
    error: /an unsafe config path/,
  },
])("readBackup refuses $name", ({ zip, error }) => {
  expect(() => readBackup(zip)).toThrow(error);
});

function manifest(parts: ProjectBackup["manifest"]["parts"]): ProjectBackup["manifest"] {
  return {
    format: "iterate-project-backup",
    version: 1,
    capturedAt: "2026-10-07T12:00:00.000Z",
    source: { projectId: "prj_source", projectSlug: "source" },
    parts,
    skipped: [{ part: "files", path: "/big.mov", reason: "over the budget" }],
  };
}

function everyPart(): ProjectBackup {
  return {
    manifest: manifest([
      "secrets",
      "kv",
      "files",
      "config",
      "routes",
      "schedules",
      "integrations",
      "hostnames",
    ]),
    kv: [
      { key: "telegram/bots/jeeves", value: "{}" },
      { key: "multi\nline", value: "a\nb" },
    ],
    files: [
      { path: "/notes/a.txt", contentType: "text/plain", data: strToU8("hello") },
      {
        path: "/audio/b.bin",
        contentType: "application/octet-stream",
        data: Uint8Array.of(0, 255),
      },
    ],
    config: {
      repo: "/repos/config",
      commitOid: "c1",
      origin: "https://github.com/acme/config.git",
      files: { "worker.ts": "export default {}", "agents/AGENTS.md": "# Agents" },
    },
    secrets: [
      {
        path: "/secrets/openai",
        urls: ["https://api.openai.com"],
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    records: {
      routes: [{ fetchRouteName: "blog", priority: 0 }],
      schedules: [{ key: "heartbeat", when: { everyMs: 300000 } }],
      integrations: [
        { provider: "github", connection: "acme", account: "acme", client: "iterate" },
      ],
      hostnames: [{ hostname: "example.com", primary: true }],
    },
  };
}

function json(value: unknown) {
  return strToU8(JSON.stringify(value));
}
