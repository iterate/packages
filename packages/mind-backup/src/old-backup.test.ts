import { strToU8, zipSync } from "fflate";
import { expect, test } from "vitest";
import { readBackup } from "./archive.ts";
import { manifestOfToday } from "./old-backup.ts";

const today = {
  format: "iterate-mind-backup",
  version: 1,
  capturedAt: "2026-11-11T19:00:00.000Z",
  source: { mindId: "prj_ada", mindSlug: "ada" },
  parts: [],
};

test("a manifest from the old platform is read as today's, and today's is left as it is", () => {
  const old = {
    ...today,
    format: "iterate-project-backup",
    source: { projectId: "prj_ada", projectSlug: "ada" },
  };
  expect(manifestOfToday(old)).toEqual(today);
  expect(manifestOfToday(today)).toBe(today);
  expect(manifestOfToday({ format: "something-else" })).toEqual({ format: "something-else" });
  expect(manifestOfToday({ ...old, source: { projectId: "prj_ada" } })).toEqual({
    ...today,
    source: { mindId: "prj_ada" },
  });
});

test("a zip whose manifest the old platform wrote restores: readBackup takes it", () => {
  const old = zipSync({
    "manifest.json": strToU8(
      JSON.stringify({
        ...today,
        skipped: [],
        format: "iterate-project-backup",
        source: { projectId: "prj_ada", projectSlug: "ada" },
      }),
    ),
  });
  expect(readBackup(old)).toEqual({ manifest: { ...today, skipped: [] } });
});

test("the function names nothing outside itself, so the restore page can run its text", () => {
  // oxlint-disable-next-line no-new-func -- the page runs exactly this text in a browser
  const inPage = new Function(`return (${manifestOfToday.toString()})`)();
  expect(inPage({ format: "iterate-project-backup", source: { projectId: "prj_ada" } })).toEqual({
    format: "iterate-mind-backup",
    source: { mindId: "prj_ada" },
  });
});
