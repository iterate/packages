// How far a read of the log has come: a read of a long context can take a while, and a person should
// see it moving.
export function ReadProgress({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground"
    >
      <span className="shrink-0 tabular-nums">
        {label}… {percent}%
      </span>
      <span className="h-1 min-w-0 flex-1 overflow-hidden bg-muted">
        <span
          className="block h-full bg-primary transition-[width] duration-300"
          style={{ width: `${String(percent)}%` }}
        />
      </span>
    </div>
  );
}
