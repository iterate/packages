import type { ReactNode } from "react";
import { PersonContext, useMe, usePersonLive } from "../lib/iterate.ts";

/** The person's live state, one subscription for the tab: the signed-in shell holds it. */
export function PersonProvider({ children }: { children: ReactNode }) {
  return <PersonContext value={usePersonLive(useMe())}>{children}</PersonContext>;
}
