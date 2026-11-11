import { expect, test } from "vitest";
import { approvalsOf, projectApprovalsOf, WAIT_MS, type LogEvent } from "./approvals.ts";

test("a request with no decision waits, and says what it is", () => {
  expect(approvalsOf(SECRET, [requested("d1", minutesAgo(5))], NOW)).toMatchObject({
    waiting: [
      {
        secret: SECRET,
        digest: "d1",
        method: "POST",
        url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        bodyStart: '{"raw":"…',
        from: "/agents/web/1",
        requestedAt: minutesAgo(5),
      },
    ],
    decided: [],
  });
});

test("an approved request is approved and not sent, then sent with its status", () => {
  const before = [
    requested("d1", minutesAgo(5)),
    event("request-approved", { digests: ["d1"], signer, signed: {} }, minutesAgo(4)),
  ];
  const approvedOnly = approvalsOf(SECRET, before, NOW);
  expect(approvedOnly).toMatchObject({
    waiting: [],
    approved: [
      {
        digest: "d1",
        decision: "approved",
        signer: "jonas@example.com",
        keyLabel: "YubiKey",
        sent: undefined,
      },
    ],
  });

  const sent = approvalsOf(
    SECRET,
    [
      ...before,
      event("used", { method: "POST", url: "…", status: 200, digest: "d1" }, minutesAgo(3)),
    ],
    NOW,
  );
  expect(sent).toMatchObject({
    approved: [],
    decided: [{ digest: "d1", decision: "approved", sent: { status: 200, at: minutesAgo(3) } }],
  });
});

test("a rejected request does not wait, and keeps its reason", () => {
  const rejected = event(
    "request-rejected",
    { digests: ["d1"], signer, signed: {}, reason: "Wrong person" },
    minutesAgo(4),
  );
  expect(approvalsOf(SECRET, [requested("d1", minutesAgo(5)), rejected], NOW)).toMatchObject({
    waiting: [],
    approved: [],
    decided: [
      { digest: "d1", decision: "rejected", reason: "Wrong person", decidedAt: minutesAgo(4) },
    ],
  });
});

test("a request whose caller stopped waiting still waits", () => {
  const expired = event("hold-expired", { digest: "d1" }, minutesAgo(3));
  expect(approvalsOf(SECRET, [requested("d1", minutesAgo(5)), expired], NOW)).toMatchObject({
    waiting: [{ digest: "d1" }],
  });
});

test("a request older than a day no longer waits", () => {
  expect(
    approvalsOf(SECRET, [requested("d1", minutesAgo(WAIT_MS / 60_000 + 1))], NOW),
  ).toMatchObject({ waiting: [], decided: [] });
});

test("the rule is the last one set: set, tightened, removed", () => {
  const set = event(
    "approval-rule-configured",
    { rule: { methods: ["POST"], hosts: ["gmail.googleapis.com"] } },
    minutesAgo(30),
  );
  const tightened = event(
    "approval-rule-configured",
    { rule: { methods: ["DELETE", "POST"], hosts: ["gmail.googleapis.com"] } },
    minutesAgo(20),
  );
  const removed = event("approval-rule-configured", { rule: null }, minutesAgo(10));
  expect(approvalsOf(SECRET, [set], NOW)).toMatchObject({
    rule: { methods: ["POST"], hosts: ["gmail.googleapis.com"] },
  });
  expect(approvalsOf(SECRET, [set, tightened], NOW)).toMatchObject({
    rule: { methods: ["DELETE", "POST"], hosts: ["gmail.googleapis.com"] },
  });
  expect(approvalsOf(SECRET, [set, tightened, removed], NOW)).toMatchObject({ rule: null });
});

test("the project's lists merge every secret's, newest first", () => {
  const folded = projectApprovalsOf(
    [
      { secret: "/secrets/a", events: [requested("a1", minutesAgo(10))] },
      { secret: "/secrets/b", events: [requested("b1", minutesAgo(2))] },
    ],
    NOW,
  );
  expect(folded).toMatchObject({
    waiting: [{ digest: "b1" }, { digest: "a1" }],
    rules: [],
  });
});

const SECRET = "/secrets/gmail";
const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const signer = {
  principal: { actor: "usr_1", email: "jonas@example.com" },
  key: "key_1",
  label: "YubiKey",
};

function minutesAgo(minutes: number) {
  return new Date(NOW - minutes * 60_000).toISOString();
}

function event(type: string, payload: unknown, at: string): LogEvent {
  return { type: `events.iterate.com/secret/${type}`, payload, createdAt: at };
}

function requested(digest: string, at: string) {
  return event(
    "approval-requested",
    {
      digest,
      method: "POST",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      bodyStart: '{"raw":"…',
      from: "/agents/web/1",
    },
    at,
  );
}
