import { expect, test } from "vitest";
import { heldActsOf } from "./held-acts.ts";

test("an act still waits after its caller stopped waiting: a member can approve it for a day", () => {
  const events = [
    held("late", "2026-11-12T00:00:00.000Z"),
    // the gate's fact when the caller's five minutes end (core/secrets-worker acts-gate.ts)
    {
      type: "events.iterate.com/approval/hold-expired",
      createdAt: "2026-11-12T00:05:00.000Z",
      payload: { digest: "late" },
    },
  ];
  const at = (time: string) => heldActsOf(events, Date.parse(time)).map((act) => act.digest);
  expect(at("2026-11-12T00:06:00.000Z")).toEqual(["late"]);
  expect(at("2026-11-12T23:59:00.000Z")).toEqual(["late"]);
  // the gate keeps a held act for a day, and then drops it with no fact
  expect(at("2026-11-13T00:00:01.000Z")).toEqual([]);
});

test("an act waits from its hold until a member answers it", () => {
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
      type: "events.iterate.com/approval/act-rejected",
      createdAt: "2026-11-12T00:05:00.000Z",
      payload: { digests: ["d"], reason: "no" },
    },
  ];
  expect(heldActsOf(events, NOW)).toEqual([
    {
      digest: "c",
      act: "itx.bank.pay",
      summary: "Mail c",
      from: "/agents/web/one",
      heldAt: "2026-11-12T00:02:00.000Z",
    },
  ]);
  expect(
    heldActsOf(
      [
        ...events,
        {
          type: "events.iterate.com/approval/act-rejected",
          createdAt: "2026-11-12T00:06:00.000Z",
          payload: { digests: ["c"], reason: "no" },
        },
      ],
      NOW,
    ),
  ).toEqual([]);
});

test("the newest hold is first, and a fact that names no act changes nothing", () => {
  const acts = heldActsOf(
    [
      held("a", "2026-11-12T00:00:00.000Z"),
      { type: "events.iterate.com/approval/act-held", createdAt: "2026-11-12T00:00:30.000Z" },
      { type: "events.iterate.com/approval/rule-set", createdAt: "2026-11-12T00:00:40.000Z" },
      held("b", "2026-11-12T00:01:00.000Z"),
    ],
    NOW,
  );
  expect(acts.map((act) => act.digest)).toEqual(["b", "a"]);
});

/** A moment within a day of every hold above. */
const NOW = Date.parse("2026-11-12T01:00:00.000Z");

/** A fact that the gate holds an act. */
function held(digest: string, at: string, act = "email.send") {
  return {
    type: "events.iterate.com/approval/act-held",
    createdAt: at,
    payload: { digest, act, summary: `Mail ${digest}`, from: "/agents/web/one" },
  };
}
