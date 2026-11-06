import { useMemo, type ReactNode } from "react";
import { useLiveState } from "iterate/react";
import type { PersonView } from "@iterate-com/cloud/wizard";
import { useCloudApi } from "../lib/cloud.ts";
import { PersonContext, useLastValue } from "../lib/live.ts";

/** The person's live state, one subscription for the tab: the signed-in shell holds it. */
export function PersonProvider({ children }: { children: ReactNode }) {
  const api = useCloudApi();
  const person = useMemo(() => api.person, [api]);
  const live = useLiveState<PersonView>(person, {
    key: "cloud-person",
    // safe: the seed is the processor's projection, which drops the nonces (person.ts), and the API types the
    // facet's state unknown across its boundary (api.ts `LiveContext.liveSnapshot`)
    readSeed: () => person.liveSnapshot() as Promise<{ rev: number; state: PersonView }>,
  });
  return <PersonContext value={useLastValue(live)}>{children}</PersonContext>;
}
