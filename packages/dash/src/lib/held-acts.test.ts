import { expect, test } from "vitest";
import { heldActsOf } from "./held-acts.ts";

test("an act waits from its hold until a member answers it, or its hold runs out", () => {
  const events = [
    held("a", "2026-11-12T00:00:00.000Z"),
    held("b", "2026-11-12T00:01:00.000Z"),
    held("c", "2026-11-12T00:02:00.000Z", "itx.bank.pay"),
    held("d", "2026-11-12T00:03:00.000Z"),
    {
      type: "events.iterate.com/approval/act-approved",
      createdAt: "2026-11-12T00:04:00.000Z",
      payload: { digests: ["a", "b"] },
    },
    {
      type: "events.iterate.com/approval/hold-expired",
      createdAt: "2026-11-12T00:05:00.000Z",
      payload: { digest: "d" },
    },
  ];
  expect(heldActsOf(events)).toEqual([
    {
      digest: "c",
      act: "itx.bank.pay",
      summary: "Mail c",
      from: "/agents/web/one",
      heldAt: "2026-11-12T00:02:00.000Z",
    },
  ]);
  expect(
    heldActsOf([
      ...events,
      {
        type: "events.iterate.com/approval/act-rejected",
        createdAt: "2026-11-12T00:06:00.000Z",
        payload: { digests: ["c"], reason: "no" },
      },
    ]),
  ).toEqual([]);
});

test("the newest hold is first, and a fact that names no act changes nothing", () => {
  const acts = heldActsOf([
    held("a", "2026-11-12T00:00:00.000Z"),
    { type: "events.iterate.com/approval/act-held", createdAt: "2026-11-12T00:00:30.000Z" },
    { type: "events.iterate.com/approval/rule-set", createdAt: "2026-11-12T00:00:40.000Z" },
    held("b", "2026-11-12T00:01:00.000Z"),
  ]);
  expect(acts.map((act) => act.digest)).toEqual(["b", "a"]);
});

/** A fact that the gate holds an act. */
function held(digest: string, at: string, act = "email.send") {
  return {
    type: "events.iterate.com/approval/act-held",
    createdAt: at,
    payload: { digest, act, summary: `Mail ${digest}`, from: "/agents/web/one" },
  };
}
