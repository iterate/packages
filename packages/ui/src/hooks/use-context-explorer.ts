// A context explorer's links in an app with a router (dash's mind contexts): where a context
// path's link goes under `base`, and a click on one as a route change. The explorer itself is
// `ContextExplorer` (components/context-explorer), which knows no router.
import { useMemo } from "react";
import { useRouter } from "@tanstack/react-router";
import type { ContextPathLinks } from "#/components/context-view/context-path.tsx";

/** The links of the explorer at `base` (`/minds/<address>/contexts`): `/` is `base` itself, and
 *  `/repos/config` is `base/repos/config`. A path opens afresh through the router: the view's
 *  search (filter, inspected event) was the last path's. */
export function useContextLinks(base: string) {
  const router = useRouter();
  return useMemo(
    (): ContextPathLinks => ({
      hrefOf: (to) => `${base}${to === "/" ? "" : to.split("/").map(encodeURIComponent).join("/")}`,
      onNavigate: (href, event) => {
        event.preventDefault();
        void router.navigate({ href });
      },
    }),
    [base, router],
  );
}
