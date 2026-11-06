// cloud/deployment.ts — A DEPLOYMENT'S CONTEXT, `/deployments/<id>` (contract.ts): two sagas on one
// log, driven by this processor from its state, never from a request.
//
//   CREATION. `cloud/deployment-requested` (the person's request, api.ts) → the processor prepares
//   the deployment's own sandbox from the toolchain's snapshot (`preparation-started`, then
//   `preparation-settled`) → it requests the first deploy itself (`run-requested`). A preparation
//   that failed opens again on `cloud/preparation-requested` (the page's Try again).
//
//   A RUN. `cloud/run-requested` opens a run while none is open and the sandbox is ready; any other
//   request is settled `refused` as it is processed. At head, an open run that no work of this
//   incarnation drives gets ONE driver in `runInBackground`: `attempt-started`, one attempt in the
//   sandbox (runs.ts), which reports `output-printed` as it reads the script's log, then
//   `run-settled`. An attempt that dies with its incarnation leaves the run open for the next pass,
//   up to ATTEMPTS; the next attempt adopts the script that may still run (runs.ts), so a retry never
//   runs Alchemy twice.
//
// ONE DRIVER DRAINS what the state owes, as core/os project/processor.ts drains its publications:
// each stage hands off by an append, and that event's delivery may reach `processEvent` while the
// driver is still finishing, so the driver reads the newest state after each step and goes on while
// work is owed. The state it reads may not have reduced its own last answer yet, so it remembers
// what it answered (`#answered`) and never does that again.
//
// The state is what the page draws (records.ts `DeploymentState`): each run's named steps with their
// real status and newest text lines, moved by the steps the run's output names, and Alchemy's stack
// as its typed events report it (alchemy.ts).
// Pure: the sandbox work is the host's (`DeploymentDeps`, durable-object.ts), so a test constructs
// this with `new`.
import {
  StreamProcessor,
  type ConsumedEvent,
  type EmittedEventInput,
  type ProcessEventArgs,
  type ReduceArgs,
} from "iterate/stream/processor";
import { foldAlchemyEvent } from "./alchemy.ts";
import { maskedConfigOf, type DeploymentConfig } from "./config.ts";
import { DeploymentContract } from "./contract.ts";
import {
  RUNS_KEPT,
  type AlchemyEvent,
  type DeploymentRecord,
  type DeploymentState,
  type Preparation,
  type Run,
  type RunKind,
  type RunSettled,
  type RunStep,
  type Step,
} from "./records.ts";

/** The most attempts a preparation or a run makes before it settles failed. */
const ATTEMPTS = 3;
/** The newest text lines the state keeps of each step for the page. */
const TAIL_LINES = 40;

/** What a run's output reports, in order: text lines of one step, or one event of Alchemy's. `from`
 *  and `at` count both kinds alike (records.ts `Run.lines`). */
export type Printed =
  | { kind: "lines"; from: number; step: RunStep; lines: string[] }
  | { kind: "event"; at: number; event: AlchemyEvent };

export type Outcome =
  | { status: "succeeded"; url?: string; image?: string }
  | { status: "failed"; error: string };

/** What the sagas need of their host: each call is one attempt, and a rejection is the host's own
 *  defect, which settles the attempt failed with its message. */
export type DeploymentDeps = {
  /** Start the deployment's sandbox from the toolchain. Idempotent: an attempt after one that
   *  died finds what it left. */
  prepare(record: DeploymentRecord): Promise<Outcome>;
  /** One attempt of a run: start the run's script, or adopt it when it already runs, and report
   *  its output from record `reported` on, in order, a poll's worth at a time. */
  attempt(
    run: {
      record: DeploymentRecord;
      config: DeploymentConfig;
      requestOffset: number;
      kind: RunKind;
      attempt: number;
      reported: number;
    },
    report: (printed: Printed[]) => Promise<unknown>,
  ): Promise<Outcome>;
};

type Event = ConsumedEvent<typeof DeploymentContract>;
type Args = ProcessEventArgs<DeploymentState, Event, EmittedEventInput<typeof DeploymentContract>>;

export class DeploymentProcessor extends StreamProcessor<DeploymentState, Event> {
  readonly contract = DeploymentContract;
  readonly #deps: DeploymentDeps;
  /** Whether this incarnation's one driver runs; the durable ground is the state. */
  #driving = false;
  /** The newest state any delivery showed: what the driver drains from. */
  #newest: DeploymentState | null = null;
  /** What the driver answered last (`answerOf`). */
  #answered: ReturnType<typeof answerOf> | null = null;

  constructor(deps: DeploymentDeps) {
    super();
    this.#deps = deps;
  }

  override reduce({
    state,
    event,
  }: ReduceArgs<DeploymentState, Event>): DeploymentState | undefined {
    const { preparation, run } = state;
    switch (event.type) {
      case "cloud/deployment-requested":
        if (state.record) return undefined;
        return {
          ...state,
          record: event.payload.record,
          config: event.payload.config,
          preparation: { requestOffset: event.offset, status: "running", attempt: 0, error: null },
        };
      case "cloud/preparation-requested":
        if (!state.record || preparation?.status !== "failed") return undefined;
        return {
          ...state,
          preparation: { requestOffset: event.offset, status: "running", attempt: 0, error: null },
        };
      case "cloud/preparation-started": {
        const { requestOffset, attempt } = event.payload;
        if (preparation?.status !== "running" || preparation.requestOffset !== requestOffset)
          return undefined;
        if (attempt <= preparation.attempt) return undefined;
        return { ...state, preparation: { ...preparation, attempt } };
      }
      case "cloud/preparation-settled": {
        const { requestOffset, status, error } = event.payload;
        if (preparation?.status !== "running" || preparation.requestOffset !== requestOffset)
          return undefined;
        return { ...state, preparation: { ...preparation, status, error: error || null } };
      }
      case "cloud/run-requested": {
        if (run?.status === "open" || preparation?.status !== "succeeded") return undefined;
        const opened: Run = {
          requestOffset: event.offset,
          kind: event.payload.kind,
          requestedAt: event.createdAt,
          status: "open",
          attempt: 0,
          lines: 0,
          steps: stepsOf(event.payload.kind),
          resources: [],
          error: null,
          settledAt: null,
        };
        // the history keeps each run's steps and resources, not their lines
        const history = run
          ? [
              ...state.history,
              { ...run, steps: run.steps.map((step) => ({ ...step, tail: [] })) },
            ].slice(-RUNS_KEPT)
          : state.history;
        return { ...state, run: opened, history };
      }
      case "cloud/attempt-started": {
        const { requestOffset, attempt } = event.payload;
        if (!isOpen(run, requestOffset) || attempt <= run.attempt) return undefined;
        return { ...state, run: { ...run, attempt } };
      }
      case "cloud/output-printed": {
        const { requestOffset, from, step, lines } = event.payload;
        // exactly the next records: a repeat or a gap is not folded (runs.ts reports in order)
        if (!isOpen(run, requestOffset) || from !== run.lines) return undefined;
        const steps = reach(run.steps, step).map((known): Step =>
          known.name === step
            ? {
                ...known,
                lines: known.lines + lines.length,
                tail: [...known.tail, ...lines].slice(-TAIL_LINES),
              }
            : known,
        );
        return { ...state, run: { ...run, lines: run.lines + lines.length, steps } };
      }
      case "cloud/alchemy-reported": {
        const { requestOffset, at, event: reported } = event.payload;
        if (!isOpen(run, requestOffset) || at !== run.lines) return undefined;
        return {
          ...state,
          run: {
            ...run,
            lines: run.lines + 1,
            steps: reach(run.steps, "alchemy"),
            resources: foldAlchemyEvent(run.resources, reported),
          },
        };
      }
      case "cloud/run-settled": {
        const { requestOffset, status, error, url, image } = event.payload;
        if (!isOpen(run, requestOffset)) return undefined;
        const steps = run.steps.map((step): Step =>
          status === "succeeded"
            ? { ...step, status: "succeeded" }
            : step.status === "running"
              ? { ...step, status: "failed" }
              : step,
        );
        const settled: Run = {
          ...run,
          status,
          steps,
          error: error || null,
          settledAt: event.createdAt,
        };
        const next = { ...state, run: settled };
        if (status !== "succeeded" || run.kind === "plan") return next;
        return run.kind === "deploy"
          ? { ...next, url: url || state.url, image: image || state.image }
          : { ...next, url: null, image: null };
      }
    }
  }

  override projectLiveState(state: DeploymentState) {
    return { ...state, config: state.config && maskedConfigOf(state.config) };
  }

  override processEvent(args: Args): undefined {
    const { state, event, delivery, append, blockProcessorWhile, runInBackground } = args;
    this.#newest = state;
    // A request the reduce did not open is settled while it is processed: no state remembers it.
    if (event?.type === "cloud/run-requested" && state.run?.requestOffset !== event.offset)
      blockProcessorWhile(() =>
        this.#settle(append, {
          requestOffset: event.offset,
          status: "refused",
          attempts: 0,
          error:
            state.run?.status === "open"
              ? `A ${state.run.kind} is running since offset ${state.run.requestOffset}. Wait for it to end.`
              : "The deployment's sandbox is not ready yet.",
        }),
      );
    if (!delivery.caughtUp || this.#driving || !this.#owed()) return;
    this.#driving = true;
    runInBackground(async () => {
      try {
        for (let work = this.#owed(); work; work = this.#owed()) {
          await this.#do(work, append);
          this.#answered = answerOf(work);
        }
      } finally {
        this.#driving = false;
      }
    });
  }

  /** What the newest state owes that this incarnation has not answered. */
  #owed(): Work | null {
    const work = this.#newest && nextWork(this.#newest);
    if (!work || !this.#answered) return work;
    const answered = this.#answered;
    // the newest state may still show the step this driver just finished
    if (work.kind === "first-deploy" && answered.kind === "first-deploy") return null;
    const done =
      (work.kind === "prepare" &&
        answered.kind === "prepare" &&
        work.preparation.requestOffset === answered.requestOffset &&
        work.preparation.attempt <= answered.attempt) ||
      (work.kind === "run" &&
        answered.kind === "run" &&
        work.run.requestOffset === answered.requestOffset &&
        work.run.attempt <= answered.attempt);
    if (done) return null;
    return work;
  }

  async #do(work: Work, append: Args["append"]) {
    const { record } = work;
    if (work.kind === "first-deploy") {
      await append({
        type: "cloud/run-requested",
        idempotencyKey: this.idempotencyKey("first-deploy"),
        payload: { kind: "deploy" },
      });
      return;
    }
    if (work.kind === "prepare") {
      const { requestOffset, attempt: done } = work.preparation;
      if (done >= ATTEMPTS) {
        await this.#settlePreparation(append, requestOffset, done, {
          status: "failed",
          error: `Gave up after ${done} attempts, none of which finished.`,
        });
        return;
      }
      const attempt = done + 1;
      await append({
        type: "cloud/preparation-started",
        idempotencyKey: this.idempotencyKey(`preparation-started:${requestOffset}:${attempt}`),
        payload: { requestOffset, attempt },
      });
      const outcome = await this.#deps.prepare(record).catch(threw);
      await this.#settlePreparation(append, requestOffset, attempt, outcome);
      return;
    }
    const { requestOffset, kind, attempt: done, lines } = work.run;
    if (done >= ATTEMPTS) {
      await this.#settle(append, {
        requestOffset,
        status: "failed",
        attempts: done,
        error: `Gave up after ${done} attempts, none of which settled the run.`,
      });
      return;
    }
    const attempt = done + 1;
    await append({
      type: "cloud/attempt-started",
      idempotencyKey: this.idempotencyKey(`attempt-started:${requestOffset}:${attempt}`),
      payload:
        done > 0
          ? { requestOffset, attempt, retrying: `attempt ${done} ended before it settled the run` }
          : { requestOffset, attempt },
    });
    const outcome = await this.#deps
      .attempt(
        { record, config: work.config, requestOffset, kind, attempt, reported: lines },
        (printed) =>
          append(
            ...printed.map((item) =>
              item.kind === "lines"
                ? {
                    type: "cloud/output-printed" as const,
                    idempotencyKey: this.idempotencyKey(
                      `output-printed:${requestOffset}:${item.from}`,
                    ),
                    payload: {
                      requestOffset,
                      attempt,
                      from: item.from,
                      step: item.step,
                      lines: item.lines,
                    },
                  }
                : {
                    type: "cloud/alchemy-reported" as const,
                    idempotencyKey: this.idempotencyKey(
                      `alchemy-reported:${requestOffset}:${item.at}`,
                    ),
                    payload: { requestOffset, attempt, at: item.at, event: item.event },
                  },
            ),
          ),
      )
      .catch(threw);
    await this.#settle(append, { requestOffset, attempts: attempt, ...outcome });
  }

  #settle(append: Args["append"], settled: RunSettled) {
    return append({
      type: "cloud/run-settled",
      idempotencyKey: this.idempotencyKey(`run-settled:${settled.requestOffset}`),
      payload: settled,
    });
  }

  #settlePreparation(
    append: Args["append"],
    requestOffset: number,
    attempts: number,
    outcome: Outcome,
  ) {
    return append({
      type: "cloud/preparation-settled",
      idempotencyKey: this.idempotencyKey(`preparation-settled:${requestOffset}`),
      payload:
        outcome.status === "succeeded"
          ? { requestOffset, status: "succeeded", attempts }
          : { requestOffset, status: "failed", attempts, error: outcome.error },
    });
  }
}

type Work =
  | { kind: "prepare"; record: DeploymentRecord; preparation: Preparation }
  | { kind: "first-deploy"; record: DeploymentRecord }
  | { kind: "run"; record: DeploymentRecord; config: DeploymentConfig; run: Run };

/** What the state owes, at head: the sandbox, then the first deploy, then an open run. */
function nextWork({ record, config, preparation, run }: DeploymentState): Work | null {
  if (!record || !config) return null;
  if (preparation?.status === "running") return { kind: "prepare", record, preparation };
  if (preparation?.status !== "succeeded") return null;
  if (!run) return { kind: "first-deploy", record };
  return run.status === "open" ? { kind: "run", record, config, run } : null;
}

/** What answering `work` did: the preparation or run attempt it made, by its number. */
function answerOf(work: Work) {
  if (work.kind === "prepare")
    return {
      kind: work.kind,
      requestOffset: work.preparation.requestOffset,
      attempt: work.preparation.attempt + 1,
    };
  if (work.kind === "run")
    return {
      kind: work.kind,
      requestOffset: work.run.requestOffset,
      attempt: work.run.attempt + 1,
    };
  return { kind: work.kind };
}

const threw = (error: unknown): Outcome => ({
  status: "failed",
  error: `The attempt threw: ${error instanceof Error ? error.message : String(error)}`,
});

const isOpen = (run: Run | null, requestOffset: number): run is Run =>
  run?.status === "open" && run.requestOffset === requestOffset;

/** The named steps of a run of `kind`, all pending: a plan or deploy makes the Artifacts namespace,
 *  puts the sandbox image in the account and builds core/os before Alchemy runs (runs.ts). */
const stepsOf = (kind: RunKind): Step[] =>
  ({
    plan: ["namespace", "image", "build", "alchemy"] as const,
    deploy: ["namespace", "image", "build", "alchemy", "check"] as const,
    destroy: ["alchemy", "repos"] as const,
  })[kind].map((name) => ({ name, status: "pending", lines: 0, tail: [] }));

/** `reached` runs; every step before it succeeded. A step already running stays as it is. */
function reach(steps: Step[], reached: Step["name"]): Step[] {
  const at = steps.findIndex((step) => step.name === reached);
  if (at < 0) return steps;
  return steps.map((step, index): Step =>
    index < at
      ? { ...step, status: "succeeded" }
      : index === at
        ? { ...step, status: "running" }
        : step,
  );
}
