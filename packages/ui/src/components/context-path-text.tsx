// A context path as the kit shows it everywhere: one plain path from the root, in the fixed-width
// face, in one colour and weight: `/agents/claude/fix-the-smoke-check`. No separators, no
// segments of their own, no shortened ids, and never cut at its start: on screen a path always
// starts with "/".
//
// A path that does not fit wraps onto further lines, so it is always whole and two contexts never
// read the same. Where one line is a hard limit (a tree's row, a nav's line, a button), `truncate`
// cuts it at its END instead. The title holds the whole path.
import type { ReactNode } from "react";
import { cn } from "cn";

export function ContextPathText({
  path,
  truncate = false,
  className,
  children,
}: {
  path: string;
  /** One line at most: the path is cut at its end. Its box must be a block or a flex item. */
  truncate?: boolean;
  className?: string;
  /** What shows, when it is not `path` as it is: `path` with marks, or `path` as links. The
   *  characters must be the path's own. */
  children?: ReactNode;
}) {
  return (
    <span
      title={path}
      className={cn(
        "font-mono",
        truncate ? "block min-w-0 truncate" : "break-all whitespace-normal",
        className,
      )}
    >
      {children ?? path}
    </span>
  );
}
