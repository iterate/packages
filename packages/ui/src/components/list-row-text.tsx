// The text of one row of a list of contexts, the same in the Agents list and the Contexts list:
//
//   Title            now      a title, when the row has one
//   /the/path                 the path, always (`ContextPathText`, cut at its end when it is long)
//   line                      what the row is doing now, else what it is for
//
// A row without a title starts with its path, with the time beside it. The first line takes the
// font size of the row; the path under a title and the last line are `text-2xs`. The list puts the
// icon or dot beside it, and the link around it.
import type { ReactNode } from "react";
import { cn } from "cn";
import { ContextPathText } from "#/components/context-path-text.tsx";

export function ListRowText({
  title,
  path,
  line,
  time,
  className,
}: {
  /** A short name; none puts the path on the first line. */
  title?: string | null;
  path: string;
  /** The last line, when the row has one. */
  line?: ReactNode;
  /** At the right of the first line: when the row was last active, as the list says it. */
  time?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 flex-1 flex-col", className)}>
      <span className="flex min-w-0 items-baseline gap-2">
        {title ? (
          <span className="min-w-0 flex-1 truncate">{title}</span>
        ) : (
          <ContextPathText path={path} truncate className="flex-1" />
        )}
        {time}
      </span>
      {title ? (
        <ContextPathText path={path} truncate className="text-2xs text-muted-foreground" />
      ) : null}
      {line ? (
        <span
          className="truncate text-2xs text-muted-foreground"
          title={typeof line === "string" ? line : undefined}
        >
          {line}
        </span>
      ) : null}
    </span>
  );
}

// also exported here: code outside this repository (a mind's Dash) imports `pxPerRem` from this module
export { pxPerRem } from "#/lib/px-per-rem.ts";
