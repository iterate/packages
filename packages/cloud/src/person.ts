// cloud/person.ts — A PERSON'S CONTEXT, `/people/<sub>` (contract.ts): reduce only. The config
// worker appends every fact (worker.ts, api.ts): who the person is, the first time the Cloud serves
// them, a connect asked for and how it ended, a deployment added. The live state, which the person's browser reads, drops each connection's
// nonce: it names the platform's OAuth attempt, which only the config worker asks about.
import { StreamProcessor, type ConsumedEvent, type ReduceArgs } from "iterate/stream/processor";
import { PersonContract } from "./contract.ts";
import type { PersonState } from "./records.ts";

type Event = ConsumedEvent<typeof PersonContract>;

export class PersonProcessor extends StreamProcessor<PersonState, Event> {
  readonly contract = PersonContract;

  override reduce({ state, event }: ReduceArgs<PersonState, Event>): PersonState | undefined {
    switch (event.type) {
      case "cloud/person-signed-in":
        return { ...state, sub: event.payload.sub, email: event.payload.email };
      case "cloud/connection-requested": {
        const { connection, nonce } = event.payload;
        // a connection is asked for once; its id is fresh each time (api.ts)
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
      case "cloud/deployment-added": {
        const added = event.payload;
        // two creations of one name that overlap both pass create's check, which reads before
        // either lands: the log's order decides, and the first stands (api.ts `create`)
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

  override projectLiveState(state: PersonState) {
    return {
      ...state,
      connections: state.connections.map(({ nonce: _nonce, ...connection }) => connection),
    };
  }
}
