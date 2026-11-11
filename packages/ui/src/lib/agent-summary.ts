// Pure transformations for the agent rows the Agents app's sidebar and home page show
// (components/agents-nav.tsx, agents-home.tsx), tested in agent-summary.test.ts. A page keeps the
// rows live from the catalog on `/agents`: `agentRowsOf(useFacetLiveState(stub, "agents").value)`.
import { z } from "zod";

const AgentStatus = z.enum(["working", "idle", "waiting", "ended"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export type AgentRow = {
  path: string;
  createdAt: string;
  /** The nearest agent above it, or null at the top. */
  parent: string | null;
  /** What runs it (`iterate`, `claude`, …). Null until it says, and for an agent that never does. */
  kind: string | null;
  /** The machine it runs on, for an agent that runs on one. */
  host: string | null;
  status: AgentStatus | null;
  /** One line: what it is doing now. */
  activity: string | null;
  /** A few sentences: its purpose or conclusions. */
  description: string | null;
  /** What the agent calls itself, or else the first line of the first thing a person said to it.
   *  Null until either exists. */
  title: string | null;
  /** When it was last active. Null until it has been. */
  lastActivityAt: string | null;
};

/** The part of the catalog's live state the sidebar reads. Parsed rather than cast, because live
 *  updates arrive unvalidated. A row nothing has been copied to yet has none of the optional
 *  fields, and a field the sidebar does not know is read as absent rather than failing the list. */
const AgentCatalog = z.object({
  agents: z.record(
    z.string(),
    z.object({
      createdAt: z.string(),
      parent: z.string().nullish(),
      kind: z.string().nullish(),
      host: z.string().nullish(),
      status: AgentStatus.nullish().catch(null),
      activity: z.string().nullish(),
      description: z.string().nullish(),
      title: z.string().nullish(),
      lastActivityAt: z.string().nullish(),
    }),
  ),
});

/** The catalog's rows, or none if `value` isn't a catalog. */
export function agentRowsOf(value: unknown): AgentRow[] {
  const parsed = AgentCatalog.safeParse(value);
  if (!parsed.success) return [];
  return Object.entries(parsed.data.agents).map(([path, row]) => ({
    path,
    createdAt: row.createdAt,
    parent: row.parent || null,
    kind: row.kind || null,
    host: row.host || null,
    status: row.status || null,
    activity: row.activity || null,
    description: row.description || null,
    title: row.title || null,
    lastActivityAt: row.lastActivityAt || null,
  }));
}

/** The agents the sidebar lists: those at the top, with no agent above them. Every context under
 *  `/agents` is a row, so `/agents/web`, which only holds the web agents, is one too: a row that
 *  never said what it is (no kind, no title) and holds others is a folder, not an agent. It is not
 *  listed, and its children count as at the top. */
export function topLevelAgents(rows: readonly AgentRow[]): AgentRow[] {
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const holders = new Set(rows.map((row) => row.parent));
  const isFolder = (row: AgentRow) => !row.kind && !row.title && holders.has(row.path);
  return rows.filter((row) => {
    if (isFolder(row)) return false;
    const parent = row.parent && byPath.get(row.parent);
    return !parent || isFolder(parent);
  });
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
