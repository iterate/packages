// Carried over from iterate/docs@fba5c21 (packages/docs/src/install.test.ts, its ensureDoc test).
// Opening a doc from the browser: the rows `ensureDoc` enables and the event it appends. The
// processors' own contracts are the mind's config's.
import { expect, test } from "vitest";
import type { FacetSpec, IterateContextApi } from "iterate/api";
import { ensureDoc, type DocFacetSpec } from "./install.ts";

test("opening a doc enables the root's docs processor and the doc's from the page's spec, and marks the doc opened once", async () => {
  const { mind, enabled, appended } = fakeMind();

  await ensureDoc(mind, { repo: "/repos/config", path: "tasks/plan.md" }, { facetSpec });

  expect(enabled).toEqual({
    "/ docs": {
      className: "DocsDurableObject",
      mainModule: "apps/docs/processors.ts",
      source: ["itx", ["cd", "/"], "repos", ["get", "/repos/config"], ["modules"]],
      cacheKey: "docs-processors:abc123",
      consumes: ["events.iterate.com/repo/commit-completed", "docs/opened"],
    },
    "/docs/config/tasks/plan.md doc": {
      className: "DocDurableObject",
      mainModule: "apps/docs/processors.ts",
      source: ["itx", ["cd", "/"], "repos", ["get", "/repos/config"], ["modules"]],
      cacheKey: "docs-processors:abc123",
      consumes: [
        "docs/edit-frame",
        "docs/commit-noticed",
        "docs/left",
        "docs/comment-added",
        "docs/comment-replied",
        "docs/comment-edited",
        "docs/comment-deleted",
        "docs/comment-resolved",
        "docs/comment-reopened",
        "docs/comment-reanchored",
        "docs/comment-routed",
      ],
    },
  });
  expect(appended).toEqual([
    {
      type: "docs/opened",
      payload: { repo: "/repos/config", path: "tasks/plan.md" },
      idempotencyKey: "docs/opened:/docs/config/tasks/plan.md",
    },
  ]);
});

test("a repo that is not /repos/<name> is no doc's", async () => {
  const { mind } = fakeMind();
  await expect(
    ensureDoc(mind, { repo: "/elsewhere", path: "a.md" }, { facetSpec }),
  ).rejects.toThrow("not a repo Docs edits: /elsewhere");
});

/** The spec a page builds: the classes from the config repo's own files, at their source's hash. */
function facetSpec(className: Parameters<DocFacetSpec>[0]): FacetSpec {
  return {
    className,
    mainModule: "apps/docs/processors.ts",
    source: ["itx", ["cd", "/"], "repos", ["get", "/repos/config"], ["modules"]],
    cacheKey: "docs-processors:abc123",
  };
}

/** A mind's root that records the rows enabled on each context and the events appended to it. */
function fakeMind() {
  const enabled: Record<string, unknown> = {};
  const appended: unknown[] = [];
  const context = (path: string): Pick<IterateContextApi, "cd" | "append" | "processors"> => ({
    // the fake's `cd` gives contexts that hold what ensureDoc calls, and the type wants the whole API
    cd: (next: string) => context(next) as IterateContextApi,
    append: async (...events) => {
      appended.push(...events);
      return [];
    },
    processors: {
      enable: async (name, row) => {
        enabled[`${path} ${name}`] = row;
        return { name };
      },
      disable: async () => {},
      list: () => [],
      claim: async () => {},
    },
  });
  return { mind: context("/"), enabled, appended };
}
