import { cn } from "cn";

/** A dot for a context that has work now; the same room, empty, for one that has none, so paths
 *  line up. */
export function AwakeDot({ awake, className }: { awake: boolean; className?: string }) {
  return (
    <span
      role={awake ? "img" : undefined}
      aria-label={awake ? "awake" : undefined}
      className={cn("size-1.5 shrink-0 rounded-full", awake && "bg-success", className)}
    />
  );
}
