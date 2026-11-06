import type { ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { DefaultPendingComponent } from "#/components/route-defaults.tsx";

/** `/projects` in an app that shows one project at a time (Agents, Notes, Voice): the first
 *  project this session lists, else a note that there is none, with `children` under it. It navigates
 *  once the client-only route has mounted: a redirect from `beforeLoad` during the first hydration
 *  can leave TanStack's destination match in an error state without an error. */
export function FirstProjectRedirect({
  project,
  children,
}: {
  project: { slug: string } | null;
  children?: ReactNode;
}) {
  if (project)
    return (
      <>
        <Navigate to="/projects/$slug" params={{ slug: project.slug }} replace />
        <DefaultPendingComponent />
      </>
    );
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
      No projects yet — create one in the dash.
      {children}
    </main>
  );
}
