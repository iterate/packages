// The mind's contexts as a list, the most recently active first: each row a dot while it is awake,
// its title when it has one, its path, how long ago it was active, and its description or its last
// event types (`ListRowText`, as the Agents list draws a row). One input over it narrows the rows
// by any word of a path, a description, an event type, a processor or the metadata. Pure: the rows
// (`useContextCatalog`), the current path and where a path links are props, so a sidebar, a page
// and a dialog draw the same list. `useContextCatalog` reads the rows.
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import {
  activeAtOf,
  contextListingsOf,
  contextRowDetail,
  contextTitle,
  filterContextListings,
  timeAgo,
  type ContextListing,
} from "./context-catalog-rows.ts";
import { AwakeDot } from "#/components/context-view/awake-dot.tsx";
import { PathLink, type ContextPathLinks } from "#/components/context-view/context-path.tsx";
import { ListRowText, pxPerRem } from "#/components/list-row-text.tsx";
import { Input } from "#/components/ui/input.tsx";

export function ContextCatalog({
  rows,
  current,
  links,
  className,
}: {
  /** The catalog's rows, the most recently active first; undefined while the first read is on
   *  its way. */
  rows: readonly ContextListing[] | undefined;
  /** The path shown. */
  current?: string;
  links: ContextPathLinks;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const nowMs = useNow(5_000);
  const shown = filterContextListings(rows || [], query);
  return (
    <nav aria-label="Recent contexts" className={cn("flex min-h-0 flex-col gap-1.5", className)}>
      <Input
        aria-label="Filter contexts"
        placeholder="Filter by path, description, event type…"
        className="h-8 text-xs md:text-xs"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setQuery("");
        }}
      />
      <ContextCatalogList rows={shown} current={current} links={links} nowMs={nowMs} />
      <p className="px-2 text-2xs text-muted-foreground">
        {!rows
          ? "Loading contexts…"
          : query.trim()
            ? `${String(shown.length)} of ${String(rows.length)} contexts`
            : `${String(rows.length)} contexts, ${String(rows.filter((row) => row.awake).length)} awake`}
      </p>
    </nav>
  );
}

/** The rows alone, as a virtual list: only the rows in view are in the DOM. Each row is as tall as
 *  its lines (`rowRem`), so the list positions the rows without measuring them. */
export function ContextCatalogList({
  rows,
  current,
  links,
  nowMs,
}: {
  rows: readonly ContextListing[];
  current?: string;
  links: ContextPathLinks;
  nowMs: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // the rem in px, read once, when the list mounts
  const [rem] = useState(pxPerRem);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rowRem(rows[index]!) * rem,
    getItemKey: (index) => rows[index]!.path,
    overscan: 12,
  });
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto text-xs">
      <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <li
            key={virtualItem.key}
            className="absolute top-0 left-0 w-full"
            style={{
              height: `${String(rowRem(rows[virtualItem.index]!))}rem`,
              transform: `translateY(${String(virtualItem.start)}px)`,
            }}
          >
            <ContextCatalogRow
              row={rows[virtualItem.index]!}
              current={current}
              links={links}
              nowMs={nowMs}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One row of the list: its dot while it is awake, then its title when it has one, its path and
 *  its description, else its last event types, else how many events it has (`ListRowText`). */
export function ContextCatalogRow({
  row,
  current,
  links,
  nowMs,
}: {
  row: ContextListing;
  current: string | undefined;
  links: ContextPathLinks;
  nowMs: number;
}) {
  const activeAt = activeAtOf(row);
  return (
    <PathLink
      path={row.path}
      links={links}
      aria-current={row.path === current ? "page" : undefined}
      className="flex h-full min-w-0 flex-col justify-center rounded-md px-2 hover:bg-muted/60 aria-[current=page]:bg-muted"
    >
      <span className="flex min-w-0 items-start gap-1.5">
        <AwakeDot awake={Boolean(row.awake)} className="mt-1.5" />
        <ListRowText
          title={contextTitle(row)}
          path={row.path}
          line={contextRowDetail(row) || `${String(row.eventCount)} events`}
          className="text-foreground/90"
          time={
            <time
              dateTime={activeAt}
              title={activeAt}
              className="shrink-0 text-2xs text-muted-foreground tabular-nums"
            >
              {row.awake ? "awake" : timeAgo(activeAt, nowMs)}
            </time>
          }
        />
      </span>
    </PathLink>
  );
}

/** A row's height, in rem, as its text is: a title (`text-xs`, 1rem), the path and the last line
 *  (`text-2xs`, 1rem each) and 0.75rem of space. A row without a title has the path on its first
 *  line, so it is one line shorter. A browser set to a larger default font makes the text taller,
 *  and the row with it. */
function rowRem(row: ContextListing): number {
  return contextTitle(row) ? 3.75 : 2.75;
}

/** The time, read again every `everyMs`: what "3 min ago" is counted from. */
function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** The catalog's rows as `list` answers them (`() => root.contexts.list({ limit: 500 })`), asked
 *  again every `pollMs` while the page is visible and when it becomes visible. `of` names whose
 *  catalog it is (the mind's address): another name asks at once. `rows` is undefined until the
 *  first answer; a later failure keeps the rows and says the `error`. `list` null asks nothing. */
export function useContextCatalog(
  list: (() => PromiseLike<unknown>) | null,
  { of, pollMs = 10_000 }: { of: string; pollMs?: number },
): { rows: ContextListing[] | undefined; error: string | undefined } {
  const [state, setState] = useState<{ of?: string; rows?: ContextListing[]; error?: string }>({});
  const ask = useEffectEvent(async () => {
    if (!list || document.visibilityState !== "visible") return;
    try {
      const rows = contextListingsOf(await list());
      setState({ of, rows });
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught);
      setState((before) => ({ of, rows: before.of === of ? before.rows : undefined, error }));
    }
  });
  const enabled = Boolean(list);
  useEffect(() => {
    if (!enabled) return;
    void ask();
    const timer = setInterval(() => void ask(), pollMs);
    const onVisible = () => void ask();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, of, pollMs]);
  // another mind's rows are not this one's
  return state.of === of
    ? { rows: state.rows, error: state.error }
    : { rows: undefined, error: undefined };
}
