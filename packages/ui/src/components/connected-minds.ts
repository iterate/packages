// connected-minds.ts — THE MINDS THIS BROWSER IS CONNECTED TO, for the shell's switcher, the
// palette and an app's home. The app's sign-in gate knows them (iterate/app-server
// `/.auth/minds.json`): each mind by its address, and the one used last.
import { useSyncExternalStore } from "react";
import { z } from "zod";

const ConnectedMinds = z.object({
  minds: z.array(z.object({ address: z.string(), lastUsedAt: z.number() })),
  lastUsed: z.string().nullable(),
});
export type ConnectedMinds = z.infer<typeof ConnectedMinds>;

/** Ask the gate. Null when it does not answer as one. */
async function readConnectedMinds(signal: AbortSignal): Promise<ConnectedMinds | null> {
  const response = await fetch("/.auth/minds.json", {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) return null;
  const parsed = ConnectedMinds.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

/** The page's one read of the gate, and its answer once it has one. Connecting a mind and
 *  signing out of one are full page loads, so the page reads once. A remounted shell has the
 *  answer at once. */
let mindsRead: Promise<void> | undefined;
let mindsAnswer: ConnectedMinds | null = null;
/** What a gate that did not answer stands for: no mind to go back to. */
const NONE: ConnectedMinds = { minds: [], lastUsed: null };

function subscribeToMinds(changed: () => void) {
  let subscribed = true;
  mindsRead ||= readConnectedMinds(AbortSignal.timeout(10_000)).then(
    (answer) => {
      mindsAnswer = answer || NONE;
    },
    () => {
      mindsAnswer = NONE;
    },
  );
  void mindsRead.then(() => subscribed && changed());
  return () => {
    subscribed = false;
  };
}

/** The connected minds, the last used first; null until the gate has answered (and on the
 *  server). A gate that fails to answer reads as no minds. */
export function useConnectedMinds(): ConnectedMinds | null {
  return useSyncExternalStore(
    subscribeToMinds,
    () => mindsAnswer,
    () => null,
  );
}
