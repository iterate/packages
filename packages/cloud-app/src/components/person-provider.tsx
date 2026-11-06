import { useMemo, type ReactNode } from "react";
import { useLiveState } from "iterate/react";
import type { PersonView } from "@iterate-com/cloud/wizard";
import { heardOf, useCloudApi } from "../lib/cloud.ts";
import { PersonContext, useLastValue } from "../lib/live.ts";

/** The person's live state, one subscription for the tab: the signed-in shell holds it. */
export function PersonProvider({ children }: { children: ReactNode }) {
  const api = useCloudApi();
  const person = useMemo(() => api.person, [api]);
  const heard = useMemo(() => heardOf(person), [person]);
  const live = useLiveState<PersonView>(heard, {
    key: "cloud-person",
    // safe: the seed is the processor's projection, which drops the nonces (person.ts), and the API types the
    // facet's state unknown across its boundary (api.ts `LiveContext.liveSnapshot`)
    readSeed: () => person.liveSnapshot() as Promise<{ rev: number; state: PersonView }>,
  });
  return <PersonContext value={useLastValue(live)}>{children}</PersonContext>;
}
