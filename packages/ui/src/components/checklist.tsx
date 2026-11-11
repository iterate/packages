// checklist.tsx — a list of things that must be true before going on, each with what makes it so:
// a link out or a button. An item turns done by itself when whatever watches it says so; the page
// that renders it does the watching.
import type { ComponentProps, ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { cn } from "cn";
import { Spinner } from "#/components/ui/spinner.tsx";

/** done; todo (not yet); checking (no answer yet); unknown (the check itself failed). */
export type ChecklistState = "done" | "todo" | "checking" | "unknown";

/** The state in words, for a screen reader: the icon alone says it only to the eye. */
const SPOKEN: Record<ChecklistState, string> = {
  done: "Done",
  todo: "Not done",
  checking: "Checking",
  unknown: "Not known",
};

export function Checklist({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="checklist"
      className={cn(
        "divide-y overflow-hidden rounded-xl border bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** One item. Its action shows until it is done: beside the text, or under it on a phone. */
export function ChecklistItem({
  state,
  title,
  description,
  action,
  className,
  ...props
}: Omit<ComponentProps<"li">, "title"> & {
  state: ChecklistState;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li
      data-slot="checklist-item"
      data-state={state}
      className={cn("flex flex-wrap items-start gap-3 p-4", className)}
      {...props}
    >
      <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center">
        {state === "done" ? (
          <CircleCheck className="size-5 fill-success text-card" />
        ) : state === "checking" ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : state === "unknown" ? (
          <CircleAlert className="size-5 fill-warning text-card" />
        ) : (
          <CircleDashed className="size-5 text-muted-foreground" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          <span className="sr-only">{SPOKEN[state]}: </span>
          {title}
        </div>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
      {state !== "done" && action && (
        <div className="basis-full pl-8 sm:shrink-0 sm:basis-auto sm:pl-0">{action}</div>
      )}
    </li>
  );
}
