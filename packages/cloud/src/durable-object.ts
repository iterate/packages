// cloud/durable-object.ts — THE FACETS a project's config loads (its `cloud.ts` re-exports this
// package's index): each processor, handed its host's itx, and `watch`, through which the Cloud
// app's browser follows the processor's live state.
//
// WHY THE FACET WATCHES. A loaded worker cannot `subscribe` on another context: its `itx.cd(path)`
// is an expression handle, and `subscribe` is a verb of the edge, not of an expression
// (core/os/src/iterate-context.ts `cd` and `subscribe`). A facet's own scope IS its context, so the
// facet subscribes itself, with the browser's callback, which crosses two hops (capnweb from the
// browser to the config worker, Workers RPC to here). Each hop disposes a stub passed as an argument
// when the call returns, so each callee keeps its own with `dup()`
// (https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/). A disposable returned
// through the expression hop is disposed at once, so a watch ends by name (`unwatch`): a dispose and
// a closed socket each remove its subscription row.
//
// A watch keeps its context resident while it lasts, as any live view does (the Dash's too). It
// ends when the config worker asks (the browser disposed it, or its socket closed: api.ts), at the
// first delta it cannot forward, or within a minute of the browser going away unannounced (a probe
// every minute). A facet reset (a publish of the Cloud) ends it too, unannounced, while the page's
// socket to the config worker stays open: the page then hears no probe, and redials within 150 s
// (packages/cloud-app lib/cloud.ts `heardOf`), which subscribes it again.
import type { IterateContextApi } from "iterate/api";
import { StreamProcessorDurableObject } from "iterate/sdk";
import type { DeploymentState, PersonState, ToolchainState } from "./records.ts";
import { DeploymentProcessor } from "./deployment.ts";
import { PersonProcessor } from "./person.ts";
import { prepareDeployment, prepareToolchain, runAttempt } from "./runs.ts";
import { ToolchainProcessor } from "./toolchain.ts";

/** The browser's callback, as Workers RPC hands it over: a stub, kept past the call with `dup()`. */
export type WatchTarget = (events: unknown[], range: unknown) => unknown;
type HeldTarget = WatchTarget & { dup(): HeldTarget } & Disposable;

/** A host's watches: subscriptions of its own context to its live-state deltas, each forwarded to
 *  one browser's callback and kept by name until `end` runs. */
class Watches {
  readonly #ends = new Map<string, () => void>();

  async start(getItx: () => IterateContextApi & Disposable, target: WatchTarget) {
    const name = `cloud-watch-${crypto.randomUUID().slice(0, 12)}`;
    // safe: Workers RPC hands a callback over as a stub, which has `dup()` and a disposer whatever
    // type the method declares; the declared type stays a plain function, which is what a caller
    // passes (https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/)
    const forward = (target as HeldTarget).dup();
    // oxlint-disable-next-line iterate/no-raw-itx-get -- a watch holds its scope until `end`: the scope is the subscription's lend, and a `using` block would end it at once
    const scope = getItx();
    const subscription = await scope.subscribe({
      name,
      consumes: ["events.iterate.com/itx/live-state-changed"],
      target: (events, range) => {
        void Promise.resolve(forward(events, range)).catch(() => this.end(name));
      },
    });
    // a browser gone without `unwatch` (its config worker's isolate died) ends the watch within a
    // minute: an empty batch, which the page's store ignores, fails to reach it
    const probe = setInterval(() => {
      void Promise.resolve(forward([], null)).catch(() => this.end(name));
    }, 60_000);
    this.#ends.set(name, () => {
      clearInterval(probe);
      try {
        subscription[Symbol.dispose]();
      } finally {
        forward[Symbol.dispose]();
        scope[Symbol.dispose]();
      }
    });
    return name;
  }

  end(name: string) {
    const end = this.#ends.get(name);
    this.#ends.delete(name);
    end?.();
  }
}

export class CloudPersonFacet extends StreamProcessorDurableObject<PersonState> {
  static override publicMethods = [...super.publicMethods, "watch", "unwatch"];
  processor = new PersonProcessor();
  readonly #watches = new Watches();
  watch(target: WatchTarget) {
    return this.#watches.start(() => this.getItx(), target);
  }
  unwatch(name: string) {
    this.#watches.end(name);
  }
}

export class CloudDeploymentFacet extends StreamProcessorDurableObject<DeploymentState> {
  static override publicMethods = [...super.publicMethods, "watch", "unwatch"];
  processor = new DeploymentProcessor({
    prepare: async (record) => {
      using itx = this.getItx();
      return await prepareDeployment(itx, record);
    },
    attempt: async (run, report) => {
      using itx = this.getItx();
      // the sandboxes and secrets are the project's, reached through the root, whose table has them
      const root = itx.cd("/");
      const toolchain = (
        await root.cd("/toolchain").facets.get<ToolchainSnapshot>("cloud-toolchain").snapshot()
      ).state;
      return await runAttempt(root, toolchain.ready?.image || null, run, report);
    },
  });
  readonly #watches = new Watches();
  watch(target: WatchTarget) {
    return this.#watches.start(() => this.getItx(), target);
  }
  unwatch(name: string) {
    this.#watches.end(name);
  }
}

export class CloudToolchainFacet extends StreamProcessorDurableObject<ToolchainState> {
  processor = new ToolchainProcessor({
    prepare: async (requestOffset) => {
      using itx = this.getItx();
      return await prepareToolchain(itx, requestOffset);
    },
  });
}

type ToolchainSnapshot = { snapshot(): Promise<{ state: ToolchainState }> };
