// cloud/toolchain.ts — THE TOOLCHAIN'S CONTEXT, `/toolchain` (contract.ts): iterate/core at main,
// installed and built once in the sandbox `/toolchain/sandbox`, then saved as the snapshot
// every deployment's sandbox starts from (runs.ts `prepareDeployment`). An operator asks for it with
// one event, from any script on the project's MCP server:
//
//   itx.cd("/toolchain").append({ type: "cloud/toolchain-requested", payload: { image: { … } } })
//
// and this processor does the work in the background, as the deployment's sagas do. Pure: the
// sandbox work is the host's (`ToolchainDeps`, durable-object.ts).
import {
  StreamProcessor,
  type ConsumedEvent,
  type ProcessEventArgs,
  type ReduceArgs,
} from "iterate/stream/processor";
import { ToolchainContract } from "./contract.ts";
import type { ToolchainState } from "./records.ts";

export type ToolchainDeps = {
  /** Prepare the toolchain and save its snapshot. Idempotent: an attempt after one that died
   *  adopts the preparation still running in the sandbox. */
  prepare(
    requestOffset: number,
  ): Promise<
    { status: "succeeded"; snapshot: string; core: string } | { status: "failed"; error: string }
  >;
};

type Event = ConsumedEvent<typeof ToolchainContract>;

export class ToolchainProcessor extends StreamProcessor<ToolchainState, Event> {
  readonly contract = ToolchainContract;
  readonly #deps: ToolchainDeps;
  #driving = false;
  #newest: ToolchainState | null = null;
  #answered: number | null = null;

  constructor(deps: ToolchainDeps) {
    super();
    this.#deps = deps;
  }

  override reduce({ state, event }: ReduceArgs<ToolchainState, Event>): ToolchainState | undefined {
    const { request } = state;
    switch (event.type) {
      case "cloud/toolchain-requested":
        if (request?.status === "running") return undefined;
        return {
          ...state,
          request: {
            requestOffset: event.offset,
            status: "running",
            image: event.payload.image,
            error: null,
          },
        };
      case "cloud/toolchain-settled": {
        const { requestOffset, status, snapshot, core, error } = event.payload;
        if (request?.status !== "running" || request.requestOffset !== requestOffset)
          return undefined;
        const settled = { ...state, request: { ...request, status, error: error || null } };
        if (status !== "succeeded" || !snapshot || !core) return settled;
        return { ...settled, ready: { snapshot, core, image: request.image, at: event.createdAt } };
      }
    }
  }

  // `append` untyped: with a contract that emits one type, `this["contract"]` does not narrow here
  override processEvent(args: ProcessEventArgs<ToolchainState, Event>): undefined {
    const { state, event, delivery, append, blockProcessorWhile } = args;
    if (
      event?.type === "cloud/toolchain-requested" &&
      state.request?.requestOffset !== event.offset
    )
      blockProcessorWhile(() =>
        append({
          type: "cloud/toolchain-settled",
          idempotencyKey: this.idempotencyKey(`toolchain-settled:${event.offset}`),
          payload: {
            requestOffset: event.offset,
            status: "failed",
            error: `A preparation is running since offset ${state.request?.requestOffset}. Wait for it to end.`,
          },
        }),
      );
    this.#newest = state;
    if (!delivery.caughtUp || this.#driving || !this.#owed()) return;
    this.#driving = true;
    // one driver drains, as deployment.ts's does: a request that lands while it finishes is next
    args.runInBackground(async () => {
      try {
        for (let request = this.#owed(); request; request = this.#owed()) {
          const { requestOffset } = request;
          const outcome = await this.#deps.prepare(requestOffset).catch((error: unknown) => ({
            status: "failed" as const,
            error: `The preparation threw: ${error instanceof Error ? error.message : String(error)}`,
          }));
          await append({
            type: "cloud/toolchain-settled",
            idempotencyKey: this.idempotencyKey(`toolchain-settled:${requestOffset}`),
            payload: { requestOffset, ...outcome },
          });
          this.#answered = requestOffset;
        }
      } finally {
        this.#driving = false;
      }
    });
  }

  /** The running request of the newest state, unless this incarnation answered it already. */
  #owed() {
    const request = this.#newest?.request;
    return request?.status === "running" && request.requestOffset !== this.#answered
      ? request
      : null;
  }
}
