import { useState } from "react";
import { CheckCircle2, ChevronRight, Circle, XCircle } from "lucide-react";
import type { Resource, RunStep, StepStatus } from "@iterate-com/cloud/records";
import { statusLabelOf, type InstallStep } from "@iterate-com/cloud/views";
import { Button } from "@iterate-com/ui/components/ui/button";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";

const cn = (...names: (string | false)[]) => names.filter(Boolean).join(" ");

/** Named steps, each with its real status, where it stopped and why, Alchemy's resources on its
 *  step, and the text lines each printed. A text step's lines are open while it runs or after it
 *  failed, and behind its label once it succeeded; Alchemy's text lines stay behind the label
 *  unless its step failed, since its resources say what it does. `readAll` reads a step's every
 *  line. */
export function Steps({
  steps,
  readAll,
}: {
  steps: InstallStep[];
  readAll?: (step: RunStep) => Promise<string[]>;
}) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step) => (
        <StepRow key={step.id} step={step} readAll={readAll} />
      ))}
    </ol>
  );
}

function StepRow({
  step,
  readAll,
}: {
  step: InstallStep;
  readAll?: (step: RunStep) => Promise<string[]>;
}) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const printed = step.tail.length > 0;
  const openByDefault =
    step.status === "failed" || (step.status === "running" && step.resources.length === 0);
  const open = printed && (toggled ?? openByDefault);
  return (
    <li className="flex items-start gap-3" data-status={step.status}>
      <StatusIcon status={step.status} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <StepLabel step={step} open={open} onToggle={printed ? () => setToggled(!open) : null} />
        {step.error ? (
          <span data-type="error" className="text-sm break-words text-destructive">
            {step.error}
          </span>
        ) : null}
        {step.resources.length ? (
          <Resources resources={step.resources} running={step.status === "running"} />
        ) : null}
        {open ? <StepLines step={step} readAll={readAll} /> : null}
      </div>
    </li>
  );
}

/** The step's label: a toggle for its lines when it printed any. */
function StepLabel({
  step,
  open,
  onToggle,
}: {
  step: InstallStep;
  open: boolean;
  onToggle: (() => void) | null;
}) {
  const label = (
    <span className={cn("text-sm", step.status === "pending" && "text-muted-foreground")}>
      {step.label}
    </span>
  );
  if (!onToggle) return label;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex items-center gap-1 self-start text-left hover:text-foreground/80"
    >
      {label}
      <ChevronRight
        aria-hidden
        className={cn(
          "size-3.5 text-muted-foreground/60 transition-transform",
          open && "rotate-90",
        )}
      />
    </button>
  );
}

/** The newest lines the step printed, and the rest on asking. */
function StepLines({
  step,
  readAll,
}: {
  step: InstallStep;
  readAll?: (step: RunStep) => Promise<string[]>;
}) {
  const [all, setAll] = useState<string[] | null>(null);
  const id = step.id === "sandbox" ? null : step.id;
  return (
    <div className="flex flex-col gap-2">
      <Output lines={all || step.tail} />
      {readAll && id && !all && step.more ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => void readAll(id).then(setAll)}
        >
          Show all {step.lines} lines
        </Button>
      ) : null}
    </div>
  );
}

/** Alchemy's stack as the run's events left it: one row a resource, its name, its type and its
 *  status (the action its plan decided until Alchemy touches it), and a provider's note while it
 *  works or after it failed. Once the step stops nothing is in progress any more, whatever Alchemy
 *  said last. */
function Resources({ resources, running }: { resources: Resource[]; running: boolean }) {
  return (
    <ul className="flex flex-col gap-1.5 rounded-lg border border-border/60 p-2.5">
      {resources.map((resource) => {
        const busy = running && inProgress(resource.status);
        const failed = resource.status === "fail";
        return (
          <li
            key={resource.fqn}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 text-xs"
            data-resource-type={resource.type}
            data-status={resource.status || "planned"}
          >
            <ResourceIcon status={resource.status} busy={busy} />
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-mono">{resource.id}</span>
              <span className="truncate text-muted-foreground">
                {resource.type.replace(/^Cloudflare\./, "")}
              </span>
            </span>
            <span
              className={cn(
                "font-mono",
                failed ? "text-destructive" : busy ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {resource.status ? statusLabelOf(resource.status) : resource.action}
            </span>
            {resource.note && (busy || failed) ? (
              <span
                className={cn(
                  "col-start-2 col-end-4 truncate text-muted-foreground",
                  failed && "text-destructive",
                )}
              >
                {resource.note}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === "running") return <Spinner className="mt-0.5 size-4 shrink-0" />;
  if (status === "succeeded")
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />;
  if (status === "failed") return <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />;
  return <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

/** Whether Alchemy's `status` is work in progress: those end in "ing" (`creating`,
 *  `creating replacement`), all but `pending`, which waits for its turn. */
const inProgress = (status: string | null) =>
  !!status && status !== "pending" && /ing\b/.test(status);

/** A resource's status as an icon. */
function ResourceIcon({ status, busy }: { status: string | null; busy: boolean }) {
  if (status === "fail") return <XCircle className="size-3.5 text-destructive" />;
  if (busy) return <Spinner className="size-3.5" />;
  if (!status || /ing\b/.test(status)) return <Circle className="size-3.5 text-muted-foreground" />;
  return <CheckCircle2 className="size-3.5 text-success" />;
}

/** Text lines a step printed, as the deployment's state keeps them or as read in full. */
function Output({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
      {lines.join("\n")}
    </pre>
  );
}
