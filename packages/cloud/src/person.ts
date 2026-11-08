// cloud/person.ts — A PERSON'S CONTEXT, `/people/<sub>` (contract.ts): reduce, and one effect, which
// the host does (durable-object.ts): the X settle a schedule asks for. The config worker records who
// the person is, the first time the Cloud serves them (worker.ts); their facet appends the rest
// (durable-object.ts): a connect asked for and how it ended, a deployment added. The live state,
// which the person's browser reads, drops each connection's nonce: it names the platform's OAuth
// attempt, which only the facet asks about.
import {
  StreamProcessor,
  type ConsumedEvent,
  type ProcessEventArgs,
  type ReduceArgs,
} from "iterate/stream/processor";
import { PersonContract } from "./contract.ts";
import type { PersonState } from "./records.ts";

type Event = ConsumedEvent<typeof PersonContract>;

/** What the processor's effect needs of its host (durable-object.ts). */
export type PersonDeps = {
  /** Settle the X attempt that stands: what the platform's callback stored, or that it stored
   *  nothing (`CloudPersonFacet.settleX`). */
  settleX(): Promise<unknown>;
};

/** How soon after a connect the first ask comes, the most a chain waits between asks, and how much
 *  waiting it does in all, counted by the asks' own delays and not by a clock. The page settles a
 *  consent within seconds when it can, and the platform's attempt lapses after an hour; only a
 *  settle that keeps throwing gets to the end, sixteen asks on. */
export const X_SETTLE_FIRST_MS = 20_000;
const X_SETTLE_MOST_MS = 10 * 60_000;
const X_SETTLE_FOR_MS = 2 * 60 * 60_000;

/** The platform's schedule of one ask after `afterMs`, keyed by the attempt, so a chain never
 *  touches another attempt's; `waitedMs` is what the chain has waited in all once it fires.
 *  `connectX` appends the first with the attempt (durable-object.ts), and each ask appends the
 *  next (`processEvent`). */
export const xSettleAsk = (nonce: string, afterMs: number, waitedMs = afterMs) => ({
  type: "events.iterate.com/itx/schedule-set" as const,
  payload: {
    key: ["x-settle", nonce],
    when: { afterMs },
    events: [{ type: "cloud/x-settle-asked", payload: { nonce, afterMs, waitedMs } }],
  },
});

export class PersonProcessor extends StreamProcessor<PersonState, Event> {
  readonly contract = PersonContract;
  readonly #deps: PersonDeps | undefined;

  constructor(deps?: PersonDeps) {
    super();
    this.#deps = deps;
  }

  override reduce({ state, event }: ReduceArgs<PersonState, Event>): PersonState | undefined {
    switch (event.type) {
      case "cloud/person-signed-in":
        return { ...state, sub: event.payload.sub, email: event.payload.email };
      case "cloud/platform-configured":
        return { ...state, platform: event.payload };
      case "cloud/connection-requested": {
        const { connection, nonce } = event.payload;
        // a connection is asked for once; its id is fresh each time (durable-object.ts)
        if (state.connections.some((known) => known.id === connection)) return undefined;
        return {
          ...state,
          connections: [
            ...state.connections,
            {
              id: connection,
              requestOffset: event.offset,
              status: "pending",
              startedAt: event.createdAt,
              nonce,
              cloudflareUser: null,
              accounts: [],
              scopes: [],
              error: null,
              settledAt: null,
            },
          ],
        };
      }
      case "cloud/connection-settled": {
        const settled = event.payload;
        const known = state.connections.find(
          (candidate) =>
            candidate.id === settled.connection &&
            candidate.requestOffset === settled.requestOffset,
        );
        if (known?.status !== "pending") return undefined;
        return {
          ...state,
          connections: state.connections.map((candidate) =>
            candidate === known
              ? {
                  ...candidate,
                  status: settled.status,
                  cloudflareUser: settled.cloudflareUser || null,
                  accounts: settled.accounts || [],
                  scopes: settled.scopes || [],
                  error: settled.error || null,
                  settledAt: event.createdAt,
                }
              : candidate,
          ),
        };
      }
      case "cloud/x-connect-requested":
        // a new connect replaces whatever stood: one X account per person
        return {
          ...state,
          x: {
            requestOffset: event.offset,
            status: "pending",
            startedAt: event.createdAt,
            nonce: event.payload.nonce,
            xUserId: null,
            username: null,
            scopes: [],
            error: null,
            settledAt: null,
          },
        };
      case "cloud/x-connect-settled": {
        const { requestOffset, status, xUserId, username, scopes, error } = event.payload;
        if (state.x?.requestOffset !== requestOffset || state.x.status !== "pending")
          return undefined;
        return {
          ...state,
          x: {
            ...state.x,
            status,
            xUserId: xUserId || null,
            username: username || null,
            scopes: scopes || [],
            error: error || null,
            settledAt: event.createdAt,
          },
        };
      }
      case "cloud/deployment-added": {
        const added = event.payload;
        // two creations of one name that overlap both pass create's check, which reads before
        // either lands: the log's order decides, and the first stands (durable-object.ts `createDeployment`)
        const taken = state.deployments.some(
          (known) =>
            known.id === added.id ||
            (known.accountId === added.accountId && known.name === added.name),
        );
        if (taken) return undefined;
        return { ...state, deployments: [...state.deployments, added] };
      }
    }
  }

  /** The schedule's ask: while the attempt it names stands and is pending, the next ask goes on
   *  the log first, held until it is there, and then the host settles. So a settle that throws (the
   *  platform's opaque error this chain exists for), or a host that dies in it, is asked again; an
   *  ask for an attempt a newer connect replaced, or for one settled meanwhile, is spent. An ask
   *  that comes after `X_SETTLE_FOR_MS` of waiting gives the attempt up as failed instead. Not gated
   *  on the delivery's catch-up: an ask met late still settles, and the host's settle is
   *  idempotent. */
  override processEvent(args: ProcessEventArgs<PersonState, Event>): undefined {
    const { event, state, append, blockProcessorWhile, runInBackground } = args;
    if (event?.type !== "cloud/x-settle-asked") return;
    const { nonce, afterMs, waitedMs } = event.payload;
    const { x } = state;
    if (x?.nonce !== nonce || x.status !== "pending") return;
    if (waitedMs >= X_SETTLE_FOR_MS) {
      blockProcessorWhile(() =>
        append({
          type: "cloud/x-connect-settled",
          idempotencyKey: `x-connect-settled:${x.requestOffset}`,
          payload: {
            requestOffset: x.requestOffset,
            status: "failed",
            error: "The Cloud could not confirm X's answer in two hours. Connect again.",
          },
        }),
      );
      return;
    }
    const nextMs = Math.min(afterMs * 2, X_SETTLE_MOST_MS);
    blockProcessorWhile(() => append(xSettleAsk(nonce, nextMs, waitedMs + nextMs)));
    const deps = this.#deps;
    if (deps) runInBackground(() => deps.settleX());
  }

  override projectLiveState(state: PersonState) {
    const { nonce: _xNonce, ...x } = state.x || {};
    return {
      ...state,
      connections: state.connections.map(({ nonce: _nonce, ...connection }) => connection),
      x: state.x ? x : null,
    };
  }
}
