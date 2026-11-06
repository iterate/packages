// The context tree: every context an app knows (a project's registry, the global namespace's
// announced children) as an indented tree, `/` first, the one shown marked — the explorer's
// navigation. One input over it, "Filter or go to a path": typing
// narrows the tree to the paths that contain it; Enter opens the one match, else the path typed,
// resolved against the one shown by the caller's `resolvePath` (the SDK's `resolveContextPath`, so
// `..` and `/agents/x` work); "/" anywhere on the page focuses it. A segment no context sits at
// (`/agents` over `/agents/web`) is a heading, not a link. Pure: the paths, the current one and
// where a path links (`ContextPathLinks`) are props.
//
// `ContextTree` is the pane (a wide screen's left column); `ContextTreeSheet` is a phone's: the path
// as a button that opens the same tree in a left Sheet.
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { navigateToPath, type ContextPathLinks } from "./context-path-links.ts";
import { PathLink } from "./context-path.tsx";
import { contextTreeRows, type TreeRow } from "./context-tree-rows.ts";
import { Input } from "#/components/ui/input.tsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#/components/ui/sheet.tsx";

export function ContextTree({
  paths,
  current,
  links,
  resolvePath,
  className,
}: {
  /** Every context path known; `/` is always listed. */
  paths: readonly string[];
  /** The path shown. */
  current: string;
  links: ContextPathLinks;
  /** A typed path, resolved against the one shown (`resolveContextPath(current, typed)`). */
  resolvePath: (typed: string) => string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => contextTreeRows(paths), [paths]);
  const total = rows.filter((row) => row.context).length;
  const needle = query.trim();
  // filtered, the matches read flat, as whole paths
  const matches = needle
    ? rows.filter((row) => row.context && row.path.includes(needle))
    : undefined;
  // "/" focuses the input from anywhere but a field of the page's own
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select, [role=textbox]"))
      )
        return;
      const input = inputRef.current;
      if (!input?.offsetParent) return; // hidden (the other breakpoint's tree)
      event.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <nav aria-label="Contexts" className={cn("flex min-h-0 flex-col gap-1.5", className)}>
      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          if (!needle) return;
          const only = matches?.length === 1 ? matches[0]!.path : undefined;
          setQuery("");
          navigateToPath(links, only || resolvePath(needle), event);
        }}
      >
        <Input
          ref={inputRef}
          aria-label="Filter or go to a path"
          placeholder="Filter or go to a path"
          className="h-8 pr-9 font-mono text-xs md:text-xs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
        />
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1 font-sans text-2xs text-muted-foreground">
          {needle ? "↵ go" : "/"}
        </kbd>
      </form>
      <TreeList rows={matches || rows} flat={Boolean(matches)} current={current} links={links} />
      <p className="px-2 text-2xs text-muted-foreground">
        {matches
          ? `${String(matches.length)} of ${String(total)} contexts`
          : total > 1
            ? `${String(total)} contexts`
            : "Contexts show up here as they're created."}
      </p>
    </nav>
  );
}

/** Each row's height: `h-[26px]` below. */
const TREE_ROW_HEIGHT = 26;
const TREE_ROW = "flex h-[26px] min-w-0 items-center rounded-md pr-2 whitespace-nowrap";

/** The paths as a virtual list: a project's contexts grow with every call and every agent, and only
 *  the rows in view are in the DOM. */
function TreeList({
  rows,
  flat,
  current,
  links,
}: {
  rows: readonly TreeRow[];
  /** Filtered: the matches read flat, as whole paths. */
  flat: boolean;
  current: string;
  links: ContextPathLinks;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TREE_ROW_HEIGHT,
    getItemKey: (index) => rows[index]!.path,
    overscan: 16,
  });
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto font-mono text-xs">
      <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <li
            key={virtualItem.key}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${String(virtualItem.start)}px)` }}
          >
            <TreeRowLink
              item={rows[virtualItem.index]!}
              flat={flat}
              current={current}
              links={links}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TreeRowLink({
  item,
  flat,
  current,
  links,
}: {
  item: TreeRow;
  flat: boolean;
  current: string;
  links: ContextPathLinks;
}) {
  const label = (
    <span
      style={{ paddingLeft: `${String(8 + (flat ? 0 : item.depth) * 12)}px` }}
      className="truncate"
    >
      {flat ? item.path : item.name}
    </span>
  );
  if (!item.context) return <span className={cn(TREE_ROW, "text-muted-foreground")}>{label}</span>;
  return (
    <PathLink
      path={item.path}
      links={links}
      aria-label={item.path}
      aria-current={item.path === current ? "page" : undefined}
      className={cn(
        TREE_ROW,
        "text-foreground/85 hover:bg-muted/60 aria-[current=page]:bg-muted aria-[current=page]:font-semibold aria-[current=page]:text-foreground",
      )}
    >
      {label}
    </PathLink>
  );
}

/** A phone's tree: the path shown, as a button, opening the tree in a left Sheet that closes as a
 *  path is picked. */
export function ContextTreeSheet({ className, ...tree }: Parameters<typeof ContextTree>[0]) {
  const [open, setOpen] = useState(false);
  const links = useMemo(
    (): ContextPathLinks => ({
      hrefOf: tree.links.hrefOf,
      onNavigate: (href, event) => {
        setOpen(false);
        if (tree.links.onNavigate) tree.links.onNavigate(href, event);
        else window.location.assign(href);
      },
    }),
    [tree.links],
  );
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className={cn(
          "flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-sm",
          className,
        )}
        aria-label={`Contexts: ${tree.current}`}
      >
        <span className="truncate">{tree.current}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </SheetTrigger>
      <SheetContent side="left" className="gap-2 p-3">
        <SheetHeader className="p-1">
          <SheetTitle>Contexts</SheetTitle>
        </SheetHeader>
        <ContextTree {...tree} links={links} className="flex-1" />
      </SheetContent>
    </Sheet>
  );
}
