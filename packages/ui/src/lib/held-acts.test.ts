import { expect, test } from "vitest";
import { heldActsOf, proposedRulesOf } from "./held-acts.ts";

test("a proposed rule is open until a member signs it into a rule or rejects it, whichever kind it is", () => {
  const fact = (type: string, payload: object) => ({
    type: `events.iterate.com/approval/${type}`,
    createdAt: "2026-11-12T08:00:00.000Z",
    payload,
  });
  const events = [
    fact("rule-proposed", { id: "verb-signed", rule: { verb: "email.send" } }),
    fact("rule-proposed", { id: "secret-signed", rule: { secret: "/secrets/fastmail" } }),
    fact("rule-proposed", { id: "rejected", rule: { verb: "itx.x.y" } }),
    fact("rule-proposed", { id: "open", rule: { secret: "/secrets/other" } }),
  ];
  const idsOf = (log: typeof events) => proposedRulesOf(log).map((proposal) => proposal.id);
  expect(idsOf(events)).toEqual(["verb-signed", "secret-signed", "rejected", "open"]);
  expect(
    idsOf([
      ...events,
      // a rule for an act is signed as the whole rule set, which names the proposal it takes up
      fact("rule-set", { rules: [{ verb: "email.send" }], proposal: "verb-signed" }),
      // a rule for a secret is signed as that secret's rule, and the gate says so
      fact("rule-proposal-signed", { id: "secret-signed", secret: "/secrets/fastmail" }),
      fact("rule-proposal-rejected", { id: "rejected" }),
      // a rule set that takes up no proposal ends none
      fact("rule-set", { rules: [] }),
    ]),
  ).toEqual(["open"]);
});

test("an open proposal says what its rule is for, who asked and when, newest first", () => {
  const proposed = (id: string, at: string, payload: object) => ({
    type: "events.iterate.com/approval/rule-proposed",
    createdAt: at,
    payload: { id, ...payload },
  });
  expect(
    proposedRulesOf([
      proposed("p1", "2026-11-12T08:00:00.000Z", {
        rule: { secret: "/secrets/fastmail", methods: ["POST"], hosts: ["api.fastmail.com"] },
        from: "/agents/mail",
      }),
      proposed("p2", "2026-11-12T09:00:00.000Z", { rule: { verb: "email.send" } }),
      // a fact with no id is no proposal
      proposed("", "2026-11-12T09:30:00.000Z", { rule: { verb: "itx.x" } }),
    ]),
  ).toEqual([
    { id: "p2", verb: "email.send", proposedAt: "2026-11-12T09:00:00.000Z" },
    {
      id: "p1",
      secret: "/secrets/fastmail",
      from: "/agents/mail",
      proposedAt: "2026-11-12T08:00:00.000Z",
    },
  ]);
});

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
