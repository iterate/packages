// The live state of a context the person owns (@iterate-com/cloud/api `LiveContext`), through
// iterate/react's own hook: the handle's `subscribe` and `liveSnapshot` are what it reads. A handle
// is made once per session (`useMemo`): after a reconnect (lib/cloud.ts) the hook gets a new one,
// subscribes again and seeds again. Meanwhile the hook has no value, so these keep the last one,
// and the page stays as it was and says it is reconnecting (components/connection.tsx). A
// subscription that hears nothing, not even the facet's minute probe, redials too (`heardOf`).
import { createContext, useContext, useMemo, useState } from "react";
import { useLiveState, type LiveStateResult } from "iterate/react";
import type { MaskedConfig } from "@iterate-com/cloud/config";
import type { DeploymentState } from "@iterate-com/cloud/records";
import type { PersonView } from "@iterate-com/cloud/wizard";
import { heardOf, useCloudApi } from "./cloud.ts";

/** A deployment's state as the browser has it: the config's secrets masked (deployment.ts). */
export type DeploymentView = Omit<DeploymentState, "config"> & { config: MaskedConfig | null };

export const PersonContext = createContext<LiveStateResult<PersonView> | null>(null);

export function usePerson() {
  const live = useContext(PersonContext);
  if (!live) throw new Error("usePerson outside PersonProvider (components/person-provider.tsx)");
  return live;
}

export function useDeployment(id: string) {
  const api = useCloudApi();
  const handle = useMemo(() => api.deployments.get(id), [api, id]);
  const heard = useMemo(() => heardOf(handle), [handle]);
  const live = useLiveState<DeploymentView>(heard, {
    key: "cloud-deployment",
    // safe: the seed is the processor's projection, which masks the config (deployment.ts), and the API types the
    // facet's state unknown across its boundary (api.ts `LiveContext.liveSnapshot`)
    readSeed: () => handle.liveSnapshot() as Promise<{ rev: number; state: DeploymentView }>,
  });
  return { handle, ...useLastValue(live) };
}

/** `live`, with the last value it had while a new subscription connects. */
export function useLastValue<S>(live: LiveStateResult<S>): LiveStateResult<S> {
  // state derived from the previous render: set while rendering, as React's docs show it
  const [last, setLast] = useState(live.value);
  if (live.value !== undefined && live.value !== last) setLast(live.value);
  return { ...live, value: live.value ?? last };
}
