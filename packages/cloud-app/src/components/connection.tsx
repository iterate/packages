import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import type { LiveStateResult } from "iterate/react";

/** What a page shows while its live state is not live: never a silent, stale page. */
export function Connection({
  live,
}: {
  live: Pick<LiveStateResult, "status" | "value" | "error">;
}) {
  if (live.status === "live") return null;
  if (live.status === "error")
    return (
      <span className="font-readme text-sm text-destructive">
        {live.error || "The connection failed."}
      </span>
    );
  return (
    <span className="flex items-center gap-2 font-readme text-sm text-muted-foreground">
      <Spinner /> {live.value ? "Reconnecting…" : "Connecting…"}
    </span>
  );
}
