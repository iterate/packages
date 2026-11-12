// Carried over from iterate/docs@fba5c21 (packages/docs/src/install.ts).
// How a doc gets co-edited (frames.ts). A mind runs Docs' processors from its own config repo: the
// page names where their classes are (`facetSpec`), since only the page's own server knows the
// config's module and its hash. The page calls `ensureDoc` from the browser as a doc opens.
// Nothing here is the runtime.
import type { FacetSpec, IterateContextApi } from "iterate/api";
// the page imports this: frames.ts and comments.ts only, which a browser loads
import { commentEvents } from "./comments.ts";
import {
  COMMIT_NOTICED,
  DOC_LEFT,
  DOC_OPENED,
  docContextPath,
  EDIT_FRAME,
  type DocRef,
} from "./frames.ts";

/** Each processor's facet spec, by its class: the module of the mind's config that exports it. */
export type DocFacetSpec = (className: "DocDurableObject" | "DocsDurableObject") => FacetSpec;

/** The context co-editing `doc` (a repo and a path in it), set up: the root's docs processor, the
 *  doc marked opened, and the doc's processor, which reaches the doc's repo from its own context
 *  (loaded code reaches its whole mind). Idempotent: enabling a row again appends nothing. */
export async function ensureDoc(
  mind: Pick<IterateContextApi, "cd" | "append" | "processors">,
  doc: DocRef,
  options: { facetSpec: DocFacetSpec },
): Promise<IterateContextApi> {
  await mind.processors.enable("docs", {
    ...options.facetSpec("DocsDurableObject"),
    consumes: ["events.iterate.com/repo/commit-completed", DOC_OPENED],
  });
  const contextPath = docContextPath(doc);
  // one per doc: an open of a doc already opened appends nothing
  await mind.append({
    type: DOC_OPENED,
    payload: { repo: doc.repo, path: doc.path },
    idempotencyKey: `${DOC_OPENED}:${contextPath}`,
  });
  const context = mind.cd(contextPath);
  await context.processors.enable("doc", {
    ...options.facetSpec("DocDurableObject"),
    // the doc processor's consumes, as its contract names them
    consumes: [EDIT_FRAME, COMMIT_NOTICED, DOC_LEFT, ...commentEvents],
  });
  return context;
}
