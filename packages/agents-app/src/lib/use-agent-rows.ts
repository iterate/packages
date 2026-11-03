// How the sidebar reads a project's agents: it subscribes to the live state of the catalog on `/`
// (iterate/agents catalog.ts). That's one subscription for the whole list, however long it is, and it
// reads no agent, so opening the page wakes none of them. Copies of each agent's events keep its row
// up to date.
import { useMemo } from "react";
import type { AuthenticatedApp } from "iterate/app";
import { useContextStub, useFacetLiveState, type FacetLiveSnapshot } from "iterate/react";
import { agentRowsOf, type AgentRow } from "./agent-summary.ts";

/** The project's agents, kept live. `catalog` is the first snapshot, read by the route's loader, or
 *  null for a project without the agents app, which has nothing to subscribe to. */
export function useAgentRows(
  api: AuthenticatedApp["api"],
  project: string,
  catalog: FacetLiveSnapshot | null,
): AgentRow[] {
  const installed = Boolean(catalog);
  const { stub } = useContextStub(installed ? () => api.projects.get(project) : null, [
    api,
    project,
    installed,
  ]);
  const { value } = useFacetLiveState(stub, "agents", catalog || undefined);
  return useMemo(() => agentRowsOf(value), [value]);
}
