// A context explorer's wiring, the one every explorer page (dash's mind contexts, admin's
// mind and global explorers) shares: the URL's tail as a context path, a root context held for
// the page's life and the context shown as a `cd` from it, and the links the tree
// (`context-view/context-tree.tsx`) and the path (`context-view/context-path.tsx`) use, through
// the app's router. Where the tree's paths come from and how the page lays out stay the app's;
// `useRegistryPaths` is a mind's, from its registry.
import { useMemo, type DependencyList } from "react";
import { useRouter } from "@tanstack/react-router";
import { z } from "zod";
import type { AuthenticatedApp } from "iterate/app";
import { resolveContextPath } from "iterate/lib";
import { useContextStub, useFacetLiveState } from "iterate/react";
import type { ContextPathLinks } from "#/components/context-view/context-path.tsx";

/** A splat route's tail as a context path, canonical as `cd` reads it (`resolveContextPath`, the
 *  SDK's one resolver): `` → `/`, `repos/config/` → `/repos/config`. */
export function contextPathOf(splat: string | undefined) {
  return resolveContextPath("/", splat || "");
}

/** A held context, as a mind's root hands it (`itx.cd(path)`). */
type ContextStub = Awaited<ReturnType<AuthenticatedApp["itx"]["cd"]>>;

/** The explorer at `base` (`/global`, `/minds/<slug>/contexts`) showing the splat's path: the
 *  root `openRoot` opens is held while `deps` stand (a registry or an announcement log is its live
 *  state), and the context shown is released and re-opened as the path changes. A path opens
 *  afresh through the router: the view's search (filter, inspected event) was the last path's. */
export function useContextExplorer({
  base,
  splat,
  openRoot,
  deps,
}: {
  base: string;
  splat: string | undefined;
  /** Null while the root can't be named yet (an unknown mind): nothing opens. */
  openRoot: (() => PromiseLike<ContextStub>) | null;
  deps: DependencyList;
}) {
  const router = useRouter();
  const path = contextPathOf(splat);
  const root = useContextStub(openRoot, deps);
  const rootStub = root.stub;
  const context = useContextStub(rootStub ? () => rootStub.cd(path) : null, [rootStub, path]);
  const links = useMemo(
    (): ContextPathLinks => ({
      hrefOf: (to) => `${base}${to === "/" ? "" : to.split("/").map(encodeURIComponent).join("/")}`,
      onNavigate: (href, event) => {
        event.preventDefault();
        void router.navigate({ href });
      },
    }),
    [base, router],
  );
  return {
    path,
    rootStub,
    stub: context.stub,
    error: root.error || context.error,
    links,
    /** `ContextTree`'s and `ContextTreeSheet`'s props but `paths`: a typed path resolves against
     *  the one shown. */
    tree: {
      current: path,
      links,
      resolvePath: (typed: string) => resolveContextPath(path, typed),
    },
  };
}

/** Every path a mind's context registry holds: the `mind` facet's `contexts` on the
 *  mind's root, live (core/mind-worker/src/mind/contract.ts), keyed by path. */
export function useRegistryPaths(root: ContextStub | undefined) {
  const { value } = useFacetLiveState(root, "mind");
  return useMemo(() => Object.keys(Registry.safeParse(value).data?.contexts || {}), [value]);
}

/** The one field of the `mind` facet's state an explorer reads: the registry's paths, as keys. */
const Registry = z.looseObject({ contexts: z.record(z.string(), z.unknown()).optional() });
