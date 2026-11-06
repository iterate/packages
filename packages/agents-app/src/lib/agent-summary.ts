// What the sidebar and the home page show about the project's agents. It reads the catalog on `/`
// (iterate/agents catalog.ts), which has one row per agent kept up to date by copies of the agent's
// events, so a list of any length reads no agent. These are pure functions, so agent-summary.test.ts can test the
// ordering directly; use-agent-rows.ts keeps the rows live.
import { z } from "zod";

export type AgentRow = {
  path: string;
  createdAt: string;
  /** What the agent calls itself, or else the first line of the first thing a person said to it.
   *  Null until either exists, and always null for an agent created before the catalog's rows. */
  title: string | null;
  /** When it was last active. Null until it has been, and always null for an agent created before
   *  the rows. */
  lastActivityAt: string | null;
};

/** The part of the catalog's live state the sidebar reads. Parsed rather than cast, because live
 *  updates arrive unvalidated. A row nothing has been copied to yet has neither optional field. */
const AgentCatalog = z.object({
  agents: z.record(
    z.string(),
    z.object({
      createdAt: z.string(),
      title: z.string().nullish(),
      lastActivityAt: z.string().nullish(),
    }),
  ),
});

/** The catalog's rows, oldest agent first, or none if `value` isn't a catalog. */
export function agentRowsOf(value: unknown): AgentRow[] {
  const parsed = AgentCatalog.safeParse(value);
  if (!parsed.success) return [];
  return Object.entries(parsed.data.agents).map(([path, row]) => ({
    path,
    createdAt: row.createdAt,
    title: row.title || null,
    lastActivityAt: row.lastActivityAt || null,
  }));
}

/** What a list calls an agent: its title, or else the last segment of its path. */
export function agentTitle(row: AgentRow): string {
  return row.title || row.path.split("/").filter(Boolean).at(-1) || row.path;
}

/** When an agent last did anything, as far as the catalog knows: its last activity, or else when
 *  it was created. */
function agentActivityAt(row: AgentRow): string {
  return row.lastActivityAt || row.createdAt;
}

/** The agents, most recently active first (the path breaks a tie): the home page's list. */
export function byRecentActivity(rows: readonly AgentRow[]): AgentRow[] {
  return rows.toSorted(
    (left, right) =>
      agentActivityAt(right).localeCompare(agentActivityAt(left)) ||
      left.path.localeCompare(right.path),
  );
}

/** The sidebar's two lists, each most recently active first: the agents this person pinned, then
 *  the rest. */
export function orderAgents(
  rows: readonly AgentRow[],
  pinned: ReadonlySet<string>,
): { pinned: AgentRow[]; recent: AgentRow[] } {
  const ordered = byRecentActivity(rows);
  return {
    pinned: ordered.filter((row) => pinned.has(row.path)),
    recent: ordered.filter((row) => !pinned.has(row.path)),
  };
}
