import { Navigate } from "@tanstack/react-router";
import { useConnectedProjects } from "#/components/connected-projects.ts";
import { DefaultPendingComponent } from "#/components/route-defaults.tsx";

/** `/` in an app that shows one project at a time: the project this browser used last
 *  (`/projects/<address>`), or the connect page when it is connected to none. It navigates once the
 *  page has mounted and the app's gate has answered: a redirect from `beforeLoad` during the first
 *  hydration can leave TanStack's destination match in an error state without an error. */
export function LastProjectRedirect() {
  const connected = useConnectedProjects();
  if (!connected) return <DefaultPendingComponent />;
  return (
    <>
      {connected.lastUsed ? (
        <Navigate to="/projects/$project" params={{ project: connected.lastUsed }} replace />
      ) : (
        <Navigate to="/connect" replace />
      )}
      <DefaultPendingComponent />
    </>
  );
}
