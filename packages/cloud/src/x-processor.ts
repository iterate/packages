// cloud/x-processor.ts — THE CLOUD ON X, the `/x` context (contract.ts `XContract`): reduce only.
// Whose each connected X account is (the person facet links it at settleX), the @iterate account
// the Cloud speaks as (a member connects it, x-facet.ts), and how far the inbox has been read.
import { StreamProcessor, type ConsumedEvent, type ReduceArgs } from "iterate/stream/processor";
import { XContract } from "./contract.ts";
import type { XState } from "./records.ts";

type Event = ConsumedEvent<typeof XContract>;

export class XProcessor extends StreamProcessor<XState, Event> {
  readonly contract = XContract;

  override reduce({ state, event }: ReduceArgs<XState, Event>): XState | undefined {
    switch (event.type) {
      case "cloud/x-client-configured":
        return { ...state, client: event.payload };
      case "cloud/x-account-linked": {
        const { sub, xUserId, username } = event.payload;
        const known = state.accounts[xUserId];
        const others = Object.keys(state.accounts).filter(
          (id) => id !== xUserId && state.accounts[id]!.sub === sub,
        );
        if (known?.sub === sub && known.username === username && others.length === 0)
          return undefined;
        // one X account per person: a reconnect as another account retires the old mapping, so a
        // message from the old account reaches no one
        const accounts = { ...state.accounts, [xUserId]: { sub, username } };
        for (const id of others) delete accounts[id];
        return { ...state, accounts };
      }
      case "cloud/x-iterate-connect-requested":
        return {
          ...state,
          iterate: {
            requestOffset: event.offset,
            status: "pending",
            nonce: event.payload.nonce,
            xUserId: null,
            username: null,
            error: null,
          },
        };
      case "cloud/x-iterate-connect-settled": {
        const { requestOffset, status, xUserId, username, error } = event.payload;
        if (state.iterate?.requestOffset !== requestOffset || state.iterate.status !== "pending")
          return undefined;
        return {
          ...state,
          iterate: {
            ...state.iterate,
            status,
            xUserId: xUserId || null,
            username: username || null,
            error: error || null,
          },
        };
      }
      case "cloud/x-inbox-polled": {
        const { dmSince, mentionSince } = event.payload;
        return {
          ...state,
          inbox: {
            dmSince: dmSince || state.inbox.dmSince,
            mentionSince: mentionSince || state.inbox.mentionSince,
          },
        };
      }
      default:
        return undefined;
    }
  }
}
