// Whether a mind serves a part, asked once: the same promise at every ask, so a component that
// `use`s it does not suspend again, and a failure is asked again only when its session was gone
// and a new one has opened.
import { expect, test } from "vitest";
import type { AuthenticatedApp } from "iterate/app";
import { servesOf } from "./serves.ts";
import { ITX_SESSION, type ItxConnection } from "#/lib/itx-session.ts";

test("a part the mind serves is asked once, and every ask gets the same promise", async () => {
  const mind = fakeMind();
  const first = servesOf(mind.itx, "telemetry");
  expect(servesOf(mind.itx, "telemetry") === first).toBe(true);
  expect(await first).toBe(true);
  mind.connection = { epoch: 2, state: "open" };
  expect(servesOf(mind.itx, "telemetry") === first).toBe(true);
  expect(mind.asked()).toBe(1);
});

test("a refusal on an open session is the mind's answer: it stands, also over a new session", async () => {
  const mind = fakeMind();
  mind.refuse = true;
  const first = servesOf(mind.itx, "telemetry");
  expect(await first).toBe(false);
  expect(servesOf(mind.itx, "telemetry") === first).toBe(true);
  mind.connection = { epoch: 2, state: "open" };
  expect(servesOf(mind.itx, "telemetry") === first).toBe(true);
  expect(mind.asked()).toBe(1);
});

test("a failure with its session gone stands while no new session is open, and is asked once more at the new one", async () => {
  const mind = fakeMind();
  mind.refuse = true;
  mind.connection = { epoch: 1, state: "reconnecting" };
  const first = servesOf(mind.itx, "telemetry");
  expect(await first).toBe(false);
  // every render of an outage asks: none reads, and none gets a promise that is not settled
  mind.connection = { epoch: 1, state: "unreachable" };
  for (let render = 0; render < 5; render += 1)
    expect(servesOf(mind.itx, "telemetry") === first).toBe(true);
  expect(mind.asked()).toBe(1);
  mind.refuse = false;
  mind.connection = { epoch: 2, state: "open" };
  const second = servesOf(mind.itx, "telemetry");
  expect(second === first).toBe(false);
  expect(await second).toBe(true);
  expect(servesOf(mind.itx, "telemetry") === second).toBe(true);
  expect(mind.asked()).toBe(2);
});

/** A member's itx with a session whose `connection` the test sets, and one rule to ask for. */
function fakeMind() {
  let asked = 0;
  const mind = {
    connection: { epoch: 1, state: "open" } as ItxConnection,
    refuse: false,
    asked: () => asked,
    // The two members of an itx that `servesOf` reads: its session and its rewrite rules.
    itx: {
      [ITX_SESSION]: {
        get: () => mind.connection,
        subscribe: () => () => {},
        watch: () => () => {},
      },
      rewriteRules: {
        get: async () => {
          asked += 1;
          if (mind.refuse) throw new Error("refused");
          return { target: "x" };
        },
      },
    } as unknown as AuthenticatedApp["itx"],
  };
  return mind;
}
