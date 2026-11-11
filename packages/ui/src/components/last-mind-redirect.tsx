import { Navigate } from "@tanstack/react-router";
import { useConnectedMinds } from "#/components/connected-minds.ts";
import { DefaultPendingComponent } from "#/components/route-defaults.tsx";

/** `/` in an app that shows one mind at a time: the mind this browser used last
 *  (`/minds/<address>`), or the connect page when it is connected to none. It navigates once the
 *  page has mounted and the app's gate has answered: a redirect from `beforeLoad` during the first
 *  hydration can leave TanStack's destination match in an error state without an error. */
export function LastMindRedirect() {
  const connected = useConnectedMinds();
  if (!connected) return <DefaultPendingComponent />;
  return (
    <>
      {connected.lastUsed ? (
        <Navigate to="/minds/$mind" params={{ mind: connected.lastUsed }} replace />
      ) : (
        <Navigate to="/connect" replace />
      )}
      <DefaultPendingComponent />
    </>
  );
}
