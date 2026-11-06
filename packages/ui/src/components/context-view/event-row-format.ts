import { cn } from "cn";

/** The row's clock: `19:36:58` in the reader's zone, always the 24-hour cycle — eight characters
 *  that fit the fixed column in every locale (a 12-hour locale's ` PM` would run into the delta). */
export function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

/** `+950ms`, `+3.2s`, `+1m40s`, `+2h5m` — the compact gap between two rows. */
export function formatDelta(ms: number): string {
  if (ms < 1_000) return `+${String(ms)}ms`;
  if (ms < 60_000) return `+${(Math.floor(ms / 100) / 10).toFixed(1).replace(/\.0$/, "")}s`;
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 3_600) return `+${String(Math.floor(seconds / 60))}m${String(seconds % 60)}s`;
  const minutes = Math.floor(seconds / 60);
  return `+${String(Math.floor(minutes / 60))}h${String(minutes % 60)}m`;
}

/** The frame every row shares: full width, the columns on one line from `sm` (a phone wraps the
 *  body above the rest), 26px tall, the hover, the inspected row's left bar. Rows are buttons
 *  (inspect, or open a fold). */
export const rowClass = (selected?: boolean) =>
  cn(
    "flex w-full min-w-0 flex-wrap items-baseline gap-x-3.5 px-3 sm:px-4 py-[3px] text-left hover:bg-muted/60 max-sm:gap-x-2 max-sm:py-1.5 sm:flex-nowrap",
    selected && "bg-muted shadow-[inset_2px_0_0_var(--color-foreground)] hover:bg-muted",
  );
