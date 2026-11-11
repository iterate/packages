// setup-steps.tsx — the steps of a setup flow, beside its content: each done one a green tick with what was
// done under it, the current one a dark number with its parts under it, any reached one a way back. On a
// phone the list gives way to SetupProgress, a bar of segments under the header.
import type { ReactNode } from "react";
import { Check, Pencil } from "lucide-react";
import { cn } from "cn";

/** One part of the current step. `accent` marks the part to do now in Cloudflare's orange. */
export type SetupSubstep = {
  id: string;
  title: string;
  state: "done" | "now" | "todo";
  accent?: boolean;
  onSelect?: () => void;
};
export type SetupStep = {
  id: string;
  title: string;
  /** What was chosen at a done step (an account's name, a domain), on one line under its title. */
  summary?: ReactNode;
  /** The step can be opened again: a quiet pencil beside the summary, and this word ("Change") for
   *  a screen reader and the tooltip. The whole step is the control. */
  change?: string;
  /** The parts of the step, shown while it is the current one. */
  substeps?: SetupSubstep[];
};

/** The list. `current` is the step on screen; `reached` the furthest one so far (each up to it is a
 *  link back); `finished` ticks them all. */
export function SetupSteps({
  steps,
  current,
  reached,
  finished = false,
  onSelect,
  className,
}: {
  steps: SetupStep[];
  current: number;
  reached: number;
  finished?: boolean;
  onSelect: (index: number) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Steps" className={className}>
      <ol className="space-y-1">
        {steps.map((step, i) => {
          const done = finished || i < current;
          const now = !finished && i === current;
          const back = i <= reached && !now;
          return (
            <li key={step.id} className="relative">
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute top-[2.375rem] -bottom-2.5 left-[11px] w-0.5 rounded-full",
                    done ? "bg-success" : "bg-border",
                  )}
                />
              )}
              <button
                type="button"
                disabled={!back}
                onClick={() => onSelect(i)}
                aria-current={now ? "step" : undefined}
                title={done && step.summary && back ? step.change : undefined}
                className={cn(
                  "group -mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-lg px-2 py-2.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  back ? "hover:bg-muted" : "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums",
                    done
                      ? "bg-success text-white"
                      : now
                        ? "bg-primary text-primary-foreground"
                        : "border border-input bg-background text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="mt-0.5 min-w-0">
                  <span
                    className={cn(
                      "block",
                      now ? "font-semibold" : done ? "" : "text-muted-foreground",
                    )}
                  >
                    {step.title}
                  </span>
                  {done && step.summary && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="min-w-0 break-words">{step.summary}</span>
                      {back && step.change && (
                        <>
                          <Pencil
                            aria-hidden
                            className="size-3 shrink-0 opacity-40 group-hover:opacity-100 group-focus-visible:opacity-100"
                          />
                          <span className="sr-only">{step.change}</span>
                        </>
                      )}
                    </span>
                  )}
                </span>
              </button>
              {now && !!step.substeps?.length && (
                <ol className="mb-1.5 ml-9 space-y-1.5 text-sm">
                  {step.substeps.map((sub) => (
                    <Substep key={sub.id} sub={sub} />
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Substep({ sub }: { sub: SetupSubstep }) {
  const row = (
    <>
      <span aria-hidden className="grid size-4 shrink-0 place-items-center">
        {sub.state === "done" ? (
          <Check className="size-3.5 text-success" strokeWidth={3} />
        ) : (
          <span
            className={cn(
              "size-2 rounded-full",
              sub.state === "todo"
                ? "border border-muted-foreground/50"
                : sub.accent
                  ? "bg-cloudflare"
                  : "bg-primary",
            )}
          />
        )}
      </span>
      <span className={sub.state === "now" ? "font-medium" : "text-muted-foreground"}>
        {sub.title}
        {sub.state === "done" && <span className="sr-only"> (done)</span>}
      </span>
    </>
  );
  return (
    <li
      data-substep={sub.state}
      aria-current={sub.state === "now" ? "true" : undefined}
      className="flex items-center gap-2"
    >
      {sub.onSelect ? (
        <button
          type="button"
          onClick={sub.onSelect}
          className="flex items-center gap-2 rounded-sm text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {row}
        </button>
      ) : (
        row
      )}
    </li>
  );
}

/** A phone's progress: one segment per step, the done ones green, the current one dark. */
export function SetupProgress({
  count,
  current,
  finished = false,
  className,
}: {
  count: number;
  current: number;
  finished?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1", className)} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1 flex-1 rounded-full",
            finished || i < current ? "bg-success" : i === current ? "bg-primary" : "bg-border",
          )}
        />
      ))}
    </div>
  );
}
