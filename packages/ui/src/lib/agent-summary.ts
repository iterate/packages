// Pure transformations for the agent rows the Agents app's sidebar and home page show
// (components/agents-nav.tsx, agents-home.tsx), tested in agent-summary.test.ts. A page keeps the
// rows live from the catalog on `/agents`: `agentRowsOf(useFacetLiveState(stub, "agents").value)`.
import { z } from "zod";
import { agentAtWork } from "iterate/agents/mind-now";

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
 *  listed, and its children count as at the top.
 *
 *  A PERSON'S FOLDERS ARE FOLDERS WHETHER THEY HOLD A ROW OR NOT (`isPeopleFolder`). They are made
 *  for each person and each kind, so one is often empty: its rows land before its first agent's
 *  own, and it stays when its last agent is deleted. Without this it would be listed as an agent
 *  named `web`. */
export function topLevelAgents(rows: readonly AgentRow[]): AgentRow[] {
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const isFolder = folderTest(rows);
  return rows.filter((row) => {
    if (isFolder(row)) return false;
    const parent = row.parent && byPath.get(row.parent);
    return !parent || isFolder(parent);
  });
}

/** Whether a row is a folder (`topLevelAgents` says which), for these rows. */
function folderTest(rows: readonly AgentRow[]): (row: AgentRow) => boolean {
  const holders = new Set(rows.map((row) => row.parent));
  return (row) => !row.kind && !row.title && (holders.has(row.path) || isPeopleFolder(row.path));
}

/** An agent at the top and every agent below its path. */
export type AgentGroup = { row: AgentRow; subagents: AgentRow[] };

/** THE AGENTS AT THE TOP, EACH WITH THE AGENTS BELOW ITS PATH, most recently active first. A group
 *  is as recent as its newest member, so an agent whose subagent works now comes first. A list
 *  shows a group as one row: the agent, and "and 5 subagents". */
export function agentGroups(rows: readonly AgentRow[]): AgentGroup[] {
  const isFolder = folderTest(rows);
  const agents = rows.filter((row) => !isFolder(row));
  const top = topLevelAgents(rows);
  const groups = top
    // an agent below another's path is in that one's group, whatever folder holds it between
    .filter((row) => !top.some((other) => row.path.startsWith(`${other.path}/`)))
    .map((row) => ({
      row,
      subagents: byRecentActivity(agents.filter((other) => other.path.startsWith(`${row.path}/`))),
    }));
  const at = new Map(
    groups.map((group) => [
      group,
      [group.row, ...group.subagents].map(agentActivityAt).reduce((a, b) => (a > b ? a : b)),
    ]),
  );
  return groups.toSorted(
    (left, right) =>
      at.get(right)!.localeCompare(at.get(left)!) || left.row.path.localeCompare(right.row.path),
  );
}

/** "and 5 subagents", or nothing for none. */
export function subagentsLine(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? "and 1 subagent" : `and ${String(count)} subagents`;
}

/** The agents whose title, path, activity or description holds every word of `query`, most
 *  recently active first. Folders are no agents. */
export function findAgents(rows: readonly AgentRow[], query: string): AgentRow[] {
  const isFolder = folderTest(rows);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return byRecentActivity(
    rows.filter((row) => {
      if (isFolder(row)) return false;
      const text = [row.title, row.path, row.activity, row.description].join(" ").toLowerCase();
      return words.every((word) => text.includes(word));
    }),
  );
}

/** What a list calls an agent: its title, or else the last segment of its path. */
export function agentTitle(row: AgentRow): string {
  return row.title || row.path.split("/").filter(Boolean).at(-1) || row.path;
}

/** What an agent is doing now, the line a list shows under its title: its `activity` (its newest
 *  status label, or what it waits for) while it is at work by the rule the mind-now note uses
 *  (`agentAtWork`: a script at work counts, though its row says idle); otherwise null, as the line
 *  is stale. The rule reads the clock when the row renders. */
export function agentDoing(row: AgentRow, now = Date.now()): string | null {
  return agentAtWork(row, now) ? row.activity : null;
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

// ── whose an agent is ──
// AN AGENT THAT A PERSON STARTS IN THE AGENTS APP LIVES IN THAT PERSON'S FOLDER:
// `/agents/people/<person>/<folder>/<moment>`, so two people's agents are told apart by their
// paths. `people` is a level of its own, so that a person's folder is never taken for an agent:
// `/agents/<name>` is a long-lived agent's place, and a member named as one (support, onboarding)
// would otherwise put their agents under it, where the list shows none of them.

/** The folder under `/agents` that holds each person's folder. */
const PEOPLE = "people";

/** A person's folder name, from the address they sign in with: its local part, lowercased, every
 *  run outside a-z 0-9 made one "-", 40 characters at most, and no "-" at either end. Nothing
 *  for no address, or one that leaves no name: such a person's agents have no folder.
 *
 *  A LIMIT: the name is the local part alone. Two members with the same local part at two
 *  domains (jo@a.example, jo@b.example) share one folder, and each sees the other's agents as
 *  their own; one person's two addresses, or a tag (jo+bills), make one folder or two. And the
 *  folder is a label read from a path: anyone who can append under `/agents` can put an agent
 *  in any folder. It decides the list's order and one word, and no access. */
export function personOf(email: string | null | undefined): string | undefined {
  return (
    (email || "")
      .split("@")[0]!
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || undefined
  );
}

/** A folder of the people's level, by its place alone: the level itself, a person's folder, and
 *  a person's folder for one kind (`/agents/people`, `…/<person>`, `…/<person>/<folder>`). */
function isPeopleFolder(path: string): boolean {
  const [, agents, people, ...rest] = path.split("/");
  return agents === "agents" && people === PEOPLE && rest.length <= 2;
}

/** The person whose folder holds the agent at `path`, or nothing for an agent in no one's. */
export function personAt(path: string): string | undefined {
  const [, agents, people, person, ...rest] = path.split("/");
  return agents === "agents" && people === PEOPLE && rest.length > 0 ? person : undefined;
}

/** A NEW AGENT'S PATH, at this moment: in `person`'s folder, under `folder` (`web` for iterate's
 *  own, else the kind's name). With no person it is `/agents/<folder>/<moment>`: for someone
 *  with no address, and for a kind whose choice does not say `byPerson` (a kind takes the paths
 *  its own file knows: acp's runner refuses any but `/agents/acp/<id>`). An agent is its path;
 *  there is no separate name. */
export function newAgentPath(folder: string, date: Date, person: string | undefined): string {
  const slug = date
    .toISOString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return person ? `/agents/${PEOPLE}/${person}/${folder}/${slug}` : `/agents/${folder}/${slug}`;
}

/** `rows` in their order, with `person`'s own first: a list in which a person finds their agents
 *  before the others'. With no person, the rows as they are. */
export function mineFirst<Row extends { path: string }>(
  rows: readonly Row[],
  person: string | undefined,
): Row[] {
  if (!person) return [...rows];
  return [
    ...rows.filter((row) => personAt(row.path) === person),
    ...rows.filter((row) => personAt(row.path) !== person),
  ];
}

/** The sidebar's two lists, each with `person`'s own agents first and then most recently active
 *  first: the agents this person pinned, then the rest. */
export function orderAgents(
  rows: readonly AgentRow[],
  pinned: ReadonlySet<string>,
  person?: string,
): { pinned: AgentRow[]; recent: AgentRow[] } {
  const ordered = mineFirst(byRecentActivity(rows), person);
  return {
    pinned: ordered.filter((row) => pinned.has(row.path)),
    recent: ordered.filter((row) => !pinned.has(row.path)),
  };
}
