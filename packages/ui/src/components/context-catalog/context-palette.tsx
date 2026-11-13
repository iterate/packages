// ⌘K for a mind's contexts: one dialog that shows what works now and what was active in the last
// five minutes, and searches every context as you type. Each row has two lines:
//
//   ● Fix the flaky stack smoke check                                        working
//     /agents/claude/fix-the-smoke-check · hook received
//
// Line one is the description, and line two the path, then what the context last did. A row
// without a description shows its path on line one, and line two says only what it last did. A
// path is one plain path in the fixed-width face (`ContextPathText`), whole: a long one wraps.
// While you type, chips under the input narrow the search to one top
// folder, and a path that no context has gets a row that opens it. On a wide screen a pane beside
// the list shows the facts of the highlighted row (`ContextFacts`). Which rows show, in which
// order, is context-palette-rows.ts.
//
// The dialog is Dialog's parts and cmdk's input, composed here, as app-shell-palette.tsx does and
// for its reasons: upstream's CommandDialog puts its sr-only title outside the popup, and its
// CommandInput takes no className for its wrapper. Pure: the rows, whether it is open and what
// opening a path does are props. `AppShell`'s `palette` puts it in place of the shell's own.
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { CornerDownLeftIcon, SearchIcon } from "lucide-react";
import { cn } from "cn";
import { ContextFacts } from "./context-about.tsx";
import {
  activeAtOf,
  contextListingsOf,
  timeAgo,
  type ContextListing,
} from "./context-catalog-rows.ts";
import {
  contextPaletteView,
  freeWordsOf,
  markedRanges,
  queryWithFolder,
  rowNoteOf,
  type FolderChip,
  type PaletteSection,
} from "./context-palette-rows.ts";
import { ContextPathText } from "#/components/context-path-text.tsx";
import { Command, CommandGroup, CommandItem, CommandList } from "#/components/ui/command.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";

/** How long typing rests before the palette asks the mind's own search. */
const SEARCH_DEBOUNCE_MS = 200;
/** How often the open palette reads the clock: what "3 min" and "the last 5 minutes" count from. */
const CLOCK_MS = 5_000;
/** The preview pane's event types: the most frequent this many. */
const PREVIEW_TYPES = 8;
/** The value of the row that opens a typed path. A context's value is its path, which starts
 *  with "/", so the two never meet. */
const OPEN_PATH_VALUE = "open-typed-path";

export function ContextPalette({
  rows,
  error,
  open,
  onOpenChange,
  onOpenPath,
  current,
  nowMs,
  search,
}: {
  /** The catalog's rows (`useContextCatalog`); undefined while the first read is on its way. */
  rows: readonly ContextListing[] | undefined;
  /** Why the catalog did not load (`useContextCatalog`'s `error`). With no rows, the palette
   *  says that the mind has no catalog, and a typed path still opens. */
  error?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens a context. The palette closes itself first. */
  onOpenPath: (path: string) => void;
  /** The path the page shows now: its row says "open now". */
  current?: string;
  /** What "now" is. Without it the palette reads the clock when it opens and every 5 s. */
  nowMs?: number;
  /** The mind's own search, for a mind with more contexts than the page holds:
   *  `(query) => itx.contexts.list({ search: query, limit: 200 })`. The palette asks it 200 ms
   *  after typing rests, and lists its rows beside the page's own matches. */
  search?: (query: string) => PromiseLike<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // near the top, not centred: the list grows and shrinks under the input as you type
        className="top-3 translate-y-0 gap-0 overflow-hidden p-0 sm:top-[10svh] sm:max-w-2xl lg:max-w-5xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Contexts</DialogTitle>
          <DialogDescription>
            Contexts active in the last five minutes. Type to search every context.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <PaletteBody
            rows={rows}
            error={error}
            onOpenPath={(path) => {
              onOpenChange(false);
              onOpenPath(path);
            }}
            current={current}
            nowMs={nowMs}
            search={search}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted per opening, so the query starts empty and the clock is read again each time. */
function PaletteBody({
  rows,
  error,
  onOpenPath,
  current,
  nowMs,
  search,
}: {
  rows: readonly ContextListing[] | undefined;
  error: string | undefined;
  onOpenPath: (path: string) => void;
  current: string | undefined;
  nowMs: number | undefined;
  search: ((query: string) => PromiseLike<unknown>) | undefined;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const clock = useClock(CLOCK_MS);
  const now = nowMs ?? clock;
  const found = useMindSearch(query, search);
  // with no catalog, only a typed path is listed
  const view = useMemo(
    () => contextPaletteView({ rows: rows || [], found: found.answer, query, nowMs: now }),
    [rows, found.answer, query, now],
  );
  const sections = useMemo(() => (rows ? view.sections : []), [rows, view]);
  const shown = useMemo(() => sections.flatMap((part) => part.rows), [sections]);
  const words = useMemo(() => freeWordsOf(query), [query]);
  // the highlighted row; the first while cmdk has not said
  const highlighted = shown.find((row) => row.path === selected) || shown[0];
  const chooseFolder = (folder: string | undefined) => {
    setQuery((before) => queryWithFolder(before, folder));
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
          className="flex h-8 w-full min-w-0 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
          placeholder="Search contexts: name, path, event, processor"
          aria-label="Search contexts"
          value={query}
          onValueChange={setQuery}
        />
      </div>
      {view.folders.length ? <FolderChips chips={view.folders} onChoose={chooseFolder} /> : null}
      {/* with a preview the height holds still, so the pane does not jump as the list changes */}
      <div className={cn("flex min-h-0 border-t", highlighted && "lg:h-[min(36rem,70svh)]")}>
        <CommandList
          className={cn(
            "max-h-[min(34rem,70svh)] min-w-0 flex-1 scroll-py-2 p-1.5",
            highlighted && "lg:max-h-none",
          )}
        >
          <CatalogNote listed={Boolean(rows)} error={error} quiet={view.quiet} />
          {sections.map((part, index) => (
            <Section
              key={part.heading}
              part={part}
              first={index === 0}
              words={words}
              nowMs={now}
              current={current}
              onOpenPath={onOpenPath}
            />
          ))}
          {view.openPath ? <OpenPathRow path={view.openPath} onOpenPath={onOpenPath} /> : null}
          {rows && query.trim() && !sections.length && !view.openPath ? (
            <Note>No context matches “{query.trim()}”.</Note>
          ) : null}
        </CommandList>
        {highlighted ? <Preview row={highlighted} /> : null}
      </div>
      <Footer count={rows?.length} searching={found.searching} chips={view.folders.length > 0} />
    </Command>
  );
}

/** The chips of the top folders under the input. A chip narrows to its folder; the chosen one
 *  takes it out again. Tab reaches them from the input. */
function FolderChips({
  chips,
  onChoose,
}: {
  chips: FolderChip[];
  onChoose: (folder: string | undefined) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Narrow to a folder"
      className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 pb-2.5"
    >
      {chips.map((chip) => (
        <button
          key={chip.folder}
          type="button"
          aria-pressed={chip.active}
          className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-2xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
          onClick={() => onChoose(chip.active ? undefined : chip.folder)}
          // cmdk's own Enter would open the highlighted row instead of pressing the chip
          onKeyDown={(event) => event.stopPropagation()}
        >
          /{chip.folder}
          <span className="tabular-nums opacity-70">{chip.count.toLocaleString("en")}</span>
        </button>
      ))}
    </div>
  );
}

/** One section: its heading with its count (and how many work now), its rows, and how many more
 *  match than it shows. */
function Section({
  part,
  first,
  words,
  nowMs,
  current,
  onOpenPath,
}: {
  part: PaletteSection;
  first: boolean;
  words: string[];
  nowMs: number;
  current: string | undefined;
  onOpenPath: (path: string) => void;
}) {
  const more = part.total - part.rows.length;
  return (
    <CommandGroup
      className={cn("p-0", !first && "pt-2")}
      heading={
        <span className="flex items-center justify-between gap-2 font-normal">
          <span>{part.heading}</span>
          <span className="flex items-center gap-1.5 tabular-nums">
            {part.working ? (
              <>
                <span className="size-1.5 rounded-full bg-success" aria-hidden />
                <span>{part.working.toLocaleString("en")} working</span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            <span>{part.total.toLocaleString("en")}</span>
          </span>
        </span>
      }
    >
      {part.rows.map((row) => (
        <PaletteRow
          key={row.path}
          row={row}
          words={words}
          nowMs={nowMs}
          current={row.path === current}
          onOpenPath={onOpenPath}
        />
      ))}
      {more > 0 ? (
        <p className="px-2 py-1.5 font-readme text-xs text-muted-foreground">
          {more.toLocaleString("en")} more. Type more to narrow.
        </p>
      ) : null}
    </CommandGroup>
  );
}

/** The look of a row the keyboard or the pointer highlights: a fill and a bar at its start. */
const ROW = cn(
  "items-start gap-2.5 rounded-md px-2 py-1.5",
  "data-selected:bg-muted data-selected:shadow-[inset_2px_0_0_var(--foreground)]",
  // upstream's check mark: a context row is never "checked"
  "[&>svg:last-child]:hidden",
);

/** A context: what it is and its path, what it last did, and whether it works now. Without a
 *  description, the path is line one and is not said again. */
function PaletteRow({
  row,
  words,
  nowMs,
  current,
  onOpenPath,
}: {
  row: ContextListing;
  words: string[];
  nowMs: number;
  current: boolean;
  onOpenPath: (path: string) => void;
}) {
  const activeAt = activeAtOf(row);
  const path = (
    <ContextPathText path={row.path}>
      <Marked text={row.path} words={words} />
    </ContextPathText>
  );
  return (
    <CommandItem value={row.path} className={ROW} onSelect={() => onOpenPath(row.path)}>
      <span
        aria-hidden
        className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", row.awake && "bg-success")}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          {row.description ? (
            <span className="truncate" title={row.description}>
              <Marked text={row.description} words={words} />
            </span>
          ) : (
            <span className="min-w-0 text-xs">{path}</span>
          )}
          {current ? (
            <span className="shrink-0 text-xs text-muted-foreground">· open now</span>
          ) : null}
        </span>
        {/* a long path wraps, and what the context last did follows it */}
        <span className="min-w-0 text-2xs text-muted-foreground">
          {row.description ? path : null}
          <span className={cn(row.description && "max-sm:hidden")}>
            {row.description ? " · " : null}
            {rowNoteOf(row, words)}
          </span>
        </span>
      </span>
      {row.awake ? (
        <span className="shrink-0 text-xs text-success">working</span>
      ) : (
        <time dateTime={activeAt} className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {timeAgo(activeAt, nowMs)}
        </time>
      )}
    </CommandItem>
  );
}

/** `text` with each typed word underlined where it occurs. */
function Marked({ text, words }: { text: string; words: string[] }) {
  const ranges = markedRanges(text, words);
  if (!ranges.length) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    parts.push(text.slice(at, start));
    parts.push(
      <mark
        key={start}
        className="bg-transparent text-current underline decoration-foreground/40 underline-offset-2"
      >
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(text.slice(at));
  return parts;
}

/** The last row while the query is a path that no context has: Enter opens that path. */
function OpenPathRow({ path, onOpenPath }: { path: string; onOpenPath: (path: string) => void }) {
  return (
    <CommandGroup heading="Path" className="p-0 pt-2">
      <CommandItem value={OPEN_PATH_VALUE} className={ROW} onSelect={() => onOpenPath(path)}>
        <CornerDownLeftIcon className="mt-0.5 size-3.5 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          Open <ContextPathText path={path} className="text-xs" />
        </span>
      </CommandItem>
    </CommandGroup>
  );
}

/** The highlighted row's facts, on a wide screen: what it is and its whole path (the path alone
 *  when it has no description), and `ContextFacts`. */
function Preview({ row }: { row: ContextListing }) {
  return (
    <aside
      aria-label="The highlighted context"
      className="hidden w-96 shrink-0 flex-col gap-3 overflow-y-auto border-l bg-muted/30 p-4 text-xs lg:flex"
    >
      <div className="flex flex-col gap-1">
        {row.description ? <p className="text-sm font-medium">{row.description}</p> : null}
        <p
          className={cn(
            "font-mono break-all",
            row.description ? "text-2xs text-muted-foreground" : "text-sm",
          )}
        >
          {row.path}
        </p>
      </div>
      <ContextFacts row={row} typeLimit={PREVIEW_TYPES} />
    </aside>
  );
}

/** The keys, and how many contexts the page holds (or that the mind is searched). */
function Footer({
  count,
  searching,
  chips,
}: {
  count: number | undefined;
  searching: boolean;
  chips: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-2xs text-muted-foreground">
      <span className="flex items-center gap-1.5 max-sm:hidden" aria-hidden>
        <Key>↑</Key>
        <Key>↓</Key>
        <span className="mr-2">move</span>
        <Key>↵</Key>
        <span className="mr-2">open</span>
        {chips ? (
          <>
            <Key>tab</Key>
            <span className="mr-2">folders</span>
          </>
        ) : null}
        <Key>esc</Key>
        <span>close</span>
      </span>
      <span className="ml-auto tabular-nums">
        {searching
          ? "Searching the mind…"
          : count === undefined
            ? ""
            : `${count.toLocaleString("en")} contexts`}
      </span>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border bg-background px-1 font-sans text-2xs leading-4">{children}</kbd>
  );
}

/** What the list says above its rows: that the catalog loads or is missing, or that nothing was
 *  active in the last five minutes. */
function CatalogNote({
  listed,
  error,
  quiet,
}: {
  listed: boolean;
  error: string | undefined;
  quiet: boolean;
}) {
  if (!listed)
    return (
      <Note>
        {error ? "This mind has no catalog of its contexts yet." : "Reading the catalog…"}
      </Note>
    );
  if (!quiet) return null;
  return (
    <p className="px-2 pt-2 pb-1 font-readme text-sm">Nothing active in the last five minutes.</p>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-6 text-center font-readme text-sm text-muted-foreground">{children}</p>
  );
}

/** The time, read again every `everyMs`. */
function useClock(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** The mind's own answer to `query`, asked once typing rests. `answer` is the newest answer, for
 *  the query it was asked with; `searching` is true while the newest query has none yet. A failed
 *  search counts as an answer with no rows: the page's own matches still show. */
function useMindSearch(
  query: string,
  search: ((query: string) => PromiseLike<unknown>) | undefined,
) {
  const [answer, setAnswer] = useState<{ query: string; rows: ContextListing[] }>();
  const ask = useEffectEvent((asked: string) => search?.(asked));
  const enabled = Boolean(search);
  const asked = query.trim();
  useEffect(() => {
    if (!enabled || !asked) return;
    let current = true;
    const timer = setTimeout(() => {
      ask(asked)?.then(
        (rows) => {
          if (current) setAnswer({ query: asked, rows: contextListingsOf(rows) });
        },
        () => {
          if (current) setAnswer({ query: asked, rows: [] });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [enabled, asked]);
  return { answer, searching: enabled && Boolean(asked) && answer?.query !== asked };
}
