// reconnecting-mark.tsx — THE ONE PLACE A PAGE SAYS THAT ITS CONNECTION TO THE MIND IS GONE: a
// small line at the top of the window, over the page, which takes no room and no click. A page
// with a `memberItx` draws it once, in its shell:
//
//   <ReconnectingMark itx={itx} />
//
// It draws nothing while a session is open, and nothing for the first two seconds without one
// (a deploy's cut is over before that). The views under it keep what they drew: none of them says
// that it is connecting or reading again. The mark only watches the session: a page that draws it
// and holds its stubs with the SDK's hooks alone is still reloaded when a new session opens.
import { useSyncExternalStore } from "react";
import { Spinner } from "#/components/ui/spinner.tsx";
import { itxSessionOf } from "#/lib/itx-session.ts";

export function ReconnectingMark({ itx }: { itx: object }) {
  const session = itxSessionOf(itx);
  const { epoch, state } = useSyncExternalStore(session.watch, session.get, session.get);
  if (state === "open" || state === "opening") return null;
  return (
    <div
      data-slot="reconnecting-mark"
      className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center"
    >
      <p
        role="status"
        className="flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm"
      >
        <Spinner className="size-3" />
        {state === "unreachable"
          ? "Cannot reach the mind. Trying again…"
          : epoch
            ? "Reconnecting…"
            : "Connecting…"}
      </p>
    </div>
  );
}
