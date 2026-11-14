// step-row.tsx — one step of work a page does for the person, as a quiet line among the messages of
// a feed: done with a green check, running with a spinner, waiting on the person with an alert mark
// and what they can do about it, or failed. No card: an icon, a line of text, a line under it, and the
// page's own buttons under that. Its spacing is padding, so it can be a row of a virtual list.
import type { ComponentProps, ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { cn } from "cn";
import { Spinner } from "#/components/ui/spinner.tsx";

/** done; running (under way); waiting (on the person: its buttons say for what); failed. */
export type StepRowState = "done" | "running" | "waiting" | "failed";

/** The state in words, for a screen reader: the icon alone says it only to the eye. */
const SPOKEN: Record<StepRowState, string> = {
  done: "Done",
  running: "In progress",
  waiting: "Waiting for you",
  failed: "Failed",
};

/** One step. `children` are its actions (`Button size="sm"`), shown in every state the page gives
 *  them: under the text, so a phone has the width of the feed for them. */
export function StepRow({
  state,
  title,
  detail,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  state: StepRowState;
  title: ReactNode;
  /** a line under the title: what was done, what it waits for, or why it failed */
  detail?: ReactNode;
}) {
  return (
    <div
      data-slot="step-row"
      data-state={state}
      className={cn("flex items-start gap-2.5 py-1.5 text-sm", className)}
      {...props}
    >
      <span aria-hidden className="grid h-5 w-4 shrink-0 place-items-center">
        {state === "done" ? (
          <CircleCheck className="size-4 fill-success text-background" />
        ) : state === "running" ? (
          <Spinner className="size-3.5 text-muted-foreground" />
        ) : state === "waiting" ? (
          <CircleAlert className="size-4 fill-warning text-background" />
        ) : (
          <CircleX className="size-4 fill-destructive text-background" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            state === "waiting" && "font-medium",
            state === "done" && "text-muted-foreground",
          )}
        >
          <span className="sr-only">{SPOKEN[state]}: </span>
          {title}
        </div>
        {detail ? (
          <div className={cn("text-muted-foreground", state === "failed" && "text-destructive")}>
            {detail}
          </div>
        ) : null}
        {children ? <div className="flex flex-wrap gap-2 pt-2 pb-0.5">{children}</div> : null}
      </div>
    </div>
  );
}
