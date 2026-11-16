// dash-palette.tsx — THE DASH'S ⌘K, one for every page. Two tabs over one input:
//
//   Agents        the contexts under /agents, the most recently active first: title, one line, path.
//                 A pick opens the agent view.
//   Raw contexts  any context (`ContextPaletteResults`, the context catalog's palette). A pick opens
//                 the raw view.
//
// A query that starts with "/" is a path, in either tab: the list becomes a compact completion of
// context paths (./path-completion.ts). Tab completes the highlighted path one level, and Enter
// opens its raw view. The rows come from the catalog the Dash reads once for every page and the
// mind's own answers: its search for words, and the contexts under the typed folder for a path.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { CornerDownLeftIcon, SearchIcon } from "lucide-react";
import { cn } from "cn";
import {
  completedPath,
  isPathQuery,
  pathCompletions,
  typedFolderOf,
  typedPathOf,
  type PathEntry,
} from "./path-completion.ts";
import { STATUS_DOT } from "#/components/agent-look.ts";
import { timeAgo, type ContextListing } from "#/components/context-catalog/context-catalog-rows.ts";
import {
  ContextPaletteResults,
  PALETTE_INPUT,
  PALETTE_ROW,
  PaletteKey,
  PaletteNote,
  useClock,
  useMindSearch,
} from "#/components/context-catalog/context-palette.tsx";
import { ContextPathText } from "#/components/context-path-text.tsx";
import { Command, CommandGroup, CommandItem, CommandList } from "#/components/ui/command.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { agentDoing, agentTitle, findAgents, type AgentRow } from "#/lib/agent-summary.ts";

/** The Agents tab shows at most this many agents. */
const AGENTS_CAP = 50;

export type DashPaletteProps = {
  open: boolean;
  onClose: () => void;
  /** The catalog of the mind's agents, live: undefined while it is read. */
  agents: readonly AgentRow[] | undefined;
  /** The catalog of every context (`useContextCatalog`). */
  rows: readonly ContextListing[] | undefined;
  error: string | undefined;
  /** The mind's own search: `(query) => itx.contexts.list({ search: query, limit: 200 })`. */
  search: (query: string) => PromiseLike<unknown>;
  /** The contexts under a folder: `(path) => itx.contexts.list({ under: path, limit: 200 })`. */
  listUnder: (path: string) => PromiseLike<unknown>;
  /** Opens a context in the agent view; null with no Agents page: no Agents tab. */
  onOpenAgent: ((path: string) => void) | null;
  /** Opens a context in the raw view; null with no Contexts page: no Raw contexts tab and no
   *  path mode. */
  onOpenContext: ((path: string) => void) | null;
  /** The path an open view shows: its row says "open now". */
  current: string | undefined;
};

export function DashPalette({ open, onClose, ...body }: DashPaletteProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        // near the top, not centred, and one height for every tab and mode: nothing jumps as the
        // list changes
        className="top-3 translate-y-0 gap-0 overflow-hidden p-0 sm:top-[10svh] sm:max-w-2xl lg:max-w-5xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>
            The mind&apos;s agents and contexts. Type / to complete a context&apos;s path.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <PaletteBody
            {...body}
            onOpen={(then) => {
              onClose();
              then();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted per opening: the query starts empty, on the Agents tab when there is one. */
function PaletteBody({
  agents,
  rows,
  error,
  search,
  listUnder,
  onOpenAgent,
  onOpenContext,
  current,
  onOpen,
}: Omit<DashPaletteProps, "open" | "onClose"> & {
  /** Closes the palette, then does `then`. */
  onOpen: (then: () => void) => void;
}) {
  const [tab, setTab] = useState<"agents" | "contexts">(onOpenAgent ? "agents" : "contexts");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pathMode = Boolean(onOpenContext) && isPathQuery(query);
  // the mind's contexts under the typed folder, asked once per folder
  const under = useMindSearch(pathMode ? typedFolderOf(query) : "", listUnder);
  const completions = useMemo(() => {
    if (!pathMode) return undefined;
    const byPath = new Map((rows || []).map((row) => [row.path, row]));
    for (const row of under.answer?.rows || []) byPath.set(row.path, row);
    return pathCompletions([...byPath.values()], query);
  }, [pathMode, rows, under.answer, query]);
  const highlightedPath =
    completions?.entries.find((entry) => entry.path === selected) || completions?.entries[0];
  const openContext = (path: string) => onOpenContext && onOpen(() => onOpenContext(path));
  const changeQuery = (next: string) => {
    setQuery(next);
    inputRef.current?.focus();
  };
  return (
    <Command
      shouldFilter={false}
      loop
      value={selected}
      onValueChange={setSelected}
      className="rounded-none! p-0"
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <CommandPrimitive.Input
          ref={inputRef}
          data-slot="command-input"
          className={cn(PALETTE_INPUT, pathMode && "font-mono")}
          placeholder={
            tab === "agents"
              ? "Search agents, or type / for a path"
              : "Search contexts: name, path, event, processor"
          }
          aria-label={tab === "agents" ? "Search agents" : "Search contexts"}
          value={query}
          onValueChange={setQuery}
          onKeyDown={(event) => {
            // Tab completes the highlighted path, one level
            if (!pathMode || event.key !== "Tab" || event.shiftKey || !highlightedPath) return;
            event.preventDefault();
            setQuery(completedPath(highlightedPath));
          }}
        />
      </div>
      <PaletteModeRow
        pathMode={pathMode}
        tab={tab}
        tabs={Boolean(onOpenAgent && onOpenContext)}
        onTab={(next) => {
          setTab(next);
          setSelected("");
          inputRef.current?.focus();
        }}
      />
      <div className="flex h-[min(32rem,65svh)] min-h-0 flex-col">
        {completions ? (
          <PathList
            completions={completions}
            typed={query}
            searching={under.searching}
            onOpenPath={openContext}
          />
        ) : tab === "agents" ? (
          <AgentList
            agents={agents}
            query={query}
            selected={selected}
            current={current}
            onOpenAgent={(path) => onOpenAgent && onOpen(() => onOpenAgent(path))}
          />
        ) : (
          <ContextPaletteResults
            rows={rows}
            error={error}
            query={query}
            onQueryChange={changeQuery}
            selected={selected}
            current={current}
            nowMs={undefined}
            search={search}
            onOpenPath={openContext}
            fill
          />
        )}
      </div>
    </Command>
  );
}

/** One row under the input, for the tabs or for what the path mode is: the list under it starts
 *  at one height in every mode. */
function PaletteModeRow({
  pathMode,
  tab,
  tabs,
  onTab,
}: {
  pathMode: boolean;
  tab: "agents" | "contexts";
  /** Whether both tabs are there: a Dash with an Agents page and a Contexts page. */
  tabs: boolean;
  onTab: (tab: "agents" | "contexts") => void;
}) {
  return (
    <div className="flex h-9 items-center px-3">
      {pathMode ? (
        <p className="font-readme text-xs text-muted-foreground">
          Paths. <PaletteKey>tab</PaletteKey> completes, <PaletteKey>↵</PaletteKey> opens the raw
          view.
        </p>
      ) : tabs ? (
        <Tabs
          value={tab}
          onValueChange={(next) => onTab(next === "contexts" ? "contexts" : "agents")}
        >
          <TabsList variant="line" aria-label="What to search">
            <TabsTrigger value="agents" className="text-xs">
              Agents
            </TabsTrigger>
            <TabsTrigger value="contexts" className="text-xs">
              Raw contexts
            </TabsTrigger>
          </TabsList>
        </Tabs>
      ) : (
        <p className="text-xs text-muted-foreground">{tab === "agents" ? "Agents" : "Contexts"}</p>
      )}
    </div>
  );
}

/** THE AGENTS TAB: the agents that match, the most recently active first, and the highlighted
 *  one's facts beside them on a wide screen. */
function AgentList({
  agents,
  query,
  selected,
  current,
  onOpenAgent,
}: {
  agents: readonly AgentRow[] | undefined;
  query: string;
  selected: string;
  current: string | undefined;
  onOpenAgent: (path: string) => void;
}) {
  const now = useClock(5_000);
  const found = useMemo(() => findAgents(agents || [], query), [agents, query]);
  const all = useMemo(() => findAgents(agents || [], ""), [agents]);
  const shown = found.slice(0, AGENTS_CAP);
  const highlighted = shown.find((row) => row.path === selected) || shown[0];
  return (
    <>
      <div className="flex min-h-0 flex-1 border-t">
        <CommandList className="max-h-none min-w-0 flex-1 scroll-py-2 p-1.5">
          {!agents ? <PaletteNote>Reading the agents…</PaletteNote> : null}
          {agents && !found.length ? (
            <PaletteNote>
              {query.trim() ? `No agent matches “${query.trim()}”.` : "No agents yet."}
            </PaletteNote>
          ) : null}
          {shown.length ? (
            <CommandGroup
              className="p-0"
              heading={
                <span className="flex items-center justify-between gap-2 font-normal">
                  <span>{query.trim() ? "Agents that match" : "Most recently active"}</span>
                  <span className="tabular-nums">{found.length.toLocaleString("en")}</span>
                </span>
              }
            >
              {shown.map((row) => (
                <AgentItem
                  key={row.path}
                  row={row}
                  nowMs={now}
                  current={row.path === current}
                  onOpenAgent={onOpenAgent}
                />
              ))}
              <More shown={shown.length} total={found.length} />
            </CommandGroup>
          ) : null}
        </CommandList>
        {highlighted ? <AgentFacts row={highlighted} /> : null}
      </div>
      <Footer keys={<OpenKeys />}>
        {agents
          ? `${all.length.toLocaleString("en")} ${all.length === 1 ? "agent" : "agents"}`
          : ""}
      </Footer>
    </>
  );
}

/** An agent: its status and title, then its path and what it does now. */
function AgentItem({
  row,
  nowMs,
  current,
  onOpenAgent,
}: {
  row: AgentRow;
  nowMs: number;
  current: boolean;
  onOpenAgent: (path: string) => void;
}) {
  const doing = agentDoing(row, nowMs);
  const at = row.lastActivityAt || row.createdAt;
  return (
    <CommandItem value={row.path} className={PALETTE_ROW} onSelect={() => onOpenAgent(row.path)}>
      <span
        aria-hidden
        data-agent-status={row.status || undefined}
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          row.status && STATUS_DOT[row.status],
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{agentTitle(row)}</span>
          {current ? (
            <span className="shrink-0 text-xs text-muted-foreground">· open now</span>
          ) : null}
        </span>
        <span className="min-w-0 text-2xs text-muted-foreground">
          <ContextPathText path={row.path} />
          {doing ? <span className="max-sm:hidden"> · {doing}</span> : null}
        </span>
      </span>
      <time dateTime={at} className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {row.status === "working" ? "working" : timeAgo(at, nowMs)}
      </time>
    </CommandItem>
  );
}

/** The highlighted agent's facts, on a wide screen. */
function AgentFacts({ row }: { row: AgentRow }) {
  const facts: [string, string | null][] = [
    ["Status", row.status],
    ["Kind", row.kind],
    ["Doing", row.activity],
    ["Runs on", row.host],
    ["Last active", row.lastActivityAt && new Date(row.lastActivityAt).toLocaleString()],
  ];
  return (
    <aside
      aria-label="The highlighted agent"
      className="hidden w-96 shrink-0 flex-col gap-3 overflow-y-auto border-l bg-muted/30 p-4 text-xs lg:flex"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{agentTitle(row)}</p>
        <p className="font-mono text-2xs break-all text-muted-foreground">{row.path}</p>
      </div>
      {row.description ? <p className="font-readme">{row.description}</p> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {facts.map(([name, value]) =>
          value ? (
            <div key={name} className="contents">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </aside>
  );
}

/** THE PATH MODE: one compact row per path, whole, in the fixed-width face, with how many
 *  contexts are below it. With no match, the row that opens the typed path. */
function PathList({
  completions,
  typed,
  searching,
  onOpenPath,
}: {
  completions: { entries: PathEntry[]; total: number };
  typed: string;
  searching: boolean;
  onOpenPath: (path: string) => void;
}) {
  const now = useClock(5_000);
  const { entries, total } = completions;
  const open = entries.length ? undefined : typedPathOf(typed);
  return (
    <>
      <CommandList className="max-h-none min-h-0 flex-1 scroll-py-1 border-t p-1">
        {entries.map((entry) => (
          <CommandItem
            key={entry.path}
            value={entry.path}
            onSelect={() => onOpenPath(entry.path)}
            className="items-start gap-2 rounded-sm px-2 py-1 data-selected:bg-muted data-selected:shadow-[inset_2px_0_0_var(--foreground)] [&>svg:last-child]:hidden"
          >
            <ContextPathText
              path={entry.below ? `${entry.path}/` : entry.path}
              className={cn("min-w-0 flex-1 text-xs", !entry.context && "text-muted-foreground")}
            />
            <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
              {entry.below ? `${entry.below.toLocaleString("en")} below · ` : null}
              {timeAgo(entry.activeAt, now)}
            </span>
          </CommandItem>
        ))}
        <More shown={entries.length} total={total} />
        {open ? (
          <CommandItem value={open} className={PALETTE_ROW} onSelect={() => onOpenPath(open)}>
            <CornerDownLeftIcon className="mt-0.5 size-3.5 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              Open <ContextPathText path={open} className="text-xs" />
            </span>
          </CommandItem>
        ) : null}
        {!entries.length && !open ? <PaletteNote>No context has this path.</PaletteNote> : null}
      </CommandList>
      <Footer
        keys={
          <>
            <PaletteKey>↑</PaletteKey>
            <PaletteKey>↓</PaletteKey>
            <span className="mr-2">move</span>
            <PaletteKey>tab</PaletteKey>
            <span className="mr-2">complete</span>
            <PaletteKey>↵</PaletteKey>
            <span className="mr-2">open</span>
            <PaletteKey>esc</PaletteKey>
            <span>close</span>
          </>
        }
      >
        {searching
          ? "Searching the mind…"
          : `${total.toLocaleString("en")} ${total === 1 ? "path" : "paths"}`}
      </Footer>
    </>
  );
}

/** "12 more. Type more to narrow." under a list that shows fewer than match. */
function More({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <p className="px-2 py-1.5 font-readme text-xs text-muted-foreground">
      {(total - shown).toLocaleString("en")} more. Type more to narrow.
    </p>
  );
}

function OpenKeys() {
  return (
    <>
      <PaletteKey>↑</PaletteKey>
      <PaletteKey>↓</PaletteKey>
      <span className="mr-2">move</span>
      <PaletteKey>↵</PaletteKey>
      <span className="mr-2">open</span>
      <PaletteKey>/</PaletteKey>
      <span className="mr-2">path</span>
      <PaletteKey>esc</PaletteKey>
      <span>close</span>
    </>
  );
}

/** The keys, and a count at the end. */
function Footer({ keys, children }: { keys: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-2xs text-muted-foreground">
      <span className="flex items-center gap-1.5 max-sm:hidden" aria-hidden>
        {keys}
      </span>
      <span className="ml-auto tabular-nums">{children}</span>
    </div>
  );
}
