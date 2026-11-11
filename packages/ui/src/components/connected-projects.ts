// connected-projects.ts — THE PROJECTS THIS BROWSER IS CONNECTED TO, for the shell's switcher, the
// palette and an app's home. The app's sign-in gate knows them (iterate/app-server
// `/.auth/projects.json`): each project by its address, and the one used last.
import { useSyncExternalStore } from "react";
import { z } from "zod";

const ConnectedProjects = z.object({
  projects: z.array(z.object({ address: z.string(), lastUsedAt: z.number() })),
  lastUsed: z.string().nullable(),
});
export type ConnectedProjects = z.infer<typeof ConnectedProjects>;

/** Ask the gate. Null when it does not answer as one. */
async function readConnectedProjects(signal: AbortSignal): Promise<ConnectedProjects | null> {
  const response = await fetch("/.auth/projects.json", {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) return null;
  const parsed = ConnectedProjects.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

/** The page's one read of the gate, and its answer once it has one. Connecting a project and
 *  signing out of one are full page loads, so the page reads once. A remounted shell has the
 *  answer at once. */
let projectsRead: Promise<void> | undefined;
let projectsAnswer: ConnectedProjects | null = null;
/** What a gate that did not answer stands for: no project to go back to. */
const NONE: ConnectedProjects = { projects: [], lastUsed: null };

function subscribeToProjects(changed: () => void) {
  let subscribed = true;
  projectsRead ||= readConnectedProjects(AbortSignal.timeout(10_000)).then(
    (answer) => {
      projectsAnswer = answer || NONE;
    },
    () => {
      projectsAnswer = NONE;
    },
  );
  void projectsRead.then(() => subscribed && changed());
  return () => {
    subscribed = false;
  };
}

/** The connected projects, the last used first; null until the gate has answered (and on the
 *  server). A gate that fails to answer reads as no projects. */
export function useConnectedProjects(): ConnectedProjects | null {
  return useSyncExternalStore(
    subscribeToProjects,
    () => projectsAnswer,
    () => null,
  );
}
