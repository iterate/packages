// The host sends the frame what changed: fields by identity, events as the pages added at either end.
import { expect, test } from "vitest";
import { applyUpdate, updateBetween, type AgentKindViewInputs } from "./bridge.ts";

test("a new event at the head goes alone, and the frame's copy matches the host's", () => {
  const first = inputs([event(5), event(6)]);
  const next = { ...first, events: [...first.events, event(7)], caughtUp: true };
  const update = updateBetween(first, next);
  expect(update).toEqual({ caughtUp: true, events: { prepend: [], append: [event(7)] } });
  expect(applyUpdate(first, update!)).toEqual(next);
});

test("an older page goes as a prepend; an unchanged view sends nothing", () => {
  const held = inputs([event(5), event(6)]);
  const next = { ...held, events: [event(3), event(4), ...held.events] };
  expect(updateBetween(held, next)).toEqual({
    events: { prepend: [event(3), event(4)], append: [] },
  });
  expect(updateBetween(next, next)).toBeNull();
});

test("a window that moved otherwise (a reconnect) is sent whole", () => {
  const held = inputs([event(5), event(6)]);
  const next = { ...held, events: [event(9)] };
  expect(updateBetween(held, next)).toEqual({ events: { reset: [event(9)] } });
  expect(applyUpdate(held, updateBetween(held, next)!)).toEqual(next);
});

function event(offset: number) {
  return { offset, type: "test/said", createdAt: "2026-11-10T00:00:00.000Z", payload: { offset } };
}

function inputs(events: AgentKindViewInputs["events"]): AgentKindViewInputs {
  return {
    path: "/agents/echo/1",
    events,
    caughtUp: false,
    error: undefined,
    head: 6,
    older: null,
    processors: { rows: [], loaded: true },
    presence: { actors: [], rpcStubs: [] },
    liveState: {},
    hostError: undefined,
    state: {},
    documentClass: "dark",
  };
}
